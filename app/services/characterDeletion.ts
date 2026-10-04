import axios from 'axios';
import { beginDeletion, cleanupCharacter, deletionState, markServerDeleted, Scope } from './characterStorage';

export async function deletePermanently(scope: Scope, adminKey: string, operationId: string) {
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
    try {
      receipt = (await axios.get(`${scope.server}/character-deletions/${state.operationId}`, options)).data;
    } catch {
      // Never persist or display Axios errors: their config contains credentials.
      throw new Error('删除结果未知。角色已暂停本机写入，请使用“查询／重试”继续同一操作。');
    }
    if (receipt?.status !== 'deleted') {
      const detail = typeof error?.response?.data?.detail === 'string' ? error.response.data.detail : '服务器尚未确认删除';
      throw new Error(`${detail}；请查询／重试同一操作。`);
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
