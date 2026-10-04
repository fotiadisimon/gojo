"""Source attribution and cross-process deletion fences (no LLM authority).

Source context survives awaits; background thread entry points are explicitly
decorated. Every connection carries it to PostgreSQL, whose statement triggers
take the shared fence BEFORE taking row locks. Deletion takes the exclusive
fence first. Never hold this fence while waiting for an LLM.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
import inspect
import json

FENCE_KEY = 714230981056
SOURCES = ContextVar('character_sources', default=())


def member_ids(members):
    if not isinstance(members, list) or not members:
        raise ValueError('unrecognized group members')
    result = []
    for member in members:
        if not isinstance(member, dict) or not isinstance(member.get('id'), str) or not member['id']:
            raise ValueError('unrecognized group member identity')
        if set(member) - {'id', 'name'} or not isinstance(member.get('name'), str):
            raise ValueError('unrecognized group member payload')
        result.append(member['id'])
    return result


@contextmanager
def source_scope(ids):
    ids = tuple(sorted(set(SOURCES.get()).union(x for x in ids if x and x != 'shared')))
    token = SOURCES.set(ids)
    try:
        yield
    finally:
        SOURCES.reset(token)


def character_work(fn):
    """Bind exact IDs at task entry, including routes and legacy group tasks."""
    signature = inspect.signature(fn)

    def sources(args, kwargs):
        bound = signature.bind(*args, **kwargs)
        bound.apply_defaults()
        values = bound.arguments
        if 'members' in values:
            return member_ids(values['members'])
        if 'character_id' in values:
            return [values['character_id']]
        from config import DEFAULT_CHARACTER_ID
        return [(values.get('data') or {}).get('character_id', DEFAULT_CHARACTER_ID)]

    if inspect.iscoroutinefunction(fn):
        @wraps(fn)
        async def async_wrapper(*args, **kwargs):
            with source_scope(sources(args, kwargs)):
                return await fn(*args, **kwargs)
        return async_wrapper

    @wraps(fn)
    def wrapper(*args, **kwargs):
        with source_scope(sources(args, kwargs)):
            return fn(*args, **kwargs)
    return wrapper


def configure_connection(conn):
    # Session setting survives the existing code's multiple commits per connection.
    with conn.cursor() as cur:
        cur.execute("SET search_path TO public")
        cur.execute("SELECT set_config('gojo.source_characters', %s, false)",
                    (json.dumps(SOURCES.get()),))


@contextmanager
def delivery_fence(character_id):
    """A push already in flight completes before deletion can commit.

    The external provider can deliver an already accepted push later; it cannot
    be recalled. No new send can start after the tombstone commits.
    """
    from db import get_conn
    conn = get_conn()
    try:
        with conn, conn.cursor() as cur:
            cur.execute('SELECT pg_advisory_xact_lock_shared(%s)', (FENCE_KEY,))
            cur.execute('SELECT 1 FROM character_tombstones WHERE character_id = ANY(%s)',
                        (list(set(SOURCES.get()).union([character_id])),))
            if cur.fetchone():
                raise ValueError('character permanently deleted; delivery cancelled')
            yield
    finally:
        conn.close()


def deletion_epoch():
    from db import get_conn
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute('SELECT count(*) FROM character_tombstones')
            return cur.fetchone()[0]
    finally:
        conn.close()
