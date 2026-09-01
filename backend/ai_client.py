"""统一 LLM 客户端 adapter —— 让代码不用管走 Anthropic 还是 DeepSeek

★ v3：Provider 优先，避免中转 API 用户被劫持到官方 Anthropic
  用户在 App 里选了 provider=deepseek → 所有请求走 OpenAI 兼容路径
  (可以是 deepseek 官方,也可以是任何中转 tdyun/anyrouter/oneapi 等)
  用户选 claude → 所有走官方 Anthropic 直连
  没选 → 按 model 前缀分派(向下兼容)

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

按 provider(优先) 或 model 前缀(兜底) 分发:
- provider=deepseek → OpenAI 兼容接口(可指向中转) —— 不管模型前缀
- provider=claude   → Anthropic 原生 SDK —— 不管模型前缀
- 未设 provider,按前缀:
  - 'claude-*' / 'anthropic-*' → Anthropic
  - 其他 → OpenAI 兼容
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
    """统一接口,自动分发到 Anthropic 或 DeepSeek(OpenAI 兼容)。

    ★ v3: 分派优先级
       1. LLM_PROVIDER=deepseek → 强制走 _call_deepseek(打中转/DeepSeek 官方)
       2. LLM_PROVIDER=claude → 强制走 _call_anthropic(官方直连)
       3. 未设 provider → 按 model 前缀(claude-/anthropic- 走 Anthropic, 其他走 OpenAI)

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
    provider = _clean('LLM_PROVIDER', '').lower()

    if not model:
        # 没传模型名时按当前 provider 猜一个合理默认
        model = ('deepseek-chat' if provider == 'deepseek'
                 else _clean('MODEL_JP_AUX', 'claude-haiku-4-5-20251001'))

    # ★ v3: Provider 明确指定时,尊重用户选择(中转场景关键)
    #   用户设 deepseek 就代表她想走 OpenAI 兼容接口(不管模型叫啥),
    #   避免 claude-* 前缀被强制劫持到官方 Anthropic。
    if provider == 'deepseek':
        return _call_deepseek(model, messages, system, max_tokens, temperature)
    if provider == 'claude':
        return _call_anthropic(model, messages, system, max_tokens, temperature)

    # ★ 未设 provider,按模型前缀分派(向下兼容旧用户)
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

    body = resp.text.strip()
    # ★ 诊断：中转 API 出问题时把真实返回打出来，否则只能看到 JSONDecodeError 猜不到原因
    if resp.status_code != 200 or not body or body[0] not in '{[':
        print(f'[ai_client] ⚠️ 异常响应 model={model} url={base_url} '
              f'status={resp.status_code} ct={resp.headers.get("content-type")} '
              f'len={len(body)} body={body[:500]!r}')
        raise RuntimeError(
            f'中转 API 返回非 JSON (status={resp.status_code}, '
            f'model={model}): {body[:200] or "空响应"}')
    data = json.loads(body)
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