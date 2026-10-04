"""Explicit, authenticated permanent deletion; credentials never go in URLs."""
import hmac
import os
import uuid
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from psycopg2.errors import LockNotAvailable, DeadlockDetected

from character_deletion import PurgeBlocked, get_receipt, purge_character
from db import get_conn

router = APIRouter()


def require_delete_admin(x_character_delete_key: str = Header(default='')):
    expected = os.environ.get('CHARACTER_DELETE_ADMIN_KEY', '')
    if len(expected) < 32:
        raise HTTPException(503, '服务器未配置永久删除管理凭证（至少32字符）')
    if not hmac.compare_digest(x_character_delete_key.encode(), expected.encode()):
        raise HTTPException(403, '永久删除需要服务器管理凭证')


class DeleteRequest(BaseModel):
    operation_id: uuid.UUID
    confirmed_character_id: str
    confirm_all_users: bool


@router.get('/character-deletion/capabilities')
def capabilities():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute('SELECT server_id FROM character_deletion_meta WHERE singleton')
            row = cur.fetchone()
            return {'protocol': 'gojo-pub-character-delete-v1', 'server_id': str(row[0]),
                    'scope': 'all_users', 'admin_configured': len(os.getenv('CHARACTER_DELETE_ADMIN_KEY', '')) >= 32}
    finally:
        conn.close()


@router.post('/characters/{character_id}/permanent-deletion', dependencies=[Depends(require_delete_admin)])
def permanent_delete(character_id: str, data: DeleteRequest):
    if data.confirmed_character_id != character_id or not data.confirm_all_users:
        raise HTTPException(400, '必须确认精确角色ID及服务器上所有用户的数据范围')
    try:
        return purge_character(character_id, data.operation_id)
    except PurgeBlocked as exc:
        message = str(exc)
    except (LockNotAvailable, DeadlockDetected):
        message = '后台写入尚未结束；请用同一操作ID查询或重试'
    # These exceptions escape only after the transaction context has rolled
    # back (or before it started). This says nothing about an EARLIER request.
    raise HTTPException(409, {
        'code': 'character_delete_rolled_back', 'message': message,
        'operation_id': str(data.operation_id), 'character_id': character_id,
    }) from None


@router.get('/character-deletions/{operation_id}', dependencies=[Depends(require_delete_admin)])
def deletion_result(operation_id: uuid.UUID):
    return get_receipt(operation_id)


@router.get('/characters/{character_id}/deletion-state')
def deletion_state(character_id: str):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute('SELECT 1 FROM character_tombstones WHERE character_id=%s', (character_id,))
            return {'character_id': character_id, 'deleted': cur.fetchone() is not None}
    finally:
        conn.close()
