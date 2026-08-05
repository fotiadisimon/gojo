"""聊天路由测试。用 monkeypatch 替换 call_llm，不打真 API。"""
import json
import pytest
from backend.llm import LLMError


def _mock_llm(response_json):
    def _fn(system_prompt, messages, **kw):
        return json.dumps(response_json, ensure_ascii=False)
    return _fn


def test_chat_success(client, monkeypatch):
    monkeypatch.setattr(
        'backend.route_chat.call_llm',
        _mock_llm({'emotion': '开心', 'content': '你好呀'})
    )
    r = client.post('/chat/text', json={'text': 'hi', 'user_id': 'u1'})
    assert r.status_code == 200
    data = r.json()
    assert data['emotion'] == '开心'
    assert data['content'] == '你好呀'


def test_chat_empty_input(client):
    r = client.post('/chat/text', json={'text': '', 'user_id': 'u1'})
    assert r.status_code == 400


def test_chat_invalid_emotion_fallback(client, monkeypatch):
    monkeypatch.setattr(
        'backend.route_chat.call_llm',
        _mock_llm({'emotion': '狂喜', 'content': 'ok'})  # 不在 11 种里
    )
    r = client.post('/chat/text', json={'text': 'x', 'user_id': 'u1'})
    assert r.json()['emotion'] == '平静'


def test_chat_llm_error(client, monkeypatch):
    def _boom(*a, **k):
        raise LLMError('key missing')
    monkeypatch.setattr('backend.route_chat.call_llm', _boom)
    r = client.post('/chat/text', json={'text': 'x', 'user_id': 'u1'})
    assert r.status_code == 500
    assert 'key missing' in r.json()['error']


def test_chat_history_flow(client, monkeypatch):
    monkeypatch.setattr(
        'backend.route_chat.call_llm',
        _mock_llm({'emotion': '平静', 'content': 'reply1'})
    )
    client.post('/chat/text', json={'text': 'first', 'user_id': 'u_hist'})
    client.post('/chat/text', json={'text': 'second', 'user_id': 'u_hist'})

    r = client.get('/chat/history?user_id=u_hist')
    hist = r.json()['history']
    assert len(hist) == 4  # 2 轮 = 2 user + 2 assistant
    assert hist[0]['role'] == 'user'
    assert hist[0]['content'] == 'first'


def test_clear_history(client, monkeypatch):
    monkeypatch.setattr(
        'backend.route_chat.call_llm',
        _mock_llm({'emotion': '平静', 'content': 'hi'})
    )
    client.post('/chat/text', json={'text': 'a', 'user_id': 'u_clr'})
    client.delete('/chat/history?user_id=u_clr')
    r = client.get('/chat/history?user_id=u_clr')
    assert r.json()['history'] == []


def test_chat_non_json_fallback(client, monkeypatch):
    """模型直接回了普通文本没走 JSON 也不能崩"""
    def _plain(*a, **k):
        return '这是纯文本的回复'
    monkeypatch.setattr('backend.route_chat.call_llm', _plain)
    r = client.post('/chat/text', json={'text': 'x', 'user_id': 'u1'})
    assert r.status_code == 200
    assert r.json()['emotion'] == '平静'
    assert '纯文本' in r.json()['content']


def test_chat_isolates_users(client, monkeypatch):
    monkeypatch.setattr(
        'backend.route_chat.call_llm',
        _mock_llm({'emotion': '平静', 'content': 'ok'})
    )
    client.post('/chat/text', json={'text': 'alice-msg', 'user_id': 'alice'})
    client.post('/chat/text', json={'text': 'bob-msg', 'user_id': 'bob'})

    a = client.get('/chat/history?user_id=alice').json()['history']
    b = client.get('/chat/history?user_id=bob').json()['history']
    assert any(m['content'] == 'alice-msg' for m in a)
    assert not any(m['content'] == 'alice-msg' for m in b)
