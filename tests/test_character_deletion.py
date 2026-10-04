import json
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import psycopg2
import pytest
from psycopg2 import sql


def execute(query, params=(), *, fetch=False):
    from db import get_conn
    conn=get_conn()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(query, params)
            if fetch: return cur.fetchall()
            return cur.rowcount
    finally: conn.close()


def seed_char(cid='gojo'):
    execute('INSERT INTO characters (id,name,core_prompt) VALUES (%s,%s,%s)', (cid,'同名角色','test persona'))


def purge(cid='gojo', op=None, **kwargs):
    from character_deletion import purge_character
    return purge_character(cid,op or uuid.uuid4(), **kwargs)


def seed_all():
    for cid in ['gojo','Gojo','other']: seed_char(cid)
    for uid in ['u1','u2']:
        for cid in ['gojo','Gojo','other']:
            execute('INSERT INTO short_memory (user_id,character_id,role,content) VALUES (%s,%s,\'user\',\'private\')',(uid,cid))
            for table in ['long_memory','bond_memory']:
                execute(sql.SQL('INSERT INTO {} (user_id,character_id,content,embedding_json) VALUES (%s,%s,%s,%s)').format(sql.Identifier(table)),(uid,cid,'secret','[1,0]'))
            execute('INSERT INTO character_memory (character_id,content) VALUES (%s,\'persona\')',(cid,))
            execute('INSERT INTO char_schedule (character_id,user_id,sched_date,start_time,end_time,title) VALUES (%s,%s,\'2026-10-04\',\'10:00\',\'11:00\',\'test\')',(cid,uid))
            diary=execute('INSERT INTO char_diary (character_id,user_id,content) VALUES (%s,%s,\'diary\') RETURNING id',(cid,uid),fetch=True)[0][0]
            execute('INSERT INTO char_diary_comment (diary_id,user_id,content) VALUES (%s,%s,\'comment\')',(diary,uid))
            execute('INSERT INTO diary_book (user_id,owner,title) VALUES (%s,%s,\'title\')',(uid,cid))
            execute('INSERT INTO diary_visit (diary_id,character_id,user_id) VALUES (1,%s,%s)',(cid,uid))
            execute('INSERT INTO proactive_promise (character_id,user_id,trigger_kind,context) VALUES (%s,%s,\'once\',\'private\')',(cid,uid))
            execute('INSERT INTO proactive_msg (character_id,user_id,kind,jp) VALUES (%s,%s,\'test\',\'private\')',(cid,uid))
            execute('INSERT INTO memory_jobs (user_id,character_id,user_text,assistant_text,last_error) VALUES (%s,%s,\'private\',\'reply\',\'error\')',(uid,cid))
            execute('INSERT INTO rel_state (user_id,character_id) VALUES (%s,%s)',(uid,cid))
            execute('INSERT INTO rel_provenance_log (user_id,character_id,state_field) VALUES (%s,%s,\'trust\')',(uid,cid))
            execute('INSERT INTO rel_declared_stance (user_id,character_id,stance_type,content) VALUES (%s,%s,\'x\',\'secret\')',(uid,cid))
            execute('INSERT INTO rel_boundary_hits (user_id,character_id,topic_id) VALUES (%s,%s,\'x\')',(uid,cid))
            execute('INSERT INTO rel_repair_log (user_id,character_id) VALUES (%s,%s)',(uid,cid))
            execute('INSERT INTO rel_interaction_stats (user_id,character_id,direction) VALUES (%s,%s,\'user\')',(uid,cid))
            execute('INSERT INTO rel_offline_character_state (user_id,character_id) VALUES (%s,%s)',(uid,cid))
        execute("INSERT INTO long_memory (user_id,character_id,content) VALUES (%s,'shared','personal shared fact')",(uid,))
        execute("INSERT INTO user_diary (user_id,content) VALUES (%s,'personal diary')",(uid,))
        execute("INSERT INTO diary_book (user_id,owner,title) VALUES (%s,'user','personal title')",(uid,))
        execute("INSERT INTO accounts (user_id,name) VALUES (%s,'personal bank')",(uid,))
        execute("INSERT INTO courses (user_id,name) VALUES (%s,'course')",(uid,))
        execute("INSERT INTO tasks (user_id,title) VALUES (%s,'personal task')",(uid,))
        execute("INSERT INTO push_token (user_id,token) VALUES (%s,%s)",(uid,uid+'device'))
    fact=execute("SELECT id FROM long_memory WHERE character_id='gojo' LIMIT 1",fetch=True)[0][0]
    execute("UPDATE bond_memory SET linked_fact_id=%s WHERE character_id='other'",(fact,))


