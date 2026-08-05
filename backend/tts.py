"""Fish Audio TTS —— 沿用完整版的稳定参数

只做 TTS，不做 STT（公开版把语音转文字砍了）。
"""
import base64
import requests

from . import config as cfg

# 沿用原版稳定参数（原注释：温度越低越贴克隆源）
TTS_TEMPERATURE = 0.4
TTS_TOP_P = 0.7


def fish_tts(text: str, emotion: str = '平静', voice_id: str = None) -> bytes:
    """调 Fish Audio API 合成语音，返回 mp3 bytes。"""
    if not cfg.FISH_KEY:
        raise RuntimeError('FISH_KEY 未配置')

    tag = cfg.EMOTION_TAGS.get(emotion, '')
    prefix = '。 '
    final_text = f'{prefix}{tag} {text}' if tag else f'{prefix}{text}'

    text_len = len(text)
    if text_len < 15:
        chunk_length = 100
    elif text_len < 30:
        chunk_length = 150
    else:
        chunk_length = 200

    actual_voice_id = voice_id or cfg.FISH_VOICE_ID
    if not actual_voice_id:
        raise RuntimeError('voice_id 缺失（角色未设置 voice_id，也没有默认 FISH_VOICE_ID）')

    resp = requests.post(
        'https://api.fish.audio/v1/tts',
        headers={
            'Authorization': f'Bearer {cfg.FISH_KEY}',
            'Content-Type': 'application/json',
        },
        json={
            'text': final_text,
            'reference_id': actual_voice_id,
            'format': 'mp3',
            'latency': 'normal',
            'chunk_length': chunk_length,
            'temperature': TTS_TEMPERATURE,
            'top_p': TTS_TOP_P,
            'mp3_bitrate': 128,
            'prosody': {'speed': 1.15, 'volume': 0},
        },
        stream=True,
        timeout=60,
    )
    if resp.status_code != 200:
        raise RuntimeError(f'Fish Audio {resp.status_code}: {resp.text[:200]}')
    return b''.join(resp.iter_content(chunk_size=4096))


def tts_to_b64(text: str, emotion: str = '平静', voice_id: str = None) -> str:
    """失败时返回空串，不抛异常（前端根据空串判断跳过播放）。"""
    try:
        audio = fish_tts(text, emotion, voice_id)
        return base64.b64encode(audio).decode()
    except Exception as e:
        print(f'[TTS fail] {text[:30]!r} | {e}')
        return ''
