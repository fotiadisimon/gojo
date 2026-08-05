"""图片聊天 + TTS 路由的基础测试（不打真 API）"""
import pytest
from backend import config as cfg


def test_tts_no_key(client, monkeypatch):
    monkeypatch.setattr(cfg, 'FISH_KEY', '')
    r = client.post('/tts', json={'text': 'hi'})
    assert r.status_code == 503


def test_tts_empty_text(client, monkeypatch):
    monkeypatch.setattr(cfg, 'FISH_KEY', 'fake-key')
    r = client.post('/tts', json={'text': ''})
    assert r.status_code == 400


def test_tts_bad_emotion_fallback(client, monkeypatch):
    """未知情绪应该回退到平静并继续（这里再 mock 掉 tts_to_b64 返回 fake）"""
    monkeypatch.setattr(cfg, 'FISH_KEY', 'fake-key')
    monkeypatch.setattr('backend.route_tts.tts_to_b64', lambda *a, **kw: 'ZmFrZQ==')
    r = client.post('/tts', json={'text': 'hi', 'emotion': '狂喜'})
    assert r.status_code == 200
    assert r.json()['audio_b64'] == 'ZmFrZQ=='


def test_image_provider_check(client, monkeypatch):
    """provider=deepseek 时，图片端点应拒绝"""
    monkeypatch.setattr(cfg, 'LLM_PROVIDER', 'deepseek')
    r = client.post('/chat/image', json={'image_base64': 'x', 'user_id': 'u1'})
    assert r.status_code == 400


def test_image_missing_image(client, monkeypatch):
    monkeypatch.setattr(cfg, 'LLM_PROVIDER', 'claude')
    monkeypatch.setattr(cfg, 'ANTHROPIC_API_KEY', 'k')
    r = client.post('/chat/image', json={'image_base64': '', 'user_id': 'u1'})
    assert r.status_code == 400