def test_complete_purge_and_isolation(database):
    from character_deletion import DIRECT_TABLES
    seed_all()
    before={t:execute(sql.SQL('SELECT * FROM {} ORDER BY 1').format(sql.Identifier(t)),fetch=True) for t in ['accounts','courses','tasks','user_diary','push_token']}
    result=purge()
    assert result['status']=='deleted'
    for table in DIRECT_TABLES:
        assert execute(sql.SQL('SELECT count(*) FROM {} WHERE character_id=%s').format(sql.Identifier(table)),('gojo',),fetch=True)==[(0,)]
        assert execute(sql.SQL('SELECT count(*) FROM {} WHERE character_id=%s').format(sql.Identifier(table)),('Gojo',),fetch=True)[0][0]>0
    assert execute('SELECT count(*) FROM char_diary_comment',fetch=True)==[(4,)]
    assert execute("SELECT count(*) FROM long_memory WHERE character_id='shared'",fetch=True)==[(2,)]
    assert execute("SELECT count(*) FROM bond_memory WHERE character_id='other' AND linked_fact_id IS NOT NULL",fetch=True)==[(0,)]
    for t,rows in before.items(): assert execute(sql.SQL('SELECT * FROM {} ORDER BY 1').format(sql.Identifier(t)),fetch=True)==rows
    assert execute("SELECT count(*) FROM diary_book WHERE owner='user'",fetch=True)==[(2,)]
    assert execute('SELECT count(*) FROM characters',fetch=True)==[(2,)]


def test_auth_old_routes_and_exact_confirmation(database):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from route_character import router
    from route_character_deletion import router as deletion_router
    app=FastAPI();app.include_router(router);app.include_router(deletion_router);client=TestClient(app)
    seed_char();op=str(uuid.uuid4());body={'operation_id':op,'confirmed_character_id':'gojo','confirm_all_users':True}
    for legacy in ['/characters/gojo','/character/gojo']: assert client.delete(legacy).status_code==409
    assert client.post('/characters/gojo/permanent-deletion',json=body).status_code==403
    assert client.post('/characters/gojo/permanent-deletion',json={**body,'user_id':'admin'}).status_code==403
    headers={'X-Character-Delete-Key':os.environ['CHARACTER_DELETE_ADMIN_KEY']}
    assert client.post('/characters/gojo/permanent-deletion',json={**body,'confirmed_character_id':'Gojo'},headers=headers).status_code==400
    assert client.post('/characters/gojo/permanent-deletion',json=body,headers=headers).status_code==200
    assert client.get('/character-deletions/'+op,headers=headers).json()['status']=='deleted'
    assert client.post('/characters',json={'id':'gojo','name':'new','core_prompt':'x'}).status_code==409


def test_idempotency_and_unknown_operation(database):
    from character_deletion import get_receipt, PurgeBlocked
    seed_char();seed_char('other');op=uuid.uuid4()
    assert get_receipt(op)['status']=='not_committed'
    first=purge(op=op)
    assert purge(op=op)==first
    assert purge(op=uuid.uuid4())==first
    with pytest.raises(PurgeBlocked):purge('other',op)
    assert get_receipt(op)==first


def test_seed_migration_and_recreate_cannot_resurrect(database):
    from characters import seed_all_characters
    from db import migrate_old_gojo_memory
    seed_char();purge();seed_all_characters();migrate_old_gojo_memory()
    assert execute('SELECT count(*) FROM characters',fetch=True)==[(0,)]
    with pytest.raises(psycopg2.Error):seed_char()
    seed_char('new-id')
    assert execute('SELECT id FROM characters',fetch=True)==[('new-id',)]


