"""日记 CRUD 测试"""


def test_create_and_list(client):
    r = client.post('/diary', json={
        'user_id': 'u1', 'content': '今天很开心', 'mood': '开心', 'date': '2025-06-01',
    })
    assert r.status_code == 200
    assert r.json()['ok']

    r = client.get('/diary?user_id=u1')
    entries = r.json()['entries']
    assert len(entries) == 1
    assert entries[0]['content'] == '今天很开心'


def test_create_empty_fails(client):
    r = client.post('/diary', json={'user_id': 'u1', 'content': ''})
    assert r.status_code == 400


def test_default_date(client):
    r = client.post('/diary', json={'user_id': 'u1', 'content': 'x'})
    assert r.status_code == 200
    entries = client.get('/diary?user_id=u1').json()['entries']
    assert entries[0]['date']  # 有默认值


def test_get_by_id(client):
    new_id = client.post('/diary', json={'user_id': 'u1', 'content': 'aaa'}).json()['id']
    r = client.get(f'/diary/{new_id}?user_id=u1')
    assert r.status_code == 200
    assert r.json()['content'] == 'aaa'


def test_get_nonexistent(client):
    assert client.get('/diary/99999?user_id=u1').status_code == 404


def test_update(client):
    new_id = client.post('/diary', json={'user_id': 'u1', 'content': 'old'}).json()['id']
    r = client.put(f'/diary/{new_id}', json={'user_id': 'u1', 'content': 'new'})
    assert r.status_code == 200
    assert client.get(f'/diary/{new_id}?user_id=u1').json()['content'] == 'new'


def test_update_empty_content_fails(client):
    new_id = client.post('/diary', json={'user_id': 'u1', 'content': 'x'}).json()['id']
    r = client.put(f'/diary/{new_id}', json={'user_id': 'u1', 'content': ''})
    assert r.status_code == 400


def test_update_nothing_fails(client):
    new_id = client.post('/diary', json={'user_id': 'u1', 'content': 'x'}).json()['id']
    r = client.put(f'/diary/{new_id}', json={'user_id': 'u1'})
    assert r.status_code == 400


def test_delete(client):
    new_id = client.post('/diary', json={'user_id': 'u1', 'content': 'x'}).json()['id']
    r = client.delete(f'/diary/{new_id}?user_id=u1')
    assert r.status_code == 200
    assert client.get(f'/diary/{new_id}?user_id=u1').status_code == 404


def test_isolation(client):
    client.post('/diary', json={'user_id': 'alice', 'content': 'a-secret'})
    client.post('/diary', json={'user_id': 'bob', 'content': 'b-secret'})
    a_entries = client.get('/diary?user_id=alice').json()['entries']
    b_entries = client.get('/diary?user_id=bob').json()['entries']
    assert any(e['content'] == 'a-secret' for e in a_entries)
    assert not any(e['content'] == 'a-secret' for e in b_entries)


def test_list_sort_desc(client):
    client.post('/diary', json={'user_id': 'u1', 'content': 'day1', 'date': '2025-01-01'})
    client.post('/diary', json={'user_id': 'u1', 'content': 'day3', 'date': '2025-01-03'})
    client.post('/diary', json={'user_id': 'u1', 'content': 'day2', 'date': '2025-01-02'})
    entries = client.get('/diary?user_id=u1').json()['entries']
    assert [e['date'] for e in entries] == ['2025-01-03', '2025-01-02', '2025-01-01']
