"""环境变量、常量"""
import os
from datetime import timezone, timedelta

# ★ 本地开发时从 .env 读环境变量（线上 Zeabur 直接注入，没有 .env 也不影响）
try:
    from dotenv import load_dotenv
    from pathlib import Path
    load_dotenv(Path(__file__).resolve().parent.parent / '.env')  # 项目根目录的 .env
    load_dotenv()  # 再试当前目录
except ImportError:
    pass
# ═══════════════════════════════════════
#  模型分配(可通过环境变量覆盖)
# ═══════════════════════════════════════
# MODEL_MAIN: 角色扮演主体(chat/voice/story/group/image)—— Anthropic 家族,保留 prompt cache
MODEL_MAIN = os.getenv('MODEL_MAIN', 'claude-opus-4-6')

# MODEL_JP_AUX: 日语辅助任务(流式语音/提醒/scheduler 反应/主动消息)—— Haiku 便宜快
MODEL_JP_AUX = os.getenv('MODEL_JP_AUX', 'claude-haiku-4-5-20251001')

# MODEL_CN_AUX: 中文辅助任务(记忆提取/日记生成/纠错)—— 默认 Haiku,便宜快、质量稳
# ★ 默认改成 'claude-haiku-4-5-20251001'（跟 backend 私仓一致,DeepSeek 效果不理想）
#   之前的 'deepseek-v4-flash' 是错的模型名,会导致所有记忆提取 404 → 静默失败
#   想省钱走 DeepSeek 的话,在 App 设置页把这项改成 'deepseek-chat' 即可
MODEL_CN_AUX = os.getenv('MODEL_CN_AUX', 'claude-haiku-4-5-20251001')

# DeepSeek 配置(MODEL_CN_AUX 走 DS 时使用)
DEEPSEEK_KEY = os.getenv('DEEPSEEK_KEY', '')
DEEPSEEK_BASE_URL = os.getenv('DEEPSEEK_BASE_URL', 'https://api.deepseek.com')

ANTHROPIC_KEY = os.environ.get('ANTHROPIC_KEY', '')
FISH_KEY      = os.environ.get('FISH_KEY', '')
FISH_VOICE_ID = os.environ.get('FISH_VOICE_ID', 'bfcbd07c927742d6803f52084f6bb776')
GROQ_KEY      = os.environ.get('GROQ_KEY', '')
DATABASE_URL  = os.environ.get('DATABASE_URL', '')
TTS_PROVIDER  = os.environ.get('TTS_PROVIDER', 'fish')

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

# 默认角色（前端不传 character_id 时用这个）
# 默认角色（前端不传 character_id 时用这个；角色在 App 里创建）
DEFAULT_CHARACTER_ID = os.environ.get('DEFAULT_CHARACTER_ID', 'default')

# ── LLM Provider 总开关：claude / deepseek ──
LLM_PROVIDER = os.environ.get('LLM_PROVIDER', 'claude').lower()

# 兼容 llm.py 的命名
MODEL_AUX = MODEL_JP_AUX
DEEPSEEK_MODEL = os.environ.get('DEEPSEEK_MODEL', 'deepseek-chat')

# ══════════════════════════════════════════════
#  运行时配置：DB settings 表 > 环境变量 > 默认值
#  App 设置页改完立刻生效，不用重启
# ══════════════════════════════════════════════

# 静态默认值（上面那些常量的快照）
_STATIC = {
    'LLM_PROVIDER':      LLM_PROVIDER,
    'ANTHROPIC_KEY':     ANTHROPIC_KEY,
    'MODEL_MAIN':        MODEL_MAIN,
    'MODEL_JP_AUX':      MODEL_JP_AUX,
    'MODEL_CN_AUX':      MODEL_CN_AUX,
    'DEEPSEEK_KEY':      DEEPSEEK_KEY,
    'DEEPSEEK_MODEL':    DEEPSEEK_MODEL,
    'DEEPSEEK_BASE_URL': DEEPSEEK_BASE_URL,
    'FISH_KEY':          FISH_KEY,
    'FISH_VOICE_ID':     FISH_VOICE_ID,
}

_cache = None


def clear_settings_cache():
    """settings 改动后调用，下次 get_setting 会重新查 DB"""
    global _cache
    _cache = None


def _load_from_db():
    global _cache
    if _cache is not None:
        return _cache
    _cache = {}
    try:
        from db import get_conn
        conn = get_conn()
        cur = conn.cursor()
        cur.execute('SELECT key, value FROM settings')
        for k, v in cur.fetchall():
            if v:
                _cache[k] = v
        cur.close()
        conn.close()
    except Exception as e:
        print(f'[config] 读 settings 表失败（用静态值）：{e}')
    return _cache


def get_setting(key: str) -> str:
    """★ 业务代码统一用这个取配置，不要直接用模块级常量"""
    db = _load_from_db()
    v = db.get(key)
    if v and str(v).strip():          # 空串/纯空白都当没设置，回退静态值
        return str(v).strip()
    return _STATIC.get(key, '')