@pytest.mark.parametrize('change', [
    'CREATE TABLE surprise (id int, diary_id int)',
    'ALTER TABLE long_memory ADD COLUMN source_role text',
    'ALTER TABLE short_memory DISABLE TRIGGER gojo_write_fence',
    'ALTER TABLE tasks ADD CONSTRAINT surprise_fk FOREIGN KEY (title) REFERENCES characters(id) ON DELETE CASCADE',
])
def test_unknown_schema_blocks_without_partial_delete(database,change):
    from character_deletion import PurgeBlocked
    seed_char();execute(change)
    with pytest.raises(PurgeBlocked):purge()
    assert execute('SELECT id FROM characters',fetch=True)==[('gojo',)]
    assert execute('SELECT count(*) FROM character_tombstones',fetch=True)==[(0,)]


def test_group_payload_exact_identity_and_unknown_payload(database):
    from character_deletion import PurgeBlocked
    from memory_jobs import enqueue_group_extraction
    seed_char();seed_char('Gojo');seed_char('other')
    deleted=enqueue_group_extraction('u1','secret','transcript',[{'id':'gojo','name':'same'},{'id':'other','name':'same'}])
    keep=enqueue_group_extraction('u1','keep','transcript',[{'id':'Gojo','name':'same'}])
    purge()
    assert execute('SELECT id FROM memory_jobs',fetch=True)==[(keep,)]
    # Simulate unreadable historical row predating the installed guard.
    execute('ALTER TABLE memory_jobs DISABLE TRIGGER gojo_character_row_guard')
    execute("INSERT INTO memory_jobs (kind,user_id,extra_json) VALUES ('group','u1','broken')")
    execute('ALTER TABLE memory_jobs ENABLE TRIGGER gojo_character_row_guard')
    with pytest.raises(PurgeBlocked):purge('other')
    assert execute("SELECT id FROM characters WHERE id='other'",fetch=True)==[('other',)]


def test_transaction_fault_rolls_back_every_table(database, monkeypatch):
    import character_deletion
    seed_all()
    # Inject a failure AFTER earlier tables have been purged, inside the real transaction.
    original=character_deletion.json.dumps
    def fail(value,*a,**kw):
        if isinstance(value,dict) and 'characters' in value:raise RuntimeError('injected failure')
        return original(value,*a,**kw)
    monkeypatch.setattr(character_deletion.json,'dumps',fail)
    with pytest.raises(RuntimeError):purge()
    assert execute("SELECT count(*) FROM short_memory WHERE character_id='gojo'",fetch=True)==[(2,)]
    assert execute('SELECT count(*) FROM char_diary_comment',fetch=True)==[(6,)]
    assert execute('SELECT count(*) FROM character_tombstones',fetch=True)==[(0,)]


def test_writer_holds_fence_delete_waits_and_cleans_committed_write(database):
    from db import get_conn
    seed_char();writer=get_conn();writer.cursor().execute("INSERT INTO short_memory (character_id,content) VALUES ('gojo','inflight')")
    with ThreadPoolExecutor() as pool:
        deleting=pool.submit(purge)
        time.sleep(.15);assert not deleting.done()
        writer.commit();writer.close();assert deleting.result(timeout=15)['status']=='deleted'
    assert execute('SELECT count(*) FROM short_memory',fetch=True)==[(0,)]


def test_delete_first_waiting_writer_reads_committed_tombstone(database):
    from db import get_conn
    from character_lifecycle import FENCE_KEY
    seed_char();blocker=get_conn();cur=blocker.cursor();cur.execute('SELECT pg_advisory_xact_lock(%s)',(FENCE_KEY,))
    with ThreadPoolExecutor() as pool:
        writer=pool.submit(execute,"INSERT INTO short_memory (character_id,content) VALUES ('gojo','late')")
        time.sleep(.15);assert not writer.done()
        cur.execute("DELETE FROM characters WHERE id='gojo'")
        cur.execute("INSERT INTO character_tombstones (character_id,operation_id,counts) VALUES ('gojo',%s,'{}')",(str(uuid.uuid4()),))
        blocker.commit();blocker.close()
        with pytest.raises(psycopg2.Error):writer.result(timeout=15)
    assert execute('SELECT count(*) FROM short_memory',fetch=True)==[(0,)]


