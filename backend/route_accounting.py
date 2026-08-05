"""记账路由：GET 列表+总计 / POST / DELETE / GET stats

原版是 AsyncStorage 本地存的，公开版改成走后端——这样跟日记、日程一致，还能多设备同步。
"""
from datetime import datetime
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from .db import get_conn
from .utils import safe_str

router = APIRouter()


@router.get('/accounting')
async def list_accounting(user_id: str = 'default', limit: int = 500):
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            '''SELECT id, type, category, description, amount, date, created_at
               FROM accounting WHERE user_id = ?
               ORDER BY date DESC, id DESC LIMIT ?''',
            (user_id, limit),
        )
        rows = [dict(r) for r in cur.fetchall()]

        cur.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM accounting WHERE user_id = ? AND type = 'in'",
            (user_id,),
        )
        total_in = cur.fetchone()[0] or 0

        cur.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM accounting WHERE user_id = ? AND type = 'out'",
            (user_id,),
        )
        total_out = cur.fetchone()[0] or 0

    return JSONResponse({
        'records': rows,
        'total_in': round(total_in, 2),
        'total_out': round(total_out, 2),
        'balance': round(total_in - total_out, 2),
    })


@router.post('/accounting')
async def create_accounting(data: dict):
    user_id = safe_str(data.get('user_id'), 'default')
    type_ = safe_str(data.get('type'))
    if type_ not in ('in', 'out'):
        return JSONResponse({'error': 'type 必须是 in 或 out'}, status_code=400)

    category = safe_str(data.get('category'))
    if not category:
        return JSONResponse({'error': '分类不能为空'}, status_code=400)

    description = safe_str(data.get('description'))
    date = safe_str(data.get('date')) or datetime.now().strftime('%Y-%m-%d')

    try:
        amount = float(data.get('amount', 0))
    except (TypeError, ValueError):
        return JSONResponse({'error': '金额必须是数字'}, status_code=400)
    if amount <= 0:
        return JSONResponse({'error': '金额必须大于 0'}, status_code=400)
    amount = round(amount, 2)

    with get_conn() as conn:
        cur = conn.execute(
            '''INSERT INTO accounting (user_id, type, category, description, amount, date)
               VALUES (?, ?, ?, ?, ?, ?)''',
            (user_id, type_, category, description, amount, date),
        )
        new_id = cur.lastrowid
    return JSONResponse({'ok': True, 'id': new_id})


@router.delete('/accounting/{record_id}')
async def delete_accounting(record_id: int, user_id: str = 'default'):
    with get_conn() as conn:
        cur = conn.execute(
            'DELETE FROM accounting WHERE id = ? AND user_id = ?',
            (record_id, user_id),
        )
        if cur.rowcount == 0:
            return JSONResponse({'error': 'not found'}, status_code=404)
    return JSONResponse({'ok': True})


@router.get('/accounting/stats')
async def stats(user_id: str = 'default'):
    """按分类汇总（分收入/支出）"""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            '''SELECT type, category, SUM(amount) as total, COUNT(*) as count
               FROM accounting WHERE user_id = ?
               GROUP BY type, category ORDER BY total DESC''',
            (user_id,),
        )
        rows = [dict(r) for r in cur.fetchall()]

    expense = [{'category': r['category'], 'total': round(r['total'], 2), 'count': r['count']}
               for r in rows if r['type'] == 'out']
    income = [{'category': r['category'], 'total': round(r['total'], 2), 'count': r['count']}
              for r in rows if r['type'] == 'in']
    return JSONResponse({'expense': expense, 'income': income})
