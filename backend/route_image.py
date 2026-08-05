"""图片聊天路由：/chat/image

用 Claude Vision 让 AI"看图说话"。
DeepSeek 不支持视觉输入，所以：LLM_PROVIDER=deepseek 时这个端点会返回 400。
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from . import config as cfg
from .characters import get_character
from .db import get_conn
from .prompt import build_system_prompt
from .utils import extract_json, safe_str

router = APIRouter()

HISTORY_TURNS = 8


def _resolve(char_id):
    char = get_character(char_id) if char_id else None
    if char:
        return char['id'], char['core_prompt']
    default = get_character('default')
    if default:
        return default['id'], default['core_prompt']
    return 'default', cfg.CHARACTER_PROMPT


@router.post('/chat/image')
async def chat_image(data: dict):
    if cfg.LLM_PROVIDER != 'claude':
        return JSONResponse(
            {'error': f'图片聊天目前只支持 Claude；当前 provider 是 {cfg.LLM_PROVIDER}'},
            status_code=400,
        )
    if not cfg.ANTHROPIC_API_KEY:
        return JSONResponse({'error': 'ANTHROPIC_API_KEY 未设置'}, status_code=500)

    user_id = safe_str(data.get('user_id'), 'default')
    character_id = safe_str(data.get('character_id'), 'default')
    image_b64 = safe_str(data.get('image_base64'))
    media_type = safe_str(data.get('media_type'), 'image/jpeg')
    user_text = safe_str(data.get('text'))

    if not image_b64:
        return JSONResponse({'error': 'no image'}, status_code=400)

    char_id, core_prompt = _resolve(character_id)

    # 拉最近 8 条上下文
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            '''SELECT role, content FROM chat_history
               WHERE user_id = ? AND character_id = ?
               ORDER BY id DESC LIMIT ?''',
            (user_id, char_id, HISTORY_TURNS),
        )
        rows = cur.fetchall()
    history = [{'role': r['role'], 'content': r['content']} for r in reversed(rows)]

    # 组装多模态 user message
    content_blocks = [
        {'type': 'image', 'source': {'type': 'base64', 'media_type': media_type, 'data': image_b64}},
    ]
    if user_text:
        content_blocks.append({'type': 'text', 'text': user_text})
    else:
        content_blocks.append({'type': 'text', 'text': '看看这张图片，说说你的想法。'})

    messages = history + [{'role': 'user', 'content': content_blocks}]

    try:
        import anthropic
    except ImportError:
        return JSONResponse({'error': 'anthropic 未安装'}, status_code=500)

    client = anthropic.Anthropic(api_key=cfg.ANTHROPIC_API_KEY)
    system_prompt = build_system_prompt(core_prompt, user_text or '[用户发了一张图片]')

    try:
        resp = client.messages.create(
            model=cfg.CLAUDE_MODEL,
            max_tokens=1500,
            temperature=0.8,
            system=system_prompt,
            messages=messages,
        )
        raw = resp.content[0].text
    except Exception as e:
        return JSONResponse({'error': f'Claude Vision 调用失败：{e}'}, status_code=500)

    parsed = extract_json(raw)
    if parsed and isinstance(parsed, dict):
        emotion = safe_str(parsed.get('emotion'), '平静')
        content = safe_str(parsed.get('content')) or raw.strip()
        if emotion not in cfg.EMOTIONS:
            emotion = '平静'
    else:
        emotion = '平静'
        content = raw.strip()

    # 落库：user 的图片消息用固定占位文本记录（不存 base64，太大）
    user_record = user_text or '[图片]'
    with get_conn() as conn:
        conn.execute(
            '''INSERT INTO chat_history (user_id, character_id, role, content, emotion)
               VALUES (?, ?, ?, ?, ?)''',
            (user_id, char_id, 'user', user_record, None),
        )
        conn.execute(
            '''INSERT INTO chat_history (user_id, character_id, role, content, emotion)
               VALUES (?, ?, ?, ?, ?)''',
            (user_id, char_id, 'assistant', content, emotion),
        )

    return JSONResponse({
        'emotion': emotion,
        'content': content,
        'character_id': char_id,
    })