def test_lock_timeout_retry(database):
    from db import get_conn
    seed_char();writer=get_conn();writer.cursor().execute("INSERT INTO short_memory (character_id,content) VALUES ('gojo','inflight')")
    op=uuid.uuid4()
    with pytest.raises(psycopg2.errors.LockNotAvailable):purge(op=op,lock_timeout_ms=50)
    writer.commit();writer.close()
    assert purge(op=op)['status']=='deleted'


def test_late_shared_projection_and_other_side_effects_blocked(database):
    from character_lifecycle import source_scope
    seed_char();seed_char('other');purge()
    with source_scope(['gojo']):
        for q in ["INSERT INTO long_memory (user_id,character_id,content) VALUES ('u1','shared','late')",
                  "INSERT INTO tasks (title) VALUES ('late AI task')",
                  "INSERT INTO bond_memory (user_id,character_id,content) VALUES ('u1','other','late group')"]:
            with pytest.raises(psycopg2.Error):execute(q)
    execute("INSERT INTO tasks (title) VALUES ('user personal task')")
    assert execute('SELECT count(*) FROM tasks',fetch=True)==[(1,)]


def test_running_group_worker_llm_result_cannot_project_after_delete(database,monkeypatch):
    from memory_jobs import _run_job
    import user_memory
    from character_lifecycle import character_work
    seed_char();seed_char('other');entered=threading.Event();release=threading.Event()
    @character_work
    def fake_extractor(user_id,user_text,round_transcript,members):
        entered.set();assert release.wait(15)
        execute("INSERT INTO long_memory (user_id,character_id,content) VALUES ('u1','shared','late')")
        return True
    monkeypatch.setattr(user_memory,'extract_and_save_group_memory',fake_extractor)
    payload=json.dumps({'round_transcript':'private','members':[{'id':'gojo','name':'same'},{'id':'other','name':'same'}]})
    job=execute("INSERT INTO memory_jobs (kind,user_id,extra_json,status) VALUES ('group','u1',%s,'running') RETURNING id",(payload,),fetch=True)[0][0]
    row=(job,'group','u1',None,'secret',None,payload,1)
    with ThreadPoolExecutor() as pool:
        running=pool.submit(_run_job,row);assert entered.wait(10);purge();release.set();running.result(timeout=15)
    assert execute('SELECT count(*) FROM memory_jobs',fetch=True)==[(0,)]
    assert execute('SELECT count(*) FROM long_memory',fetch=True)==[(0,)]


def test_late_comment_and_fact_link_cannot_reappear(database):
    seed_all();diary=execute("SELECT id FROM char_diary WHERE character_id='gojo' LIMIT 1",fetch=True)[0][0]
    fact=execute("SELECT id FROM long_memory WHERE character_id='gojo' LIMIT 1",fetch=True)[0][0]
    purge()
    with pytest.raises(psycopg2.Error):execute('INSERT INTO char_diary_comment (diary_id,content) VALUES (%s,\'late\')',(diary,))
    with pytest.raises(psycopg2.Error):execute("UPDATE bond_memory SET linked_fact_id=%s WHERE character_id='other'",(fact,))


def test_vector_zero_update_and_cross_process_epoch(database,monkeypatch):
    import memory_search as m
    seed_char();rid=execute("INSERT INTO long_memory (character_id,content,embedding_json) VALUES ('gojo','secret','[1,0]') RETURNING id",fetch=True)[0][0]
    m.invalidate_cache();m._load_cache('long_memory');assert rid in m._CACHE['long_memory']
    purge();m._load_cache('long_memory');assert rid not in m._CACHE['long_memory']
    monkeypatch.setattr(m,'is_vector_ready',lambda:True);monkeypatch.setattr(m,'embed',lambda text:[1,0])
    assert m.save_embedding('long_memory',rid,'late') is False
    assert rid not in m._CACHE['long_memory']


