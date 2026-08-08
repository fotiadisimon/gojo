"""统一 LLM 调用入口 —— 同时支持 Claude 和 DeepSeek

配置走 config.get_setting()，所以在 App 设置页改完 key/provider，
下一次调用立刻生效，不用重启服务。
"""
import config

DEFAULT_DEEPSEEK_BASE = 'https://api.deepseek.com'


class LLMError(Exception):
    pass


def _clean(key: str, fallback: str = '') -> str:
    """取配置并去空白；空值回退到 fallback。"""
    v = config.get_setting(key)
    v = (v or '').strip()
    return v or fallback


def call_llm(system_prompt: str, messages: list, max_tokens: int = 1500,
             temperature: float = 0.8, prefer_fast: bool = False) -> str:
    """prefer_fast=True 用便宜的小模型（记忆提取、日记生成等后台任务）"""
    provider = _clean('LLM_PROVIDER', 'claude').lower()
    if provider == 'deepseek':
        return _deepseek(system_prompt, messages, max_tokens, temperature)
    return _claude(system_prompt, messages, max_tokens, temperature, prefer_fast)


def _claude(system_prompt, messages, max_tokens, temperature, prefer_fast=False):
    api_key = _clean('ANTHROPIC_KEY')
    if not api_key:
        raise LLMError('ANTHROPIC_KEY 未设置')
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    model = (_clean('MODEL_JP_AUX', 'claude-haiku-4-5-20251001') if prefer_fast
             else _clean('MODEL_MAIN', 'claude-sonnet-4-5-20250929'))
    try:
        resp = client.messages.create(
            model=model, max_tokens=max_tokens, temperature=temperature,
            system=system_prompt, messages=messages,
        )
        return resp.content[0].text
    except Exception as e:
        raise LLMError(f'Claude 调用失败：{e}')


def _deepseek(system_prompt, messages, max_tokens, temperature):
    api_key = _clean('DEEPSEEK_KEY')
    if not api_key:
        raise LLMError('DEEPSEEK_KEY 未设置')

    # ★ base_url 必须带协议，否则 httpx 直接报 UnsupportedProtocol
    base_url = _clean('DEEPSEEK_BASE_URL', DEFAULT_DEEPSEEK_BASE)
    if not base_url.startswith('http'):
        base_url = DEFAULT_DEEPSEEK_BASE

    from openai import OpenAI
    client = OpenAI(api_key=api_key, base_url=base_url)
    full = [{'role': 'system', 'content': system_prompt}] + messages
    try:
        resp = client.chat.completions.create(
            model=_clean('DEEPSEEK_MODEL', 'deepseek-chat'),
            max_tokens=max_tokens, temperature=temperature, messages=full,
        )
        return resp.choices[0].message.content or ''
    except Exception as e:
        raise LLMError(f'DeepSeek 调用失败：{e}')


def supports_vision() -> bool:
    """图片聊天只有 Claude 支持"""
    return _clean('LLM_PROVIDER', 'claude').lower() == 'claude'