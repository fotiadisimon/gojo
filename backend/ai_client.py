"""统一 LLM 客户端 adapter —— 让代码不用管走 Anthropic 还是 DeepSeek

★ v2：所有配置改为运行时读 config.get_setting()，
  这样在 App 设置页里改 key / base_url / 模型，下一次调用立刻生效，
  不用重启服务、不用动 Zeabur 环境变量。

用法:
    from ai_client import create_chat
    import config
    text, usage = create_chat(
        model=config.get_setting('MODEL_CN_AUX'),
        messages=[{'role': 'user', 'content': '...'}],
        max_tokens=400,
    )

按 model 前缀分发:
- 'claude-*' / 'anthropic-*' → Anthropic 原生 SDK
- 其他（deepseek-* / gemini-* / gemma-* …）→ OpenAI 兼容接口，
  具体连哪家由 DEEPSEEK_BASE_URL 决定
"""
import json
import requests
import anthropic
import config

DEFAULT_DEEPSEEK_BASE = 'https://api.deepseek.com'


def _clean(key: str, fallback: str = '') -> str:
    """取配置并去空白；空值回退到 fallback。
    ★ 必须有这层——settings 表里可能存了空串，直接用会让 httpx 报
      'Request URL is missing an http:// or https:// protocol'。"""
    v = config.get_setting(key)
    v = (v or '').strip()
    return v or fallback


def create_chat(model, messages, system=None, max_tokens=1000, temperature=None):
    """统一接口,自动按 model 前缀分发到 Anthropic 或 DeepSeek。

    Args:
        model: 'claude-*' 走 Anthropic,'deepseek-*' 走 DS
        messages: [{'role': 'user'|'assistant', 'content': str}]
        system: str 或 None(简化版,不支持 blocks + cache_control)
        max_tokens: 输出上限
        temperature: None = provider 默认

    Returns:
        (raw_text: str, usage_info: dict {input_tokens, output_tokens})

    Raises:
        RuntimeError: provider 报错时抛出
    """
    model = (model or '').strip()
    if not model:
        # 没传模型名时按当前 provider 猜一个合理默认
        provider = _clean('LLM_PROVIDER', 'claude').lower()
        model = ('deepseek-chat' if provider == 'deepseek'
                 else _clean('MODEL_JP_AUX', 'claude-haiku-4-5-20251001'))

    if model.startswith('claude-') or model.startswith('anthropic-'):
        return _call_anthropic(model, messages, system, max_tokens, temperature)
    # ★ deepseek / gemini / gemma / 其他 OpenAI 兼容接口都走同一条路
    #   （Gemini 提供 OpenAI 兼容层，base_url 指过去就能用）
    return _call_deepseek(model, messages, system, max_tokens, temperature)


def _call_anthropic(model, messages, system, max_tokens, temperature):
    api_key = _clean('ANTHROPIC_KEY')
    if not api_key:
        raise RuntimeError('ANTHROPIC_KEY 未配置,无法调用 Claude')
    client = anthropic.Anthropic(api_key=api_key)
    kwargs = {
        'model': model,
        'max_tokens': max_tokens,
        'messages': messages,
    }
    if system:
        kwargs['system'] = system
    if temperature is not None:
        kwargs['temperature'] = temperature
    resp = client.messages.create(**kwargs)
    text = resp.content[0].text if resp.content else ''
    return text, {
        'input_tokens': getattr(resp.usage, 'input_tokens', 0),
        'output_tokens': getattr(resp.usage, 'output_tokens', 0),
        'provider': 'anthropic',
    }


def _call_deepseek(model, messages, system, max_tokens, temperature):
    api_key = _clean('DEEPSEEK_KEY')
    if not api_key:
        raise RuntimeError('DEEPSEEK_KEY 未配置,无法调用 DeepSeek')

    # ★ base_url 必须带协议
    base_url = _clean('DEEPSEEK_BASE_URL', DEFAULT_DEEPSEEK_BASE)
    if not base_url.startswith('http'):
        base_url = DEFAULT_DEEPSEEK_BASE

    payload_messages = []
    if system:
        payload_messages.append({'role': 'system', 'content': system})
    payload_messages.extend(messages)

    payload = {
        'model': model,
        'messages': payload_messages,
        'max_tokens': max_tokens,
    }
    if temperature is not None:
        payload['temperature'] = temperature

    try:
        resp = requests.post(
            f'{base_url.rstrip("/")}/chat/completions',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
            },
            json=payload,
            timeout=90,
        )
    except requests.RequestException as e:
        raise RuntimeError(f'DeepSeek 网络异常: {e}')

    if resp.status_code != 200:
        raise RuntimeError(f'DeepSeek API {resp.status_code}: {resp.text[:300]}')
    data = resp.json()
    try:
        choice = data['choices'][0]
        msg = choice.get('message', {})
        text = msg.get('content') or ''
        finish = choice.get('finish_reason', '')

        # ★ 推理模型(deepseek-v4-flash 等)会先吐一大段 reasoning_content,
        #   思考把 max_tokens 吃光后 content 就空了 / 被截断。
        reasoning = msg.get('reasoning_content') or ''
        if reasoning and not text.strip():
            print(f'[ai_client] ⚠️ {model} 的 token 全被思考吃掉了'
                  f'(思考 {len(reasoning)} 字, 正文 0 字, finish={finish})'
                  f' → 请调大 max_tokens')
        elif finish == 'length':
            print(f'[ai_client] ⚠️ {model} 输出被 max_tokens 截断'
                  f'(正文 {len(text)} 字{", 思考 " + str(len(reasoning)) + " 字" if reasoning else ""})'
                  f' → 请调大 max_tokens')
    except (KeyError, IndexError):
        raise RuntimeError(f'DeepSeek 响应结构异常: {json.dumps(data)[:300]}')
    usage = data.get('usage', {})
    return text, {
        'input_tokens': usage.get('prompt_tokens', 0),
        'output_tokens': usage.get('completion_tokens', 0),
        'finish_reason': finish,
        'provider': 'deepseek',
    }