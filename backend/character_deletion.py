"""One transactional, exact-ID, global character purge. No production CLI.

The reviewed manifest deliberately fails closed on schema drift. Extending a
schema requires reviewing ownership/indirect references and updating its tests.
"""
from pathlib import Path
import json
import uuid

from psycopg2 import sql
from character_lifecycle import FENCE_KEY, member_ids
from db import get_conn

DIRECT_TABLES = (
    'character_memory', 'short_memory', 'long_memory', 'bond_memory',
    'char_schedule', 'char_diary', 'diary_visit', 'proactive_promise',
    'proactive_msg', 'rel_state', 'rel_provenance_log', 'rel_declared_stance',
    'rel_boundary_hits', 'rel_repair_log', 'rel_interaction_stats',
    'rel_offline_character_state',
)
INDIRECT_TABLES = ('characters', 'char_diary_comment', 'diary_book', 'memory_jobs')
PERSONAL_TABLES = (
    'settings', 'user_stats', 'tasks', 'accounts', 'accounting_records',
    'user_diary', 'push_token', 'period_records', 'courses', 'course_sessions',
    'course_exceptions', 'course_day_off',
)
METADATA_TABLES = ('character_tombstones', 'character_deletion_meta')


class PurgeBlocked(Exception):
    pass


def init_deletion_metadata():
    conn = get_conn()
    try:
        with conn, conn.cursor() as cur:
            cur.execute('''CREATE TABLE IF NOT EXISTS character_tombstones (
                character_id TEXT PRIMARY KEY,
                operation_id UUID NOT NULL UNIQUE,
                deleted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                counts JSONB NOT NULL)''')
            cur.execute('''CREATE TABLE IF NOT EXISTS character_deletion_meta (
                singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
                server_id UUID NOT NULL)''')
            cur.execute('''INSERT INTO character_deletion_meta (singleton, server_id)
                           VALUES (TRUE, %s) ON CONFLICT DO NOTHING''', (str(uuid.uuid4()),))
    finally:
        conn.close()


def _tables(cur):
    cur.execute("""SELECT table_name FROM information_schema.tables
                   WHERE table_schema='public' AND table_type='BASE TABLE'""")
    return {r[0] for r in cur.fetchall()}


def init_deletion_guards():
    """Must finish successfully before ANY scheduler/worker starts."""
    init_deletion_metadata()
    conn = get_conn()
    try:
        with conn, conn.cursor() as cur:
            cur.execute('SELECT pg_advisory_xact_lock(%s)', (FENCE_KEY,))
            cur.execute(Path(__file__).with_name('character_delete_guards.sql').read_text())
            present = _tables(cur)
            guarded = set(DIRECT_TABLES + INDIRECT_TABLES + PERSONAL_TABLES + ('gojo_memory',)) & present
            for table in sorted(guarded):
                ident = sql.Identifier(table)
                cur.execute(sql.SQL('DROP TRIGGER IF EXISTS gojo_write_fence ON {}').format(ident))
                cur.execute(sql.SQL('''CREATE TRIGGER gojo_write_fence
                    BEFORE INSERT OR UPDATE OR DELETE ON {} FOR EACH STATEMENT
                    EXECUTE FUNCTION gojo_write_fence()''').format(ident))
                if table in PERSONAL_TABLES:
                    continue
                cur.execute(sql.SQL('DROP TRIGGER IF EXISTS gojo_character_row_guard ON {}').format(ident))
                cur.execute(sql.SQL('''CREATE TRIGGER gojo_character_row_guard
                    BEFORE INSERT OR UPDATE ON {} FOR EACH ROW
                    EXECUTE FUNCTION gojo_character_row_guard()''').format(ident))
    finally:
        conn.close()


