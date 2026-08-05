"""角色路由：GET /characters / POST / GET/DELETE /characters/{id}

在 App 里可以：
  - 列出所有角色
  - 新建一个角色（自定义 id + 人设 prompt）
  - 编辑（同一个 id 再 POST 就是覆盖更新，upsert）
  - 删除
"""
import re
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from .characters import (
    list_characters, get_character, upsert_character, delete_character,
)
from .utils import safe_str

router = APIRouter()

_ID_RE = re.compile(r'^[a-zA-Z0-9_-]{1,32}$')


@router.get('/characters')
async def get_all():
    return JSONResponse({'characters': list_characters()})


@router.get('/characters/{char_id}')
async def get_one(char_id: str):
    char = get_character(char_id)
    if not char:
        return JSONResponse({'error': 'not found'}, status_code=404)
    return JSONResponse(char)


@router.post('/characters')
async def create_or_update(data: dict):
    char_id = safe_str(data.get('id'))
    name = safe_str(data.get('name'))
    core_prompt = safe_str(data.get('core_prompt'))

    if not char_id or not _ID_RE.match(char_id):
        return JSONResponse(
            {'error': 'id 需为 1-32 位字母/数字/下划线/连字符'},
            status_code=400,
        )
    if not name:
        return JSONResponse({'error': '名字不能为空'}, status_code=400)
    if not core_prompt:
        return JSONResponse({'error': '人设 prompt 不能为空'}, status_code=400)

    upsert_character(
        char_id=char_id,
        name=name,
        core_prompt=core_prompt,
        greeting=safe_str(data.get('greeting')),
        voice_id=safe_str(data.get('voice_id')),
        avatar_emoji=safe_str(data.get('avatar_emoji')) or '🤖',
    )
    return JSONResponse({'ok': True, 'id': char_id})


@router.delete('/characters/{char_id}')
async def delete_one(char_id: str):
    if not delete_character(char_id):
        return JSONResponse({'error': 'not found'}, status_code=404)
    return JSONResponse({'ok': True})
