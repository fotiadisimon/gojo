"""TTS 路由：/tts

前端拿到聊天回复后，把想读的文字 + 情绪 + 角色的 voice_id 发过来合成语音。
分开做而不是塞进 /chat/text 是因为：
  1. 用户可能想开关"要不要念出来"
  2. TTS 可能失败（key 缺、Fish 挂了），不能连带聊天也失败
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from . import config as cfg
from .tts import tts_to_b64
from .utils import safe_str

router = APIRouter()


@router.post('/tts')
async def tts(data: dict):
    text = safe_str(data.get('text'))
    emotion = safe_str(data.get('emotion'), '平静')
    voice_id = safe_str(data.get('voice_id')) or None

    if not text:
        return JSONResponse({'error': 'no text'}, status_code=400)
    if emotion not in cfg.EMOTIONS:
        emotion = '平静'

    if not cfg.get('FISH_KEY'):
        return JSONResponse(
            {'error': 'FISH_KEY 未配置，无法合成语音'},
            status_code=503,
        )

    audio_b64 = tts_to_b64(text, emotion, voice_id)
    if not audio_b64:
        return JSONResponse({'error': 'TTS 合成失败'}, status_code=500)
    return JSONResponse({'audio_b64': audio_b64})
