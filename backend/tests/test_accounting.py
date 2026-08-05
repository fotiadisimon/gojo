def test_create_expense(client):
    r = client.post('/accounting', json={
        'user_id': 'u1', 'type': 'out', 'category': '餐饮',
        'description': '午饭', 'amount': 25.5, 'date': '2025-06-01',
    })
    assert r.status_code == 200


def test_create_income(client):
    r = client.post('/accounting', json={
        'user_id': 'u1', 'type': 'in', 'category': '工资', 'amount': 8000,
    })
    assert r.status_code == 200


def test_bad_type(client):
    r = client.post('/accounting', json={
        'user_id': 'u1', 'type': 'other', 'category': '餐饮', 'amount': 10,
    })
    assert r.status_code == 400


def test_negative_amount(client):
    r = client.post('/accounting', json={
        'user_id': 'u1', 'type': 'out', 'category': '餐饮', 'amount': -5,
    })
    assert r.status_code == 400


def test_zero_amount(client):
    r = client.post('/accounting', json={
        'user_id': 'u1', 'type': 'out', 'category': '餐饮', 'amount': 0,
    })
    assert r.status_code == 400


def test_non_numeric(client):
    r = client.post('/accounting', json={
        'user_id': 'u1', 'type': 'out', 'category': '餐饮', 'amount': 'abc',
    })
    assert r.status_code == 400


def test_totals(client):
    client.post('/accounting', json={'user_id': 'u1', 'type': 'in', 'category': '工资', 'amount': 8000})
    client.post('/accounting', json={'user_id': 'u1', 'type': 'out', 'category': '餐饮', 'amount': 30})
    client.post('/accounting', json={'user_id': 'u1', 'type': 'out', 'category': '交通', 'amount': 12})

    data = client.get('/accounting?user_id=u1').json()
    assert data['total_in'] == 8000.0
    assert data['total_out'] == 42.0
    assert data['balance'] == 7958.0


def test_delete(client):
    new_id = client.post('/accounting', json={
        'user_id': 'u1', 'type': 'out', 'category': '餐饮', 'amount': 10,
    }).json()['id']
    r = client.delete(f'/accounting/{new_id}?user_id=u1')
    assert r.status_code == 200
    assert client.get('/accounting?user_id=u1').json()['records'] == []


def test_delete_nonexistent(client):
    assert client.delete('/accounting/99999?user_id=u1').status_code == 404


def test_stats(client):
    client.post('/accounting', json={'user_id': 'u1', 'type': 'out', 'category': '餐饮', 'amount': 20})
    client.post('/accounting', json={'user_id': 'u1', 'type': 'out', 'category': '餐饮', 'amount': 30})
    client.post('/accounting', json={'user_id': 'u1', 'type': 'out', 'category': '交通', 'amount': 15})
    client.post('/accounting', json={'user_id': 'u1', 'type': 'in', 'category': '工资', 'amount': 100})

    stats = client.get('/accounting/stats?user_id=u1').json()
    food = next(e for e in stats['expense'] if e['category'] == '餐饮')
    assert food['total'] == 50.0
    assert food['count'] == 2


def test_isolation(client):
    client.post('/accounting', json={'user_id': 'alice', 'type': 'out', 'category': 'x', 'amount': 10})
    client.post('/accounting', json={'user_id': 'bob', 'type': 'out', 'category': 'x', 'amount': 20})
    a = client.get('/accounting?user_id=alice').json()
    b = client.get('/accounting?user_id=bob').json()
    assert a['total_out'] == 10 and b['total_out'] == 20


def test_health_and_config(client):
    r = client.get('/health')
    assert r.status_code == 200 and r.json()['status'] == 'ok'

    r = client.get('/config')
    assert r.status_code == 200
    data = r.json()
    assert 'provider' in data
    assert 'has_claude_key' in data
    assert len(data['emotions']) == 11  # 保持 11 种
