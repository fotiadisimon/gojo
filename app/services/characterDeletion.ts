import axios from 'axios';
import { beginDeletion, cleanupCharacter, deletionState, markDefinitiveFailure, markServerDeleted, normalizeServer, Scope } from './characterStorage';

const inFlight = new Map<string, Promise<void>>();

export function deletePermanently(scope: Scope, adminKey: string, operationId: string): Promise<void> {
  // Also serialize callers outside one modal, including different cached users
  // of the same globally owned role. A duplicate cannot create an older unknown
  // request while another response is being classified as safe to cancel.
  const id = JSON.stringify([normalizeServer(scope.server), scope.id]);
  const active = inFlight.get(id);
  if (active) return active;
  const request = performDeletion(scope, adminKey, operationId).finally(() => { inFlight.delete(id); });
  inFlight.set(id, request);
  return request;
}

async function performDeletion(scope: Scope, adminKey: string, operationId: string): Promise<void> {
  // Refuse sending credentials to an insecure/public HTTP connection.
  if (!/^https:\/\//i.test(scope.server) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(scope.server)) {
    throw new Error('永久删除请使用 HTTPS 后端地址');
  }
  const state = await beginDeletion(scope, operationId);
  if (state.phase === 'complete') return;
  if (state.phase === 'server_deleted') return cleanupCharacter(scope);
  const options = { timeout: 15000, headers: { 'X-Character-Delete-Key': adminKey } };
  let receipt;
  try {
    receipt = (await axios.post(`${scope.server}/characters/${encodeURIComponent(scope.id)}/permanent-deletion`, {
      operation_id: state.operationId, confirmed_character_id: scope.id, confirm_all_users: true,
    }, options)).data;
  } catch (error: any) {
    const detail = error?.response?.data?.detail;
    const rolledBack = error?.response?.status === 409 &&
      detail?.code === 'character_delete_rolled_back' &&
      detail.operation_id === state.operationId && detail.character_id === scope.id;
    // A POST 403 never entered the purge. Only our correlated rollback contract
    // proves a 409 safe; a generic proxy/old-server 409 proves nothing.
    if ((error?.response?.status === 403 || rolledBack) && await markDefinitiveFailure(scope, state.operationId)) {
      throw new Error(error?.response?.status === 403
        ? '管理凭证被拒绝，本次删除未执行。原数据已保留，可取消失败尝试并恢复聊天。'
        : '本次删除已回滚。原数据已保留，可取消失败尝试并恢复聊天，或重试。');
    }
    try {
      receipt = (await axios.get(`${scope.server}/character-deletions/${state.operationId}`, options)).data;
    } catch {
      // Never persist or display Axios errors: their config contains credentials.
      throw new Error('删除结果未知。角色已暂停本机写入，请使用“查询／重试”继续同一操作。');
    }
    if (receipt?.status !== 'deleted') {
      // not_committed is a snapshot, not proof that a timed-out request cannot
      // still commit. Later refusals must never erase that uncertainty.
      throw new Error('删除结果未知。尚未查到成功回执，角色仍暂停本机写入；请查询／重试同一操作。');
    }
  }
  if (receipt?.status !== 'deleted' || receipt.character_id !== scope.id) throw new Error('服务器删除回执不匹配，尚未清理本机');
  try { await markServerDeleted(scope); await cleanupCharacter(scope); }
  catch { throw new Error('服务器已删除，本机清理待重试'); }
}

export async function retryLocalCleanup(scope: Scope) {
  const state = await deletionState(scope);
  if (state?.phase !== 'server_deleted') throw new Error('尚未确认服务器删除');
  return cleanupCharacter(scope);
}