def test_push_serialized_with_delete_and_late_send_blocked(database,monkeypatch):
    import push_notify
    seed_char();entered=threading.Event();release=threading.Event();sent=[]
    def send(*a,**kw):entered.set();assert release.wait(15);sent.append(True)
    monkeypatch.setattr(push_notify,'_send_to_user',send)
    with ThreadPoolExecutor() as pool:
        sending=pool.submit(push_notify.push_to_user,'u1','title','body',{'character_id':'gojo'})
        assert entered.wait(10);deleting=pool.submit(purge);time.sleep(.15);assert not deleting.done()
        release.set();sending.result(timeout=15);deleting.result(timeout=15)
    with pytest.raises(ValueError):push_notify.push_to_user('u1','title','body',{'character_id':'gojo'})
    assert len(sent)==1


def test_waiting_writer_does_not_deadlock_preflight_table_locks(database,monkeypatch):
    import character_deletion as service
    seed_char();entered=threading.Event();release=threading.Event();original=service._preflight
    def paused(cur):entered.set();assert release.wait(10);return original(cur)
    monkeypatch.setattr(service,'_preflight',paused)
    with ThreadPoolExecutor() as pool:
        deleting=pool.submit(purge);assert entered.wait(10)
        writer=pool.submit(execute,"INSERT INTO short_memory (character_id,content) VALUES ('gojo','late')")
        time.sleep(.15);release.set()
        assert deleting.result(timeout=15)['status']=='deleted'
        with pytest.raises(psycopg2.Error):writer.result(timeout=15)


def test_legacy_gojo_memory_removed_and_migration_respects_tombstone(database):
    from character_deletion import init_deletion_guards
    from db import migrate_old_gojo_memory
    seed_char()
    execute('CREATE TABLE gojo_memory (id serial PRIMARY KEY,content text,category text,keywords text,importance real,timestamp timestamp)')
    execute("INSERT INTO gojo_memory (content) VALUES ('legacy private')")
    init_deletion_guards();purge()
    assert execute('SELECT count(*) FROM gojo_memory',fetch=True)==[(0,)]
    with pytest.raises(psycopg2.Error):execute("INSERT INTO gojo_memory (content) VALUES ('late')")
    migrate_old_gojo_memory()
    assert execute('SELECT count(*) FROM character_memory',fetch=True)==[(0,)]


def test_all_background_business_writers_reject_deleted_id(database):
    from db_schedule import save_schedule
    from db_diary import add_char_diary, add_diary_visit, set_book_title
    from proactive_msg import add_proactive_msg
    from db_promise import add_promise
    from characters import add_character_memory
    from relationship_db import ensure_state_row
    from memory_jobs import enqueue_private_extraction
    seed_char();purge()
    calls=[
        lambda:save_schedule('gojo','u1','2026-10-04',[{'start_time':'10:00','end_time':'11:00','title':'late'}]),
        lambda:add_char_diary('gojo','u1','late'),
        lambda:add_diary_visit(1,'gojo','u1'),
        lambda:set_book_title('u1','gojo','late'),
        lambda:add_proactive_msg('gojo','u1','late','late'),
        lambda:add_promise('gojo','u1','once','late',trigger_at='2026-10-04T12:00:00'),
        lambda:add_character_memory('gojo','late'),
        lambda:ensure_state_row('u1','gojo'),
        lambda:enqueue_private_extraction('u1','late','late','gojo'),
    ]
    for call in calls:
        with pytest.raises(psycopg2.Error):call()


def test_cache_epoch_invalidates_another_process(database):
    import multiprocessing
    import memory_search as m
    import user_memory as u
    seed_char();rid=execute("INSERT INTO long_memory (character_id,content,embedding_json) VALUES ('gojo','secret','[1,0]') RETURNING id",fetch=True)[0][0]
    parent,child=multiprocessing.get_context('fork').Pipe()
    def reader():
        try:
            m.invalidate_cache();u._char_names_cache=None
            m._load_cache('long_memory');u._all_character_names()
            child.send(rid in m._CACHE['long_memory']);child.recv()
            m._load_cache('long_memory')
            child.send((rid in m._CACHE['long_memory'],u._all_character_names()))
        finally:child.close()
    process=multiprocessing.get_context('fork').Process(target=reader);process.start()
    try:
        assert parent.poll(10) and parent.recv() is True
        purge();parent.send('reload')
        assert parent.poll(10) and parent.recv()==(False,[])
    finally:
        process.join(5)
        if process.is_alive():process.terminate();process.join()
        parent.close()
    assert process.exitcode==0


