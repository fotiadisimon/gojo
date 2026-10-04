"""Destructive tests ONLY in disposable databases we create on explicit loopback DSN.
Never reads production DATABASE_URL, never imports the server or starts workers.
"""
import importlib
import os
from pathlib import Path
import sys
import uuid

import psycopg2
from psycopg2 import sql
from psycopg2.extensions import parse_dsn, make_dsn
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))


def initialize():
    from character_deletion import init_deletion_metadata, init_deletion_guards
    init_deletion_metadata()
    for module, fn in [
        ('db','init_db'), ('db_diary','init_diary_tables'),
        ('db_promise','init_promise_table'), ('db_schedule','init_schedule_table'),
        ('proactive_msg','init_proactive_table'), ('push_notify','init_push_table'),
        ('route_period','init_period_table'), ('db_course','init_course_tables'),
        ('relationship_db','init_relationship_tables'), ('memory_jobs','init_memory_jobs_table'),
        ('migrate_two_level_recall','migrate_two_level'),
    ]:
        getattr(importlib.import_module(module), fn)()
    from db import get_conn
    conn=get_conn()
    with conn, conn.cursor() as cur:
        for table in ('long_memory','bond_memory'):
            cur.execute(sql.SQL('ALTER TABLE {} ADD COLUMN IF NOT EXISTS embedding_json TEXT').format(sql.Identifier(table)))
    conn.close()
    init_deletion_guards()


@pytest.fixture(scope='session')
def template():
    raw=os.environ.get('TEST_POSTGRES_ADMIN_DSN')
    if not raw:
        pytest.fail('TEST_POSTGRES_ADMIN_DSN must explicitly name a disposable local PostgreSQL server')
    options=parse_dsn(raw)
    if options.get('host') not in ('127.0.0.1','localhost') or options.get('dbname') != 'postgres':
        pytest.fail('test admin DSN must target loopback postgres; never production')
    admin=psycopg2.connect(raw); admin.autocommit=True
    name='gojo_delete_test_template_'+uuid.uuid4().hex
    with admin.cursor() as cur: cur.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    dsn=make_dsn(raw, dbname=name)
    # Override BEFORE config import so dotenv cannot select a production URL.
    os.environ['DATABASE_URL']=dsn
    import db
    db.DATABASE_URL=dsn
    initialize()
    yield admin, raw, name
    with admin.cursor() as cur: cur.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))
    admin.close()


@pytest.fixture
def database(template, monkeypatch):
    admin, raw, source=template
    name='gojo_delete_test_'+uuid.uuid4().hex
    with admin.cursor() as cur:
        cur.execute(sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(sql.Identifier(name),sql.Identifier(source)))
    dsn=make_dsn(raw,dbname=name)
    import db
    monkeypatch.setattr(db,'DATABASE_URL',dsn)
    monkeypatch.setenv('DATABASE_URL',dsn)
    # No paid/external requests are permitted in these tests.
    monkeypatch.setenv('CHARACTER_DELETE_ADMIN_KEY','test-only-admin-key-'+'x'*32)
    yield dsn
    with admin.cursor() as cur:
        cur.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))
