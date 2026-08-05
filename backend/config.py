"""环境变量、常量

支持两种配置方式（同时存在时 config.json 优先）：
  1. 环境变量（.env 或系统环境）
  2. 项目根目录下的 config.json —— 适合本地开发时手写多行 CHARACTER_PROMPT
"""
import json
import os
from datetime import timezone, timedelta
from pathlib import Path

# 允许 .env（本地开发方便）
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
_CFG_FILE = _ROOT / 'config.json'

_json_cfg = {}
if _CFG_FILE.exists():
    try:
        _json_cfg = json.loads(_CFG_FILE.read_text(encoding='utf-8'))
    except Exception as e:
        print(f'[config] ⚠️ config.json 解析失败：{e}')


def _get(key, default=''):
    """config.json 优先，其次环境变量，最后默认值。"""
    if key in _json_cfg and _json_cfg[key] not in (None, ''):
        return _json_cfg[key]
    return os.environ.get(key, default)


# ── LLM 提供商 ──
LLM_PROVIDER = (_get('LLM_PROVIDER', 'claude') or 'claude').lower()

ANTHROPIC_API_KEY = _get('ANTHROPIC_API_KEY', '')
CLAUDE_MODEL      = _get('CLAUDE_MODEL', 'claude-sonnet-4-5-20250929')

DEEPSEEK_API_KEY  = _get('DEEPSEEK_API_KEY', '')
DEEPSEEK_MODEL    = _get('DEEPSEEK_MODEL', 'deepseek-chat')
DEEPSEEK_BASE_URL = _get('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1')

# ── Fish Audio TTS（可选，用于语音朗读）──
FISH_KEY      = _get('FISH_KEY', '')
FISH_VOICE_ID = _get('FISH_VOICE_ID', 'bfcbd07c927742d6803f52084f6bb776')  # 原版五条悟

# ── 默认角色人设（DB 里没角色时的兜底；用户可以在 App 里加更多角色）──
CHARACTER_NAME   = _get('CHARACTER_NAME', 'AI助手')
CHARACTER_PROMPT = _get('CHARACTER_PROMPT', '''你是一个AI助手，性格温和、乐于助人。
说话风格：简洁自然，像朋友聊天。''')
CHARACTER_GREETING = _get('CHARACTER_GREETING', '你好，今天想聊什么？')

# ── Fish Audio TTS ──
FISH_KEY      = _get('FISH_KEY', '')
FISH_VOICE_ID = _get('FISH_VOICE_ID', '')   # 默认 voice id，可以在每个角色上单独覆盖

# ── 数据库 ──
DB_PATH = _get('DB_PATH', str(_ROOT / 'data.db'))

# ── 服务 ──
PORT = int(_get('PORT', '8080'))

# ── 时区、情绪表（沿用原版 11 种，不改）──
CN_TZ = timezone(timedelta(hours=8))

EMOTION_TAGS = {
    '平静': '(calm)',
    '自信': '(confident)',
    '嘲讽': '(sarcastic, mocking)',
    '开心': '(excited, happy)',
    '激动': '(excited)',
    '温柔': '(gentle, tender)',
    '认真': '(serious)',
    '疑惑': '(puzzled, questioning)',
    '调皮': '(playful, teasing)',
    '悲伤': '(sad)',
    '愤怒': '(angry)',
}
EMOTIONS = list(EMOTION_TAGS.keys())


def dump_public_config():
    """给前端 /config 端点返回的（不含密钥）"""
    return {
        'provider': LLM_PROVIDER,
        'claude_model': CLAUDE_MODEL,
        'deepseek_model': DEEPSEEK_MODEL,
        'character_name': CHARACTER_NAME,
        'character_greeting': CHARACTER_GREETING,
        'has_claude_key': bool(ANTHROPIC_API_KEY),
        'has_deepseek_key': bool(DEEPSEEK_API_KEY),
        'has_fish_key': bool(FISH_KEY),
        'emotions': EMOTIONS,
    }
