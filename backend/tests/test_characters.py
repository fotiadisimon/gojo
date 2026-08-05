"""角色 CRUD 测试"""


def test_seed_default_on_first_get(client):
    """空 DB 上调 /characters 之前，seed 应已跑（在 create_app 里）"""
    r = client.get('/characters')
    assert r.status_code == 200
    chars = r.json()['characters']
    assert any(c['id'] == 'default' for c in chars)


def test_create(client):
    r = client.post('/characters', json={
        'id': 'gojo', 'name': '五条悟',
        'core_prompt': '你是五条悟，慵懒毒舌', 'greeting': '哟',
        'avatar_emoji': '🕶️',
    })
    assert r.status_code == 200
    r = client.get('/characters/gojo')
    assert r.status_code == 200
    assert r.json()['name'] == '五条悟'


def test_upsert(client):
    client.post('/characters', json={
        'id': 'g', 'name': 'g1', 'core_prompt': 'p1',
    })
    client.post('/characters', json={
        'id': 'g', 'name': 'g2', 'core_prompt': 'p2',
    })
    r = client.get('/characters/g').json()
    assert r['name'] == 'g2' and r['core_prompt'] == 'p2'


def test_bad_id(client):
    r = client.post('/characters', json={
        'id': '带空 格', 'name': 'x', 'core_prompt': 'y',
    })
    assert r.status_code == 400


def test_empty_name(client):
    r = client.post('/characters', json={
        'id': 'ok_id', 'name': '', 'core_prompt': 'y',
    })
    assert r.status_code == 400


def test_empty_prompt(client):
    r = client.post('/characters', json={
        'id': 'ok_id', 'name': 'x', 'core_prompt': '',
    })
    assert r.status_code == 400


def test_delete(client):
    client.post('/characters', json={'id': 'tmp', 'name': 't', 'core_prompt': 'p'})
    r = client.delete('/characters/tmp')
    assert r.status_code == 200
    assert client.get('/characters/tmp').status_code == 404


def test_delete_nonexistent(client):
    assert client.delete('/characters/nope').status_code == 404


def test_chat_uses_character_prompt(client, monkeypatch):
    """/chat/text 传 character_id 时，system prompt 里应该用该角色的 core_prompt"""
    client.post('/characters', json={
        'id': 'test_char', 'name': 'T', 'core_prompt': '独特的人设标识 XYZ_UNIQUE',
    })

    captured = {}
    def _mock(system_prompt, messages, **kw):
        captured['sys'] = system_prompt
        import json
        return json.dumps({'emotion': '平静', 'content': 'ok'})
    monkeypatch.setattr('backend.route_chat.call_llm', _mock)

    client.post('/chat/text', json={
        'text': 'hi', 'user_id': 'u1', 'character_id': 'test_char',
    })
    assert 'XYZ_UNIQUE' in captured['sys']


def test_chat_history_isolated_by_character(client, monkeypatch):
    """不同角色的聊天历史互不影响"""
    import json
    client.post('/characters', json={'id': 'a', 'name': 'A', 'core_prompt': 'x'})
    client.post('/characters', json={'id': 'b', 'name': 'B', 'core_prompt': 'y'})

    monkeypatch.setattr(
        'backend.route_chat.call_llm',
        lambda *a, **k: json.dumps({'emotion': '平静', 'content': 'ok'})
    )
    client.post('/chat/text', json={'text': 'msg-to-A', 'user_id': 'u1', 'character_id': 'a'})
    client.post('/chat/text', json={'text': 'msg-to-B', 'user_id': 'u1', 'character_id': 'b'})

    a_hist = client.get('/chat/history?user_id=u1&character_id=a').json()['history']
    b_hist = client.get('/chat/history?user_id=u1&character_id=b').json()['history']
    assert any(m['content'] == 'msg-to-A' for m in a_hist)
    assert not any(m['content'] == 'msg-to-A' for m in b_hist)
