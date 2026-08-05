"""角色 CRUD 辅助层。

用户可以在 App 里新增/编辑/删除角色。
如果 DB 里一个角色都没有，会自动种一个默认角色（用 config.py 里的 CHARACTER_PROMPT）。
这样新用户开箱就有得聊。
"""
from . import config as cfg
from .db import get_conn

DEFAULT_ID = 'default'


def seed_default_if_empty():
    """DB 里没角色时，塞一个基于 config 的默认角色。"""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute('SELECT COUNT(*) FROM characters')
        n = cur.fetchone()[0]
        if n == 0:
            conn.execute(
                '''INSERT INTO characters (id, name, core_prompt, greeting, voice_id, avatar_emoji)
                   VALUES (?, ?, ?, ?, ?, ?)''',
                (DEFAULT_ID, cfg.CHARACTER_NAME, cfg.CHARACTER_PROMPT,
                 cfg.CHARACTER_GREETING, cfg.FISH_VOICE_ID, '🤖'),
            )
            print(f'[characters] 已种默认角色 id={DEFAULT_ID} name={cfg.CHARACTER_NAME}')


def list_characters():
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            '''SELECT id, name, core_prompt, greeting, voice_id, avatar_emoji, created_at
               FROM characters ORDER BY created_at ASC'''
        )
        return [dict(r) for r in cur.fetchall()]


def get_character(char_id: str):
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute('SELECT * FROM characters WHERE id = ?', (char_id,))
        row = cur.fetchone()
        return dict(row) if row else None


def upsert_character(char_id: str, name: str, core_prompt: str,
                     greeting: str = '', voice_id: str = '', avatar_emoji: str = ''):
    with get_conn() as conn:
        conn.execute('''
            INSERT INTO characters (id, name, core_prompt, greeting, voice_id, avatar_emoji)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                core_prompt = excluded.core_prompt,
                greeting = excluded.greeting,
                voice_id = excluded.voice_id,
                avatar_emoji = excluded.avatar_emoji
        ''', (char_id, name, core_prompt, greeting, voice_id, avatar_emoji))


def delete_character(char_id: str):
    with get_conn() as conn:
        cur = conn.execute('DELETE FROM characters WHERE id = ?', (char_id,))
        return cur.rowcount > 0
