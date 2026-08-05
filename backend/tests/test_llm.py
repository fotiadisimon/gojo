"""不打真 API，只验证分发逻辑对不对。"""
import pytest
from backend import config as cfg
from backend.llm import call_llm, LLMError


def test_unknown_provider(monkeypatch):
    monkeypatch.setattr(cfg, 'LLM_PROVIDER', 'gemini')
    with pytest.raises(LLMError):
        call_llm('sys', [{'role': 'user', 'content': 'hi'}])


def test_claude_missing_key(monkeypatch):
    monkeypatch.setattr(cfg, 'LLM_PROVIDER', 'claude')
    monkeypatch.setattr(cfg, 'ANTHROPIC_API_KEY', '')
    with pytest.raises(LLMError, match='ANTHROPIC_API_KEY'):
        call_llm('sys', [{'role': 'user', 'content': 'hi'}])


def test_deepseek_missing_key(monkeypatch):
    monkeypatch.setattr(cfg, 'LLM_PROVIDER', 'deepseek')
    monkeypatch.setattr(cfg, 'DEEPSEEK_API_KEY', '')
    with pytest.raises(LLMError, match='DEEPSEEK_API_KEY'):
        call_llm('sys', [{'role': 'user', 'content': 'hi'}])


class _FakeContent:
    def __init__(self, text):
        self.text = text


class _FakeResponse:
    def __init__(self, text):
        self.content = [_FakeContent(text)]


class _FakeAnthropic:
    last_kwargs = None

    def __init__(self, api_key):
        self.api_key = api_key
        self.messages = self

    def create(self, **kwargs):
        _FakeAnthropic.last_kwargs = kwargs
        return _FakeResponse('claude replied')


def test_claude_dispatch(monkeypatch):
    monkeypatch.setattr(cfg, 'LLM_PROVIDER', 'claude')
    monkeypatch.setattr(cfg, 'ANTHROPIC_API_KEY', 'test-key')
    monkeypatch.setattr(cfg, 'CLAUDE_MODEL', 'claude-test')

    import anthropic
    monkeypatch.setattr(anthropic, 'Anthropic', _FakeAnthropic)

    result = call_llm('you are helpful', [{'role': 'user', 'content': 'hi'}])
    assert result == 'claude replied'
    assert _FakeAnthropic.last_kwargs['model'] == 'claude-test'
    assert _FakeAnthropic.last_kwargs['system'] == 'you are helpful'


class _FakeChoice:
    def __init__(self, content):
        self.message = type('M', (), {'content': content})()


class _FakeChatResp:
    def __init__(self, content):
        self.choices = [_FakeChoice(content)]


class _FakeChatCompletions:
    def create(self, **kwargs):
        _FakeOpenAI.last_kwargs = kwargs
        return _FakeChatResp('deepseek replied')


class _FakeChat:
    def __init__(self):
        self.completions = _FakeChatCompletions()


class _FakeOpenAI:
    last_kwargs = None

    def __init__(self, api_key, base_url):
        self.api_key = api_key
        self.base_url = base_url
        self.chat = _FakeChat()


def test_deepseek_dispatch(monkeypatch):
    monkeypatch.setattr(cfg, 'LLM_PROVIDER', 'deepseek')
    monkeypatch.setattr(cfg, 'DEEPSEEK_API_KEY', 'ds-key')
    monkeypatch.setattr(cfg, 'DEEPSEEK_MODEL', 'deepseek-test')
    monkeypatch.setattr(cfg, 'DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1')

    import openai
    monkeypatch.setattr(openai, 'OpenAI', _FakeOpenAI)

    result = call_llm('sys msg', [{'role': 'user', 'content': 'hi'}])
    assert result == 'deepseek replied'
    assert _FakeOpenAI.last_kwargs['model'] == 'deepseek-test'
    # DeepSeek 要把 system 拼进 messages 头部
    assert _FakeOpenAI.last_kwargs['messages'][0] == {'role': 'system', 'content': 'sys msg'}