def _preflight(cur):
    manifest = json.loads(Path(__file__).with_name('character_delete_schema.json').read_text())
    present = _tables(cur)
    unknown = present - set(manifest)
    missing = set(DIRECT_TABLES + INDIRECT_TABLES + PERSONAL_TABLES + METADATA_TABLES) - present
    if unknown or missing:
        raise PurgeBlocked('schema tables require review: ' + ', '.join(sorted(unknown | missing)))
    # ROW EXCLUSIVE blocks destructive DDL but is compatible with the implicit
    # RowExclusiveLock a waiting writer takes BEFORE its statement trigger.
    # A stronger table lock here would invert that order and cause a deadlock.
    for table in sorted(present):
        cur.execute(sql.SQL('LOCK TABLE {} IN ROW EXCLUSIVE MODE').format(sql.Identifier(table)))
    cur.execute("""SELECT table_name, column_name FROM information_schema.columns
                   WHERE table_schema='public'""")
    columns = {}
    for table, column in cur.fetchall():
        if table in present:
            columns.setdefault(table, set()).add(column)
    for table, actual in columns.items():
        allowed = set(manifest[table])
        # Vectors are optional; all other reviewed columns must match.
        if actual - allowed or (allowed - actual) - {'embedding_json'}:
            raise PurgeBlocked('schema columns require review: ' + table)
    cur.execute("""SELECT c.relname, t.tgname, t.tgenabled FROM pg_trigger t
                   JOIN pg_class c ON c.oid=t.tgrelid
                   JOIN pg_namespace n ON n.oid=c.relnamespace
                   WHERE n.nspname='public' AND NOT t.tgisinternal""")
    triggers = {(table, name): enabled for table, name, enabled in cur.fetchall()}
    for table in present - set(METADATA_TABLES):
        required = ['gojo_write_fence'] + ([] if table in PERSONAL_TABLES else ['gojo_character_row_guard'])
        if any(triggers.get((table, name)) != 'O' for name in required):
            raise PurgeBlocked('missing deletion fence: ' + table)
    if set(triggers) - {(t, n) for t in present for n in ('gojo_write_fence', 'gojo_character_row_guard')}:
        raise PurgeBlocked('unreviewed database trigger')
    # No unknown FK/cascade may delete another character or personal data.
    cur.execute("""SELECT conrelid::regclass::text, confrelid::regclass::text,
                          pg_get_constraintdef(oid) FROM pg_constraint
                   WHERE contype='f' AND connamespace='public'::regnamespace""")
    allowed_fk = {
        ('accounting_records', 'accounts', 'FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE'),
        ('course_sessions', 'courses', 'FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE'),
        ('course_exceptions', 'courses', 'FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE'),
    }
    if set(cur.fetchall()) - allowed_fk:
        raise PurgeBlocked('unreviewed foreign key/cascade')
    cur.execute('''SELECT 1 FROM char_diary_comment c LEFT JOIN char_diary d ON d.id=c.diary_id
                   WHERE d.id IS NULL LIMIT 1''')
    if cur.fetchone():
        raise PurgeBlocked('orphan diary comment ownership requires review')
    cur.execute('SELECT id, kind, character_id, extra_json FROM memory_jobs ORDER BY id')
    groups = []
    for job_id, kind, cid, raw in cur.fetchall():
        if kind == 'private' and cid is not None and raw is None:
            continue
        if kind != 'group':
            raise PurgeBlocked(f'unrecognized memory job #{job_id}')
        try:
            payload = json.loads(raw)
            if set(payload) != {'members', 'round_transcript'} or not isinstance(payload['round_transcript'], str):
                raise ValueError('shape')
            groups.append((job_id, member_ids(payload['members'])))
        except (ValueError, TypeError, KeyError):
            raise PurgeBlocked(f'unrecognized legacy group job #{job_id}') from None
    return present, groups


def _receipt(row):
    return {'status': 'deleted', 'character_id': row[0], 'operation_id': str(row[1]),
            'deleted_at': row[2].isoformat(), 'counts': row[3]}


def get_receipt(operation_id):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute('''SELECT character_id, operation_id, deleted_at, counts
                           FROM character_tombstones WHERE operation_id=%s''', (str(operation_id),))
            row = cur.fetchone()
            return _receipt(row) if row else {'status': 'not_committed', 'operation_id': str(operation_id)}
    finally:
        conn.close()


def purge_character(character_id, operation_id, *, lock_timeout_ms=5000):
    if not character_id or character_id in ('shared', 'user'):
        raise PurgeBlocked('reserved or empty character id')
    operation_id = str(uuid.UUID(str(operation_id)))
    conn = get_conn()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT set_config('lock_timeout', %s, true)", (f'{lock_timeout_ms}ms',))
            cur.execute('SELECT pg_advisory_xact_lock(%s)', (FENCE_KEY,))
            cur.execute('''SELECT character_id, operation_id, deleted_at, counts FROM character_tombstones
                           WHERE character_id=%s OR operation_id=%s''', (character_id, operation_id))
            rows = cur.fetchall()
            if rows:
                if any(r[0] != character_id for r in rows):
                    raise PurgeBlocked('operation id already belongs to another character')
                return _receipt(rows[0])
            present, groups = _preflight(cur)
            cur.execute('SELECT 1 FROM characters WHERE id=%s', (character_id,))
            if not cur.fetchone():
                # Permit deleting old hidden characters only with known owned rows.
                raise PurgeBlocked('character not found; no deletion performed')
            counts = {}

            def delete(table, predicate, values):
                cur.execute(sql.SQL('DELETE FROM {} WHERE ').format(sql.Identifier(table)) + sql.SQL(predicate), values)
                counts[table] = cur.rowcount

            delete('char_diary_comment', 'diary_id IN (SELECT id FROM char_diary WHERE character_id=%s)', (character_id,))
            cur.execute('''UPDATE bond_memory SET linked_fact_id=NULL WHERE linked_fact_id IN
                           (SELECT id FROM long_memory WHERE character_id=%s)''', (character_id,))
            counts['detached_fact_links'] = cur.rowcount
            group_ids = [job for job, ids in groups if character_id in ids]
            delete('memory_jobs', 'character_id=%s OR id=ANY(%s)', (character_id, group_ids))
            delete('diary_book', "owner=%s AND owner<>'user'", (character_id,))
            for table in DIRECT_TABLES:
                delete(table, 'character_id=%s', (character_id,))
            if 'gojo_memory' in present and character_id == 'gojo':
                # Legacy table is by definition exclusively owned by exact ID gojo.
                cur.execute('SELECT id FROM gojo_memory ORDER BY id')
                legacy_ids = [row[0] for row in cur.fetchall()]
                delete('gojo_memory', 'id=ANY(%s)', (legacy_ids,))
            delete('characters', 'id=%s', (character_id,))
            cur.execute('''INSERT INTO character_tombstones (character_id, operation_id, counts)
                           VALUES (%s,%s,%s) RETURNING character_id, operation_id, deleted_at, counts''',
                        (character_id, operation_id, json.dumps(counts)))
            receipt = _receipt(cur.fetchone())
        # Every process checks the committed epoch before reusing a cache.
        return receipt
    finally:
        conn.close()
