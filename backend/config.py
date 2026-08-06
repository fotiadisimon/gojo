"""配置模块 —— 三级优先级：DB settings 表 > config.json > 环境变量 > 默认值

优先级最高的是 DB settings 表：用户在 App 设置页里填的值存在这里，
改完立刻生效，不用重启服务、不用改 Zeabur 环境变量。

DB_PATH 和 PORT 只能走 env / config.json（因为 DB 还没连上就需要这两个值）。
"""
import json
import os
from datetime import timezone, timedelta
from pathlib import Path

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


def _get_static(key, default=''):
    """config.json > 环境变量 > 默认值（不查 DB，启动阶段用）"""
    if key in _json_cfg and _json_cfg[key] not in (None, ''):
        return _json_cfg[key]
    return os.environ.get(key, default)


# ── 只能静态配的（启动前就得知道）──
DB_PATH = _get_static('DB_PATH', str(_ROOT / 'data.db'))
PORT    = int(_get_static('PORT', '8080'))

# ── 时区、情绪（不可改）──
CN_TZ = timezone(timedelta(hours=8))
EMOTION_TAGS = {
    '平静': '(calm)',       '自信': '(confident)',
    '嘲讽': '(sarcastic, mocking)', '开心': '(excited, happy)',
    '激动': '(excited)',     '温柔': '(gentle, tender)',
    '认真': '(serious)',     '疑惑': '(puzzled, questioning)',
    '调皮': '(playful, teasing)',    '悲伤': '(sad)',
    '愤怒': '(angry)',
}
EMOTIONS = list(EMOTION_TAGS.keys())

# ── 所有可以在 App 里改的字段 + 静态默认值 ──
_DEFAULTS = {
    'LLM_PROVIDER':       _get_static('LLM_PROVIDER', 'claude'),
    'ANTHROPIC_API_KEY':  _get_static('ANTHROPIC_API_KEY', ''),
    'CLAUDE_MODEL':       _get_static('CLAUDE_MODEL', 'claude-sonnet-4-5-20250929'),
    'DEEPSEEK_API_KEY':   _get_static('DEEPSEEK_API_KEY', ''),
    'DEEPSEEK_MODEL':     _get_static('DEEPSEEK_MODEL', 'deepseek-chat'),
    'DEEPSEEK_BASE_URL':  _get_static('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1'),
    'FISH_KEY':           _get_static('FISH_KEY', ''),
    'FISH_VOICE_ID':      _get_static('FISH_VOICE_ID', ''),
    'CHARACTER_NAME':     _get_static('CHARACTER_NAME', 'AI助手'),
    'CHARACTER_PROMPT':   _get_static('CHARACTER_PROMPT', '你是一个AI助手，性格温和、乐于助人。\n说话风格：简洁自然，像朋友聊天。'),
    'CHARACTER_GREETING': _get_static('CHARACTER_GREETING', '你好，今天想聊什么？'),
}

# 哪些是密钥（GET 时打码显示）
_SECRET_KEYS = {'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'FISH_KEY'}


def _read_db(key):
    """从 DB settings 表查；找不到返回 None。"""
    import sqlite3
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.execute('SELECT value FROM settings WHERE key = ?', (key,))
        row = cur.fetchone()
        conn.close()
        if row and row[0] is not None and row[0] != '':
            return row[0]
    except Exception:
        pass
    return None


def get(key: str) -> str:
    """运行时取值：DB settings > 静态默认值。所有可改字段都走这个。"""
    db_val = _read_db(key)
    if db_val is not None:
        return db_val
    return _DEFAULTS.get(key, '')


def set_setting(key: str, value: str):
    """写入 DB settings 表。"""
    if key not in _DEFAULTS:
        raise ValueError(f'不支持的配置项：{key}')
    import sqlite3
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        '''INSERT INTO settings (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                          updated_at = CURRENT_TIMESTAMP''',
        (key, value),
    )
    conn.commit()
    conn.close()


def dump_all_settings():
    """返回所有可改字段的当前值（密钥打码）。给前端设置页用。"""
    result = {}
    for key in _DEFAULTS:
        val = get(key)
        if key in _SECRET_KEYS and val:
            result[key] = val[:8] + '****' + val[-4:] if len(val) > 12 else '****'
        else:
            result[key] = val
    return result


def dump_public_config():
    """给首页 /config 端点用（不含密钥值，只含 bool 状态）。"""
    return {
        'provider':           get('LLM_PROVIDER'),
        'claude_model':       get('CLAUDE_MODEL'),
        'deepseek_model':     get('DEEPSEEK_MODEL'),
        'character_name':     get('CHARACTER_NAME'),
        'character_greeting': get('CHARACTER_GREETING'),
        'has_claude_key':     bool(get('ANTHROPIC_API_KEY')),
        'has_deepseek_key':   bool(get('DEEPSEEK_API_KEY')),
        'has_fish_key':       bool(get('FISH_KEY')),
        'emotions':           EMOTIONS,
    }


# ── 兼容旧代码：属性式访问 cfg.XXX 改为 cfg.get('XXX') ──
# 对于还在用 cfg.LLM_PROVIDER 这种写法的旧代码，提供只读属性
class _Proxy:
    """让 import config as cfg; cfg.ANTHROPIC_API_KEY 仍然能用（动态走 DB）。"""
    def __getattr__(self, name):
        if name in _DEFAULTS:
            return get(name)
        raise AttributeError(name)

# 不在这里替换 module，各路由直接用 cfg.get('KEY') 即可
