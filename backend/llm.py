"""统一 LLM 调用入口 —— 同时支持 Claude 和 DeepSeek"""
import config


class LLMError(Exception):
    pass


def call_llm(system_prompt: str, messages: list, max_tokens: int = 1500,
             temperature: float = 0.8, prefer_fast: bool = False) -> str:
    """prefer_fast=True 用便宜的小模型（记忆提取、日记生成等后台任务）"""
    provider = (config.LLM_PROVIDER or 'claude').lower()
    if provider == 'deepseek':
        return _deepseek(system_prompt, messages, max_tokens, temperature)
    return _claude(system_prompt, messages, max_tokens, temperature, prefer_fast)


def _claude(system_prompt, messages, max_tokens, temperature, prefer_fast=False):
    if not config.ANTHROPIC_KEY:
        raise LLMError('ANTHROPIC_KEY 未设置')
    import anthropic
    client = anthropic.Anthropic(api_key=config.ANTHROPIC_KEY)
    model = config.MODEL_AUX if prefer_fast else config.MODEL_MAIN
    try:
        resp = client.messages.create(
            model=model, max_tokens=max_tokens, temperature=temperature,
            system=system_prompt, messages=messages,
        )
        return resp.content[0].text
    except Exception as e:
        raise LLMError(f'Claude 调用失败：{e}')


def _deepseek(system_prompt, messages, max_tokens, temperature):
    if not config.DEEPSEEK_KEY:
        raise LLMError('DEEPSEEK_KEY 未设置')
    from openai import OpenAI
    client = OpenAI(api_key=config.DEEPSEEK_KEY, base_url=config.DEEPSEEK_BASE_URL)
    full = [{'role': 'system', 'content': system_prompt}] + messages
    try:
        resp = client.chat.completions.create(
            model=config.DEEPSEEK_MODEL, max_tokens=max_tokens,
            temperature=temperature, messages=full,
        )
        return resp.choices[0].message.content or ''
    except Exception as e:
        raise LLMError(f'DeepSeek 调用失败：{e}')


def supports_vision() -> bool:
    """图片聊天只有 Claude 支持"""
    return (config.LLM_PROVIDER or 'claude').lower() == 'claude'