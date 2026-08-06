"""统一 LLM 调用接口。

所有配置走 cfg.get() —— 用户在 App 设置页改了 key/provider，下一次调用立刻生效。
"""
from . import config as cfg


class LLMError(Exception):
    pass


def call_llm(system_prompt: str, messages: list, max_tokens: int = 1500,
             temperature: float = 0.8) -> str:
    provider = (cfg.get('LLM_PROVIDER') or 'claude').lower()
    if provider == 'claude':
        return _call_claude(system_prompt, messages, max_tokens, temperature)
    elif provider == 'deepseek':
        return _call_deepseek(system_prompt, messages, max_tokens, temperature)
    else:
        raise LLMError(f'unknown LLM_PROVIDER: {provider}')


def _call_claude(system_prompt, messages, max_tokens, temperature):
    api_key = cfg.get('ANTHROPIC_API_KEY')
    if not api_key:
        raise LLMError('ANTHROPIC_API_KEY 未设置')
    try:
        import anthropic
    except ImportError as e:
        raise LLMError(f'anthropic 未安装：{e}')

    client = anthropic.Anthropic(api_key=api_key)
    try:
        resp = client.messages.create(
            model=cfg.get('CLAUDE_MODEL') or 'claude-sonnet-4-5-20250929',
            max_tokens=max_tokens,
            temperature=temperature,
            system=system_prompt,
            messages=messages,
        )
        return resp.content[0].text
    except Exception as e:
        raise LLMError(f'Claude 调用失败：{e}')


def _call_deepseek(system_prompt, messages, max_tokens, temperature):
    api_key = cfg.get('DEEPSEEK_API_KEY')
    if not api_key:
        raise LLMError('DEEPSEEK_API_KEY 未设置')
    try:
        from openai import OpenAI
    except ImportError as e:
        raise LLMError(f'openai 未安装：{e}')

    base_url = cfg.get('DEEPSEEK_BASE_URL') or 'https://api.deepseek.com/v1'
    client = OpenAI(api_key=api_key, base_url=base_url)
    full_msgs = [{'role': 'system', 'content': system_prompt}] + messages
    try:
        resp = client.chat.completions.create(
            model=cfg.get('DEEPSEEK_MODEL') or 'deepseek-chat',
            max_tokens=max_tokens,
            temperature=temperature,
            messages=full_msgs,
        )
        return resp.choices[0].message.content or ''
    except Exception as e:
        raise LLMError(f'DeepSeek 调用失败：{e}')
