"""日记路由：/diary（GET 列表 / POST 新建）/diary/{id}（GET/PUT/DELETE）"""
from datetime import datetime
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from .db import get_conn
from .utils import safe_str

router = APIRouter()


@router.get('/diary')
async def list_diary(user_id: str = 'default', limit: int = 100):
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            '''SELECT id, date, mood, content, created_at, updated_at
               FROM diary WHERE user_id = ?
               ORDER BY date DESC, id DESC LIMIT ?''',
            (user_id, limit),
        )
        rows = [dict(r) for r in cur.fetchall()]
    return JSONResponse({'entries': rows})


@router.get('/diary/{entry_id}')
async def get_diary(entry_id: int, user_id: str = 'default'):
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            'SELECT * FROM diary WHERE id = ? AND user_id = ?',
            (entry_id, user_id),
        )
        row = cur.fetchone()
    if not row:
        return JSONResponse({'error': 'not found'}, status_code=404)
    return JSONResponse(dict(row))


@router.post('/diary')
async def create_diary(data: dict):
    user_id = safe_str(data.get('user_id'), 'default')
    content = safe_str(data.get('content'))
    if not content:
        return JSONResponse({'error': '日记内容不能为空'}, status_code=400)

    date = safe_str(data.get('date')) or datetime.now().strftime('%Y-%m-%d')
    mood = safe_str(data.get('mood'))

    with get_conn() as conn:
        cur = conn.execute(
            'INSERT INTO diary (user_id, date, mood, content) VALUES (?, ?, ?, ?)',
            (user_id, date, mood, content),
        )
        new_id = cur.lastrowid
    return JSONResponse({'ok': True, 'id': new_id})


@router.put('/diary/{entry_id}')
async def update_diary(entry_id: int, data: dict):
    user_id = safe_str(data.get('user_id'), 'default')
    updates = []
    params = []

    for key in ('date', 'mood', 'content'):
        if key in data:
            v = safe_str(data.get(key))
            if key == 'content' and not v:
                return JSONResponse({'error': '日记内容不能为空'}, status_code=400)
            updates.append(f'{key} = ?')
            params.append(v)

    if not updates:
        return JSONResponse({'error': 'nothing to update'}, status_code=400)

    updates.append("updated_at = CURRENT_TIMESTAMP")
    params.extend([entry_id, user_id])

    with get_conn() as conn:
        cur = conn.execute(
            f'UPDATE diary SET {", ".join(updates)} WHERE id = ? AND user_id = ?',
            params,
        )
        if cur.rowcount == 0:
            return JSONResponse({'error': 'not found'}, status_code=404)
    return JSONResponse({'ok': True})


@router.delete('/diary/{entry_id}')
async def delete_diary(entry_id: int, user_id: str = 'default'):
    with get_conn() as conn:
        cur = conn.execute(
            'DELETE FROM diary WHERE id = ? AND user_id = ?',
            (entry_id, user_id),
        )
        if cur.rowcount == 0:
            return JSONResponse({'error': 'not found'}, status_code=404)
    return JSONResponse({'ok': True})
