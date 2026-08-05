"""SQLite 建表 + 连接

只保留公开版需要的四张表：
  chat_history — 聊天历史（含 emotion 字段）
  tasks        — 日程（沿用原版字段名）
  accounting   — 记账
  diary        — 日记（★ 新增；原版没有）
"""
import sqlite3
from contextlib import contextmanager
from . import config as cfg


@contextmanager
def get_conn():
    conn = sqlite3.connect(cfg.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _column_exists(cur, table, col):
    cur.execute(f"PRAGMA table_info({table})")
    return any(r[1] == col for r in cur.fetchall())


def init_db():
    with get_conn() as conn:
        cur = conn.cursor()

        # ── 角色表（可在 App 里增删改）──
        cur.execute('''CREATE TABLE IF NOT EXISTS characters (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            core_prompt TEXT NOT NULL,
            greeting TEXT DEFAULT '',
            voice_id TEXT DEFAULT '',
            avatar_emoji TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )''')

        # 聊天历史（每条属于某个角色）
        cur.execute('''CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL DEFAULT 'default',
            character_id TEXT NOT NULL DEFAULT 'default',
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            emotion TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )''')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_history(user_id, character_id, id)')

        # 老库自动补 character_id 列
        if not _column_exists(cur, 'chat_history', 'character_id'):
            cur.execute("ALTER TABLE chat_history ADD COLUMN character_id TEXT NOT NULL DEFAULT 'default'")

        # 日程
        cur.execute('''CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL DEFAULT 'default',
            title TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT '个人',
            due_date TEXT,
            due_time TEXT,
            completed INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )''')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, completed, due_date)')

        # 记账（走后端，不再是 AsyncStorage 本地存）
        cur.execute('''CREATE TABLE IF NOT EXISTS accounting (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL DEFAULT 'default',
            type TEXT NOT NULL CHECK(type IN ('in', 'out')),
            category TEXT NOT NULL,
            description TEXT DEFAULT '',
            amount REAL NOT NULL,
            date TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )''')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_acc_user ON accounting(user_id, date)')

        # 日记（新增）
        cur.execute('''CREATE TABLE IF NOT EXISTS diary (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL DEFAULT 'default',
            date TEXT NOT NULL,
            mood TEXT DEFAULT '',
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )''')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_diary_user ON diary(user_id, date)')

        # 运行时可改的设置（key-value 表）——
        # 人设、provider 开关、TTS 开关都放这里，方便 App 里直接改，不用重启服务。
        # API keys 不放这里（安全考虑，仍走 env / config.json）
        cur.execute('''CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )''')
