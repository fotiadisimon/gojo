"""Prompt 组装：把用户自定义的 CHARACTER_PROMPT + 时间上下文 + 情绪模板拼起来。

这一版把原版所有和 gojo 强绑定的东西（canon_lock、角色文件夹、seed_gojo_character）
都拿掉了——用户在 config.py / config.json 里写自己的 CHARACTER_PROMPT 就好。
"""
from datetime import datetime
from . import config as cfg


def get_time_context():
    now = datetime.now(cfg.CN_TZ)
    hour = now.hour
    weekday = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'][now.weekday()]

    if 5 <= hour < 11:
        period = '早晨/上午'
    elif 11 <= hour < 14:
        period = '中午'
    elif 14 <= hour < 18:
        period = '下午'
    elif 18 <= hour < 22:
        period = '傍晚/晚上'
    else:
        period = '深夜'

    return f'''【现在的时间——必须遵守】
当前时间：{now.strftime("%Y年%m月%d日 %H:%M")}（{weekday}）
时段：{period}
绝对不要根据自己的想象发早/晚安，必须根据真实时段。'''


def build_system_prompt(core_prompt: str = None, user_message: str = '') -> str:
    """
    组装完整 system prompt：
      1) 传入的角色 core_prompt（没传就用 config 里的默认）
      2) 时间上下文
      3) 情绪分析 + JSON 输出格式（与原版一致的 11 种情绪）
    """
    character_prompt = core_prompt if core_prompt else cfg.get('CHARACTER_PROMPT')
    time_ctx = get_time_context()
    emotion_list = ', '.join(cfg.EMOTIONS)

    output_spec = f'''
【情绪判断】
根据你回复的语气，从这些情绪里选一个作为 emotion 字段：
{emotion_list}

【输出格式——必须严格遵守】
只返回单行合法 JSON，不要额外解释、不要 markdown 代码块：
{{"emotion": "情绪名", "content": "你的回复正文"}}

回复正文（content）是纯自然语言，可以有换行；情绪名（emotion）必须从上面 11 个里选一个。'''

    return f'''{character_prompt}

{time_ctx}
{output_spec}'''
