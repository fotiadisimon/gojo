def test_create_and_list(client):
    r = client.post('/tasks', json={
        'user_id': 'u1', 'title': '开会', 'category': '工作',
        'due_date': '2025-06-01', 'due_time': '10:00',
    })
    assert r.status_code == 200

    tasks = client.get('/tasks?user_id=u1').json()['tasks']
    assert len(tasks) == 1
    assert tasks[0]['title'] == '开会'
    assert tasks[0]['completed'] is False


def test_create_empty_title_fails(client):
    r = client.post('/tasks', json={'user_id': 'u1', 'title': ''})
    assert r.status_code == 400


def test_create_defaults(client):
    r = client.post('/tasks', json={'user_id': 'u1', 'title': '看电影'})
    assert r.status_code == 200
    task = client.get('/tasks?user_id=u1').json()['tasks'][0]
    assert task['category'] == '个人'
    assert task['due_date'] is None


def test_toggle_completed(client):
    new_id = client.post('/tasks', json={'user_id': 'u1', 'title': 'x'}).json()['id']
    client.put(f'/tasks/{new_id}', json={'user_id': 'u1', 'completed': True})
    task = client.get('/tasks?user_id=u1').json()['tasks'][0]
    assert task['completed'] is True


def test_completed_truthy(client):
    """completed 支持 bool、0/1、'true'/'false'"""
    new_id = client.post('/tasks', json={'user_id': 'u1', 'title': 'x'}).json()['id']
    for v in [1, 'true', True]:
        client.put(f'/tasks/{new_id}', json={'user_id': 'u1', 'completed': v})
        assert client.get('/tasks?user_id=u1').json()['tasks'][0]['completed'] is True
    for v in [0, 'false', False]:
        client.put(f'/tasks/{new_id}', json={'user_id': 'u1', 'completed': v})
        assert client.get('/tasks?user_id=u1').json()['tasks'][0]['completed'] is False


def test_update_partial(client):
    new_id = client.post('/tasks', json={'user_id': 'u1', 'title': 'x'}).json()['id']
    client.put(f'/tasks/{new_id}', json={'user_id': 'u1', 'title': 'x2', 'category': '心愿单'})
    task = client.get('/tasks?user_id=u1').json()['tasks'][0]
    assert task['title'] == 'x2'
    assert task['category'] == '心愿单'


def test_update_no_fields_fails(client):
    new_id = client.post('/tasks', json={'user_id': 'u1', 'title': 'x'}).json()['id']
    r = client.put(f'/tasks/{new_id}', json={'user_id': 'u1'})
    assert r.status_code == 400


def test_update_nonexistent(client):
    r = client.put('/tasks/99999', json={'user_id': 'u1', 'title': 'x'})
    assert r.status_code == 404


def test_delete(client):
    new_id = client.post('/tasks', json={'user_id': 'u1', 'title': 'x'}).json()['id']
    r = client.delete(f'/tasks/{new_id}?user_id=u1')
    assert r.status_code == 200
    assert len(client.get('/tasks?user_id=u1').json()['tasks']) == 0


def test_delete_nonexistent(client):
    r = client.delete('/tasks/99999?user_id=u1')
    assert r.status_code == 404


def test_filter_completed(client):
    id1 = client.post('/tasks', json={'user_id': 'u1', 'title': 'todo1'}).json()['id']
    id2 = client.post('/tasks', json={'user_id': 'u1', 'title': 'todo2'}).json()['id']
    client.put(f'/tasks/{id1}', json={'user_id': 'u1', 'completed': True})

    done = client.get('/tasks?user_id=u1&completed=1').json()['tasks']
    todo = client.get('/tasks?user_id=u1&completed=0').json()['tasks']
    assert len(done) == 1 and done[0]['title'] == 'todo1'
    assert len(todo) == 1 and todo[0]['title'] == 'todo2'


def test_isolation(client):
    client.post('/tasks', json={'user_id': 'alice', 'title': 'a-task'})
    client.post('/tasks', json={'user_id': 'bob', 'title': 'b-task'})
    a_titles = [t['title'] for t in client.get('/tasks?user_id=alice').json()['tasks']]
    assert 'a-task' in a_titles and 'b-task' not in a_titles
