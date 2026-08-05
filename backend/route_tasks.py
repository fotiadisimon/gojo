"""日程路由：字段接口尽量贴原版（title/category/due_date/due_time/completed）"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from .db import get_conn
from .utils import safe_str

router = APIRouter()

ALLOWED_UPDATE_FIELDS = {'title', 'category', 'due_date', 'due_time', 'completed'}


@router.get('/tasks')
async def list_tasks(user_id: str = 'default', completed: int = -1):
    """
    completed = -1 全部；0 未完成；1 已完成
    """
    sql = 'SELECT id, title, category, due_date, due_time, completed, created_at FROM tasks WHERE user_id = ?'
    params = [user_id]
    if completed in (0, 1):
        sql += ' AND completed = ?'
        params.append(completed)
    sql += ' ORDER BY completed ASC, due_date IS NULL, due_date ASC, due_time IS NULL, due_time ASC, id ASC'

    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        r['completed'] = bool(r['completed'])
    return JSONResponse({'tasks': rows})


@router.post('/tasks')
async def create_task(data: dict):
    user_id = safe_str(data.get('user_id'), 'default')
    title = safe_str(data.get('title'))
    if not title:
        return JSONResponse({'error': '标题不能为空'}, status_code=400)

    category = safe_str(data.get('category'), '个人')
    due_date = safe_str(data.get('due_date')) or None
    due_time = safe_str(data.get('due_time')) or None

    with get_conn() as conn:
        cur = conn.execute(
            '''INSERT INTO tasks (user_id, title, category, due_date, due_time, completed)
               VALUES (?, ?, ?, ?, ?, 0)''',
            (user_id, title, category, due_date, due_time),
        )
        new_id = cur.lastrowid
    return JSONResponse({'ok': True, 'id': new_id})


@router.put('/tasks/{task_id}')
async def update_task(task_id: int, data: dict):
    user_id = safe_str(data.get('user_id'), 'default')
    updates = []
    params = []
    for k, v in data.items():
        if k in ALLOWED_UPDATE_FIELDS:
            if k == 'completed':
                # 支持 bool、0/1、'true'/'false'
                v = 1 if str(v).lower() in ('1', 'true', 'yes') or v is True else 0
                updates.append('completed = ?')
                params.append(v)
            else:
                sval = safe_str(v)
                if k == 'title' and not sval:
                    return JSONResponse({'error': '标题不能为空'}, status_code=400)
                updates.append(f'{k} = ?')
                params.append(sval or None)

    if not updates:
        return JSONResponse({'error': 'nothing to update'}, status_code=400)
    params.extend([task_id, user_id])

    with get_conn() as conn:
        cur = conn.execute(
            f'UPDATE tasks SET {", ".join(updates)} WHERE id = ? AND user_id = ?',
            params,
        )
        if cur.rowcount == 0:
            return JSONResponse({'error': 'not found'}, status_code=404)
    return JSONResponse({'ok': True})


@router.delete('/tasks/{task_id}')
async def delete_task(task_id: int, user_id: str = 'default'):
    with get_conn() as conn:
        cur = conn.execute(
            'DELETE FROM tasks WHERE id = ? AND user_id = ?',
            (task_id, user_id),
        )
        if cur.rowcount == 0:
            return JSONResponse({'error': 'not found'}, status_code=404)
    return JSONResponse({'ok': True})
