"""route_tts.py —— TTS 重合成 + RAG 状态

/tts/resynth：前端点"重播"时，如果本机没有这条消息的音频文件（太老、被清理过、
              或当时 TTS 撞了 429 没生成），就调这里现场重新合成一次。
              → 任何年代的消息都能重播，聊天记录永久可用。
              → 只消耗一点 Fish 额度，不花任何 LLM token。

/rag/status  ：看向量检索有没有启用
/rag/backfill：启用 RAG 后，把历史记忆补上向量（一次性，可重复调）
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse

import config
from characters import get_character
from tts import tts_to_b64
import memory_search

router = APIRouter()


@router.post('/tts/resynth')
async def resynth(data: dict):
    """请求体：{ text: 日语原文, character_id: 'gojo', emotion: '平静'(可选) }"""
    text = (data.get('text') or '').strip()
    character_id = data.get('character_id') or ''
    emotion = data.get('emotion') or '平静'

    if not text:
        return JSONResponse({'error': 'no text'}, status_code=400)

    char = get_character(character_id)
    if not char:
        return JSONResponse({'error': f'character {character_id} not found'}, status_code=404)

    # ★ 角色没单独配音色时，回退到设置页里的全局默认 FISH_VOICE_ID
    voice_id = (char.get('voice_id') or '').strip()
    if not voice_id:
        voice_id = (config.get_setting('FISH_VOICE_ID') or '').strip()
    if not voice_id:
        return JSONResponse(
            {'error': '该角色没配音色，全局默认 Voice ID 也没设置'},
            status_code=400,
        )

    if not (config.get_setting('FISH_KEY') or '').strip():
        return JSONResponse({'error': 'FISH_KEY 未配置'}, status_code=503)

    audio = tts_to_b64(text, emotion, voice_id)
    if not audio:
        # TTS 失败（并发超限/额度问题/key 无效）——前端提示稍后再试即可
        return JSONResponse({'error': 'tts_failed', 'audio_b64': ''}, status_code=503)

    print(f'[resynth] {character_id} | {text[:24]}')
    return JSONResponse({'audio_b64': audio, 'emotion': emotion})


@router.get('/rag/status')
async def rag_status():
    return JSONResponse({
        'use_rag': memory_search.USE_RAG,
        'vector_ready': memory_search.is_vector_ready(),
        'model': memory_search.EMBED_MODEL,
        'dim': memory_search.EMBED_DIM,
        'hint': ('向量检索已启用' if memory_search.is_vector_ready()
                 else '当前用全量注入 + prompt 缓存（记忆量不大时这样更省、也不会漏记）'),
    })


@router.post('/rag/backfill')
async def rag_backfill(data: dict = None):
    limit = int((data or {}).get('limit', 500))
    return JSONResponse(memory_search.backfill_embeddings(limit))