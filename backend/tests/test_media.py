"""图片聊天 + TTS 路由的基础测试（不打真 API）"""
from backend import config as cfg


def _patch_cfg(monkeypatch, overrides: dict):
    """用 monkeypatch 替换 cfg.get() 让它返回我们想要的值"""
    original_get = cfg.get
    def _mock_get(key):
        if key in overrides:
            return overrides[key]
        return original_get(key)
    monkeypatch.setattr(cfg, 'get', _mock_get)


def test_tts_no_key(client, monkeypatch):
    _patch_cfg(monkeypatch, {'FISH_KEY': ''})
    r = client.post('/tts', json={'text': 'hi'})
    assert r.status_code == 503


def test_tts_empty_text(client, monkeypatch):
    _patch_cfg(monkeypatch, {'FISH_KEY': 'fake-key'})
    r = client.post('/tts', json={'text': ''})
    assert r.status_code == 400


def test_tts_bad_emotion_fallback(client, monkeypatch):
    _patch_cfg(monkeypatch, {'FISH_KEY': 'fake-key'})
    monkeypatch.setattr('backend.route_tts.tts_to_b64', lambda *a, **kw: 'ZmFrZQ==')
    r = client.post('/tts', json={'text': 'hi', 'emotion': '狂喜'})
    assert r.status_code == 200
    assert r.json()['audio_b64'] == 'ZmFrZQ=='


def test_image_provider_check(client, monkeypatch):
    _patch_cfg(monkeypatch, {'LLM_PROVIDER': 'deepseek'})
    r = client.post('/chat/image', json={'image_base64': 'x', 'user_id': 'u1'})
    assert r.status_code == 400


def test_image_missing_image(client, monkeypatch):
    _patch_cfg(monkeypatch, {'LLM_PROVIDER': 'claude', 'ANTHROPIC_API_KEY': 'k'})
    r = client.post('/chat/image', json={'image_base64': '', 'user_id': 'u1'})
    assert r.status_code == 400
