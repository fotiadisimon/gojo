"""LLM 分发测试"""
import pytest
from backend import config as cfg
from backend.llm import call_llm, LLMError


def _patch_cfg(monkeypatch, overrides: dict):
    original_get = cfg.get
    def _mock_get(key):
        if key in overrides:
            return overrides[key]
        return original_get(key)
    monkeypatch.setattr(cfg, 'get', _mock_get)


def test_unknown_provider(monkeypatch):
    _patch_cfg(monkeypatch, {'LLM_PROVIDER': 'gemini'})
    with pytest.raises(LLMError):
        call_llm('sys', [{'role': 'user', 'content': 'hi'}])


def test_claude_missing_key(monkeypatch):
    _patch_cfg(monkeypatch, {'LLM_PROVIDER': 'claude', 'ANTHROPIC_API_KEY': ''})
    with pytest.raises(LLMError, match='ANTHROPIC_API_KEY'):
        call_llm('sys', [{'role': 'user', 'content': 'hi'}])


def test_deepseek_missing_key(monkeypatch):
    _patch_cfg(monkeypatch, {'LLM_PROVIDER': 'deepseek', 'DEEPSEEK_API_KEY': ''})
    with pytest.raises(LLMError, match='DEEPSEEK_API_KEY'):
        call_llm('sys', [{'role': 'user', 'content': 'hi'}])


class _FakeContent:
    def __init__(self, text): self.text = text
class _FakeResponse:
    def __init__(self, text): self.content = [_FakeContent(text)]
class _FakeAnthropic:
    last_kwargs = None
    def __init__(self, api_key):
        self.api_key = api_key; self.messages = self
    def create(self, **kw):
        _FakeAnthropic.last_kwargs = kw
        return _FakeResponse('claude replied')


def test_claude_dispatch(monkeypatch):
    _patch_cfg(monkeypatch, {
        'LLM_PROVIDER': 'claude', 'ANTHROPIC_API_KEY': 'test-key', 'CLAUDE_MODEL': 'claude-test',
    })
    import anthropic
    monkeypatch.setattr(anthropic, 'Anthropic', _FakeAnthropic)
    result = call_llm('you are helpful', [{'role': 'user', 'content': 'hi'}])
    assert result == 'claude replied'
    assert _FakeAnthropic.last_kwargs['model'] == 'claude-test'


class _FakeChoice:
    def __init__(self, c): self.message = type('M', (), {'content': c})()
class _FakeChatResp:
    def __init__(self, c): self.choices = [_FakeChoice(c)]
class _FakeChatCompletions:
    def create(self, **kw):
        _FakeOpenAI.last_kwargs = kw
        return _FakeChatResp('deepseek replied')
class _FakeChat:
    def __init__(self): self.completions = _FakeChatCompletions()
class _FakeOpenAI:
    last_kwargs = None
    def __init__(self, api_key, base_url):
        self.api_key = api_key; self.base_url = base_url; self.chat = _FakeChat()


def test_deepseek_dispatch(monkeypatch):
    _patch_cfg(monkeypatch, {
        'LLM_PROVIDER': 'deepseek', 'DEEPSEEK_API_KEY': 'ds-key',
        'DEEPSEEK_MODEL': 'deepseek-test', 'DEEPSEEK_BASE_URL': 'https://api.deepseek.com/v1',
    })
    import openai
    monkeypatch.setattr(openai, 'OpenAI', _FakeOpenAI)
    result = call_llm('sys msg', [{'role': 'user', 'content': 'hi'}])
    assert result == 'deepseek replied'
    assert _FakeOpenAI.last_kwargs['messages'][0] == {'role': 'system', 'content': 'sys msg'}
