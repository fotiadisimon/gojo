"""统一 LLM 调用接口，同时支持 Claude 和 DeepSeek。

切换只改 config.py 里的 LLM_PROVIDER；上层业务代码不用动。
"""
from . import config as cfg


class LLMError(Exception):
    """LLM 调用失败（key 缺失、网络、限流等）"""


def call_llm(system_prompt: str, messages: list, max_tokens: int = 1500,
             temperature: float = 0.8) -> str:
    """
    messages 形如 [{'role': 'user'/'assistant', 'content': str}, ...]
    返回模型输出的原始文本（后续由业务层解析 JSON）。
    """
    provider = cfg.LLM_PROVIDER
    if provider == 'claude':
        return _call_claude(system_prompt, messages, max_tokens, temperature)
    elif provider == 'deepseek':
        return _call_deepseek(system_prompt, messages, max_tokens, temperature)
    else:
        raise LLMError(f'unknown LLM_PROVIDER: {provider}')


def _call_claude(system_prompt, messages, max_tokens, temperature):
    if not cfg.ANTHROPIC_API_KEY:
        raise LLMError('ANTHROPIC_API_KEY 未设置')
    try:
        import anthropic
    except ImportError as e:
        raise LLMError(f'anthropic 未安装：{e}')

    client = anthropic.Anthropic(api_key=cfg.ANTHROPIC_API_KEY)
    try:
        resp = client.messages.create(
            model=cfg.CLAUDE_MODEL,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system_prompt,
            messages=messages,
        )
        return resp.content[0].text
    except Exception as e:
        raise LLMError(f'Claude 调用失败：{e}')


def _call_deepseek(system_prompt, messages, max_tokens, temperature):
    if not cfg.DEEPSEEK_API_KEY:
        raise LLMError('DEEPSEEK_API_KEY 未设置')
    try:
        from openai import OpenAI
    except ImportError as e:
        raise LLMError(f'openai 未安装：{e}')

    client = OpenAI(api_key=cfg.DEEPSEEK_API_KEY, base_url=cfg.DEEPSEEK_BASE_URL)
    # DeepSeek 兼容 OpenAI 协议：system 拼在 messages 头部
    full_msgs = [{'role': 'system', 'content': system_prompt}] + messages
    try:
        resp = client.chat.completions.create(
            model=cfg.DEEPSEEK_MODEL,
            max_tokens=max_tokens,
            temperature=temperature,
            messages=full_msgs,
        )
        return resp.choices[0].message.content or ''
    except Exception as e:
        raise LLMError(f'DeepSeek 调用失败：{e}')
