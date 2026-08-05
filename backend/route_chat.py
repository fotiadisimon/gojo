"""聊天路由：/chat/text /chat/history /chat/clear

只保留文本聊天。原版的 /chat/story、/chat/voice_*、/chat/image、/chat/proactive
全部拿掉——那些依赖 TTS/STT/Fish/Groq，公开版没必要绑死。
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from . import config as cfg
from .characters import get_character
from .db import get_conn
from .llm import call_llm, LLMError
from .prompt import build_system_prompt
from .utils import extract_json, safe_str

router = APIRouter()

# 送进模型的历史条数上限（12 = 6 轮）
HISTORY_TURNS = 12


def _load_history(user_id: str, character_id: str, limit: int):
    """按时间正序返回最近 limit 条历史（同一角色的对话），用来喂模型。"""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            '''SELECT role, content FROM chat_history
               WHERE user_id = ? AND character_id = ?
               ORDER BY id DESC LIMIT ?''',
            (user_id, character_id, limit),
        )
        rows = cur.fetchall()
    rows.reverse()
    return [{'role': r['role'], 'content': r['content']} for r in rows]


def _save_turn(user_id: str, character_id: str, role: str, content: str, emotion: str = None):
    with get_conn() as conn:
        conn.execute(
            '''INSERT INTO chat_history (user_id, character_id, role, content, emotion)
               VALUES (?, ?, ?, ?, ?)''',
            (user_id, character_id, role, content, emotion),
        )


def _resolve_character(character_id: str):
    """
    根据 character_id 查角色；找不到就回退到 default。
    返回 (character_id, core_prompt)。
    """
    char = get_character(character_id) if character_id else None
    if char:
        return char['id'], char['core_prompt']

    default = get_character('default')
    if default:
        return default['id'], default['core_prompt']

    # DB 里都没有 —— 用 config 里的兜底
    return 'default', cfg.CHARACTER_PROMPT


@router.post('/chat/text')
async def chat_text(data: dict):
    user_text = safe_str(data.get('text'))
    user_id = safe_str(data.get('user_id'), 'default')
    character_id = safe_str(data.get('character_id'), 'default')

    if not user_text:
        return JSONResponse({'error': 'no input'}, status_code=400)

    char_id, core_prompt = _resolve_character(character_id)

    history = _load_history(user_id, char_id, HISTORY_TURNS)
    messages = history + [{'role': 'user', 'content': user_text}]

    system_prompt = build_system_prompt(core_prompt, user_text)

    try:
        raw = call_llm(system_prompt, messages, max_tokens=1500, temperature=0.8)
    except LLMError as e:
        return JSONResponse({'error': str(e)}, status_code=500)

    parsed = extract_json(raw)
    if parsed and isinstance(parsed, dict):
        emotion = safe_str(parsed.get('emotion'), '平静')
        content = safe_str(parsed.get('content'))
        if emotion not in cfg.EMOTIONS:
            emotion = '平静'
        if not content:
            content = raw.strip()
    else:
        emotion = '平静'
        content = raw.strip()

    _save_turn(user_id, char_id, 'user', user_text, None)
    _save_turn(user_id, char_id, 'assistant', content, emotion)

    return JSONResponse({
        'emotion': emotion,
        'content': content,
        'character_id': char_id,
        'provider': cfg.LLM_PROVIDER,
    })


@router.get('/chat/history')
async def get_history(user_id: str = 'default', character_id: str = 'default', limit: int = 200):
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            '''SELECT id, role, content, emotion, created_at
               FROM chat_history WHERE user_id = ? AND character_id = ?
               ORDER BY id DESC LIMIT ?''',
            (user_id, character_id, limit),
        )
        rows = [dict(r) for r in cur.fetchall()]
    rows.reverse()
    return JSONResponse({'history': rows})


@router.delete('/chat/history')
async def clear_history(user_id: str = 'default', character_id: str = 'default'):
    with get_conn() as conn:
        conn.execute(
            'DELETE FROM chat_history WHERE user_id = ? AND character_id = ?',
            (user_id, character_id),
        )
    return JSONResponse({'ok': True})
