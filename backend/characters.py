"""角色 CRUD + 背景记忆检索（通用逻辑）
角色人设在 characters_data/<id>/ 下,加新角色只需新建文件夹,不动本文件。

★ v2 改动：
  - seed 只在该角色背景记忆为空时预置，不再每次启动清空重灌
    → 保护你在 app 记忆页里对背景记忆的修改
    → 想强制按 memories.py 重灌某角色：手动删掉他的 character_memory 再重启
  - list_characters 返回 voice_id（设置页音色编辑用）
"""
from db import get_conn



def seed_all_characters():
    """角色现在都在 App 里创建，不再从代码文件夹预置。
    这里只保证 DB 里至少有一个默认角色，新用户开箱能用。"""
    import config
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('SELECT COUNT(*) FROM characters')
    if cur.fetchone()[0] == 0:
        cur.execute(
            '''INSERT INTO characters (id, name, name_en, voice_id, core_prompt, greeting)
               VALUES (%s, %s, %s, %s, %s, %s)''',
            (config.DEFAULT_CHARACTER_ID, 'AI助手', 'Assistant', '',
             '你是一个AI助手，性格温和、乐于助人。\n说话风格：简洁自然，像朋友聊天。',
             '你好，今天想聊什么？')
        )
        print(f'[seed] 已创建默认角色 {config.DEFAULT_CHARACTER_ID}（可在 App 里编辑或新建更多）')
    conn.commit()
    cur.close()
    conn.close()


# 兼容 gojo_server.py 的旧入口
def seed_gojo_character():
    seed_all_characters()


def get_character(character_id: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        '''SELECT id, name, name_en, avatar_url, voice_id, core_prompt, greeting,
                  COALESCE(canon_lock, '')
           FROM characters WHERE id = %s''', (character_id,))
    row = cur.fetchone()
    cur.close(); conn.close()
    if not row: return None
    return {'id': row[0], 'name': row[1], 'name_en': row[2],
            'avatar_url': row[3], 'voice_id': row[4],
            'core_prompt': row[5], 'greeting': row[6],
            'canon_lock': row[7] or ''}


def list_characters():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('SELECT id, name, name_en, avatar_url, voice_id, greeting FROM characters ORDER BY created_at')
    rows = cur.fetchall()
    cur.close(); conn.close()
    return [{'id': r[0], 'name': r[1], 'name_en': r[2], 'avatar_url': r[3],
             'voice_id': r[4], 'greeting': r[5]} for r in rows]


def delete_character(character_id: str) -> bool:
    """删除角色本体 + 它的角色背景记忆。
    聊天记录/长期记忆等按 user_id+character_id 存的数据不动——
    重建同名角色时还能接上，也避免误删用户数据。"""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('DELETE FROM character_memory WHERE character_id = %s', (character_id,))
    cur.execute('DELETE FROM characters WHERE id = %s', (character_id,))
    deleted = cur.rowcount > 0
    conn.commit(); cur.close(); conn.close()
    return deleted


def list_character_memory(character_id: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        '''SELECT id, content, category, keywords, importance, timestamp
           FROM character_memory WHERE character_id = %s
           ORDER BY category, importance DESC''', (character_id,))
    rows = cur.fetchall()
    cur.close(); conn.close()
    return [{'id': r[0], 'content': r[1], 'category': r[2] or '其他',
             'keywords': r[3] or '', 'importance': float(r[4] or 0.5),
             'timestamp': str(r[5]) if r[5] else None} for r in rows]


def add_character_memory(character_id, content, category='其他', keywords='', importance=0.5):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        '''INSERT INTO character_memory (character_id, content, category, keywords, importance)
           VALUES (%s, %s, %s, %s, %s) RETURNING id''',
        (character_id, content, category, keywords, importance))
    new_id = cur.fetchone()[0]
    conn.commit(); cur.close(); conn.close()
    return new_id


def update_character_memory(mem_id, fields):
    cols, vals = [], []
    for k in ['content', 'category', 'keywords', 'importance']:
        if k in fields: cols.append(f'{k} = %s'); vals.append(fields[k])
    if not cols: return False
    vals.append(mem_id)
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(f'UPDATE character_memory SET {", ".join(cols)} WHERE id = %s', vals)
    conn.commit(); cur.close(); conn.close()
    return True


def delete_character_memory(mem_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('DELETE FROM character_memory WHERE id = %s', (mem_id,))
    conn.commit(); cur.close(); conn.close()


def retrieve_character_memory(character_id, query_text, limit=4):
    if not query_text: return []
    matched = []
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('SELECT content, keywords, importance FROM character_memory WHERE character_id = %s',
                (character_id,))
    rows = cur.fetchall()
    cur.close(); conn.close()
    for content, keywords, importance in rows:
        kws = [k.strip() for k in (keywords or '').split(',') if k.strip()]
        hit = sum(1 for kw in kws if kw and kw in query_text)
        if hit > 0:
            matched.append((hit * 1.0 + (importance or 0.5) * 0.5, content))
    
    matched.sort(key=lambda x: x[0], reverse=True)
    result, seen = [], []
    for _, content in matched:
        if any((content in s) or (s in content) for s in seen): continue
        seen.append(content); result.append(content)
        if len(result) >= limit: break
    return result