def test_parallel_double_delete_same_receipt(database):
    seed_char();op=uuid.uuid4()
    with ThreadPoolExecutor() as pool:
        futures=[pool.submit(purge,'gojo',op) for _ in range(3)]
        receipts=[f.result(timeout=15) for f in futures]
    assert all(r==receipts[0] for r in receipts)
    assert execute('SELECT count(*) FROM character_tombstones',fetch=True)==[(1,)]


def test_personal_accounting_courses_period_settings_unchanged(database):
    seed_char()
    for uid in ('u1','u2'):
        account=execute('INSERT INTO accounts (user_id,name) VALUES (%s,\'bank\') RETURNING id',(uid,),fetch=True)[0][0]
        execute("INSERT INTO accounting_records (user_id,account_id,type,description,amount,record_date) VALUES (%s,%s,'out','personal',12,'2026-10-04')",(uid,account))
        course=execute("INSERT INTO courses (user_id,name) VALUES (%s,'course') RETURNING id",(uid,),fetch=True)[0][0]
        execute("INSERT INTO course_sessions (course_id,weekday,start_time,end_time) VALUES (%s,1,'10:00','11:00')",(course,))
        execute("INSERT INTO course_exceptions (course_id,exception_date,exception_type) VALUES (%s,'2026-10-04','cancel')",(course,))
        execute("INSERT INTO course_day_off (user_id,off_date) VALUES (%s,'2026-10-04')",(uid,))
        execute("INSERT INTO period_records (user_id,start_date) VALUES (%s,'2026-10-04')",(uid,))
        execute("INSERT INTO user_stats (user_id,first_chat_date,last_chat_date) VALUES (%s,'2026-10-03','2026-10-04')",(uid,))
    execute("INSERT INTO settings (key,value) VALUES ('personal-config','keep')")
    tables=['accounts','accounting_records','courses','course_sessions','course_exceptions','course_day_off','user_stats','settings','period_records']
    before={t:execute(sql.SQL('SELECT * FROM {} ORDER BY 1').format(sql.Identifier(t)),fetch=True) for t in tables}
    purge()
    for t in tables:assert execute(sql.SQL('SELECT * FROM {} ORDER BY 1').format(sql.Identifier(t)),fetch=True)==before[t]


def test_missing_admin_configuration_fails_closed(database,monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from route_character_deletion import router
    monkeypatch.delenv('CHARACTER_DELETE_ADMIN_KEY')
    app=FastAPI();app.include_router(router);client=TestClient(app)
    assert client.get('/character-deletion/capabilities').json()['admin_configured'] is False
    assert client.post('/characters/gojo/permanent-deletion',json={'operation_id':str(uuid.uuid4()),'confirmed_character_id':'gojo','confirm_all_users':True}).status_code==503


def test_restart_reinstalls_guards_and_empty_state_survives(database):
    from conftest import initialize
    from characters import seed_all_characters
    seed_char();purge();initialize();seed_all_characters()
    assert execute('SELECT count(*) FROM characters',fetch=True)==[(0,)]
    with pytest.raises(psycopg2.Error):seed_char()


def test_unattributed_orphan_comment_blocks_purge(database):
    from character_deletion import PurgeBlocked
    seed_char()
    execute('ALTER TABLE char_diary_comment DISABLE TRIGGER gojo_character_row_guard')
    execute("INSERT INTO char_diary_comment (diary_id,content) VALUES (999,'unknown old owner')")
    execute('ALTER TABLE char_diary_comment ENABLE TRIGGER gojo_character_row_guard')
    with pytest.raises(PurgeBlocked):purge()
    assert execute('SELECT id FROM characters',fetch=True)==[('gojo',)]
