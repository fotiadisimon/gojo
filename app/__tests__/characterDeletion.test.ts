import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FS from 'expo-file-system/legacy';
import * as Notifications from 'expo-notifications';
import axios from 'axios';
import { beginDeletion, cancelFailedDeletion, captureWriteScope, cleanupCharacter, deletionState, guardedWrite, initializeCharacterStorage, isBlocked, markServerDeleted, messageKey, migrateLegacy, pendingDeletions, scopeKey, setUnread, unreadKey, writeMessages } from '../services/characterStorage';
import { deletePermanently } from '../services/characterDeletion';
let n = 0;
const scope = () => ({ server: `https://server-${++n}.test`, user: 'u1', id: 'gojo' });
beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); });

test('precise legacy cleanup preserves same name/case, shared settings and other server', async () => {
  const s = scope();
  await initializeCharacterStorage(s.server, s.user);
  await AsyncStorage.multiSet([['chat_msgs_gojo','private'],['chat_msgs_Gojo','keep'],['server_url',s.server],['user_id','u1'],['gojo_user_id','u1'],['task_note_1','personal'],['gojo_proactive_state','{"1_2026-10-04":{"reminded":true}}'],[messageKey({ ...s, server: 'https://other.test' }),'other']]);
  await beginDeletion(s, 'op'); await markServerDeleted(s); await cleanupCharacter(s);
  expect(await AsyncStorage.getItem('chat_msgs_gojo')).toBeNull();
  expect(await AsyncStorage.getItem('gojo_proactive_state')).toBeNull();
  expect(await AsyncStorage.getItem('chat_msgs_Gojo')).toBe('keep');
  expect(await AsyncStorage.getItem('task_note_1')).toBe('personal');
  expect(await AsyncStorage.getItem('user_id')).toBe('u1');
  expect(await AsyncStorage.getItem(messageKey({ ...s, server: 'https://other.test' }))).toBe('other');
  expect(FS.deleteAsync).toHaveBeenCalledWith('file:///documents/chat_audio_gojo/', { idempotent: true });
});

test('another server cannot claim or erase unnamespaced legacy keys', async () => {
  const original=scope(), second={...original, server:'https://new.test'};
  await initializeCharacterStorage(original.server, original.user);
  await AsyncStorage.setItem('chat_msgs_gojo','original');
  await migrateLegacy(second);
  await beginDeletion(second,'op'); await markServerDeleted(second); await cleanupCharacter(second);
  expect(await AsyncStorage.getItem('chat_msgs_gojo')).toBe('original');
  expect(await AsyncStorage.getItem(messageKey(second))).toBeNull();
});

test('migration keeps old messages available once, without crossing server', async () => {
  const s=scope(); await initializeCharacterStorage(s.server,s.user);
  await AsyncStorage.setItem('chat_msgs_gojo','old'); await migrateLegacy(s);
  expect(await AsyncStorage.getItem(messageKey(s))).toBe('old');
  expect(await AsyncStorage.getItem('chat_msgs_gojo')).toBeNull();
});

test('inflight/unmounted message and audio writes drain before cleanup; late writes suppressed', async () => {
  const s=scope(); let release!: () => void;
  const started=guardedWrite(s, async () => { await new Promise<void>(r=>{release=r;}); await AsyncStorage.setItem(messageKey(s),'old'); });
  await new Promise(r=>setImmediate(r));
  const pending=beginDeletion(s,'op');
  release(); await started; await pending; await markServerDeleted(s); await cleanupCharacter(s);
  await writeMessages(s,'late');
  const audio=jest.fn(); await guardedWrite(s,audio);
  expect(await AsyncStorage.getItem(messageKey(s))).toBeNull(); expect(audio).not.toHaveBeenCalled();
});

test('unknown response retains data, same operation is used on retry', async () => {
  const s=scope(); await writeMessages(s,'keep');
  (axios.post as jest.Mock).mockRejectedValue({ response: { status: 503 } });
  (axios.get as jest.Mock).mockRejectedValue(new Error('timeout'));
  await expect(deletePermanently(s,'secret','operation-1')).rejects.toThrow('结果未知');
  expect(await AsyncStorage.getItem(messageKey(s))).toBe('keep');
  (axios.post as jest.Mock).mockResolvedValue({ data: { status:'deleted', character_id:s.id } });
  await deletePermanently(s,'secret','operation-2');
  expect((axios.post as jest.Mock).mock.calls[1][1].operation_id).toBe('operation-1');
  expect(await AsyncStorage.getItem(messageKey(s))).toBeNull();
});

test('timeout resolved by receipt permits cleanup', async () => {
  const s=scope(); (axios.post as jest.Mock).mockRejectedValue(new Error('timeout'));
  (axios.get as jest.Mock).mockResolvedValue({ data: { status:'deleted', character_id:s.id } });
  await deletePermanently(s,'secret','op'); expect((await deletionState(s))?.phase).toBe('complete');
});

test('server deletion with failed local cleanup is retryable without another delete', async () => {
  const s=scope(); (axios.post as jest.Mock).mockResolvedValue({ data: { status:'deleted', character_id:s.id } });
  (FS.deleteAsync as jest.Mock).mockRejectedValueOnce(new Error('disk'));
  await expect(deletePermanently(s,'secret','op')).rejects.toThrow('服务器已删除，本机清理待重试');
  expect((await deletionState(s))?.phase).toBe('server_deleted');
  await deletePermanently(s,'','different'); expect(axios.post).toHaveBeenCalledTimes(1);
  expect((await deletionState(s))?.phase).toBe('complete');
});

test('delete cancels only owned character notifications; personal task reminder preserved', async () => {
  const s=scope(); (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValueOnce([
    { identifier:'owned', content:{data:{ character_scope:scopeKey(s) }} },
    { identifier:'task', content:{data:{ character_scope:scopeKey(s), task_id:12 }} },
    { identifier:'other', content:{data:{ character_scope:scopeKey({...s,id:'Gojo'}) }} },
  ]);
  await beginDeletion(s,'op'); await markServerDeleted(s); await cleanupCharacter(s);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('owned');
});

test('insecure URL never sends credentials or deletion', async () => {
  await expect(deletePermanently({ ...scope(),server:'http://public.test' },'secret','op')).rejects.toThrow('HTTPS');
  expect(axios.post).not.toHaveBeenCalled();
});

test('global role deletion clears all cached local users and blocks their late writes', async () => {
  const s=scope(), otherUser={...s,user:'u2'}, otherRole={...s,user:'u2',id:'Gojo'};
  await writeMessages(s,'one');await writeMessages(otherUser,'two');await writeMessages(otherRole,'keep');
  await beginDeletion(s,'op');await markServerDeleted(s);await cleanupCharacter(s);
  await writeMessages(otherUser,'late');
  expect(await AsyncStorage.getItem(messageKey(s))).toBeNull();
  expect(await AsyncStorage.getItem(messageKey(otherUser))).toBeNull();
  expect(await AsyncStorage.getItem(messageKey(otherRole))).toBe('keep');
});

test('delivered notifications are dismissed for the exact deleted role across users', async () => {
 const s=scope();(Notifications.getPresentedNotificationsAsync as jest.Mock).mockResolvedValueOnce([
  {request:{identifier:'owned',content:{data:{character_scope:scopeKey({...s,user:'u2'})}}}},
  {request:{identifier:'keep',content:{data:{character_scope:scopeKey({...s,id:'Gojo'})}}}},
 ]);
 await beginDeletion(s,'op');await markServerDeleted(s);await cleanupCharacter(s);
 expect(Notifications.dismissNotificationAsync).toHaveBeenCalledTimes(1);
 expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('owned');
});

const refusal = (status: number, s: ReturnType<typeof scope>, operationId = 'op') => ({ response: {
  status, data: { detail: status === 403 ? 'invalid credential' : {
    code: 'character_delete_rolled_back', operation_id: operationId, character_id: s.id,
  } },
} });

test.each([403, 409])('first definite %s retains data and permits cancellation and new chat writes', async status => {
  const s = scope(), oldChat = captureWriteScope(s), otherUser = captureWriteScope({ ...s, user: 'u2' });
  await writeMessages(oldChat, 'history'); await writeMessages(otherUser, 'other user history');
  await setUnread(s, 3);
  (axios.post as jest.Mock).mockRejectedValueOnce(refusal(status, s));
  await expect(deletePermanently(s, 'wrong-key', 'op')).rejects.toThrow('原数据已保留');
  expect(axios.get).not.toHaveBeenCalled();
  expect((await deletionState(s))?.phase).toBe('failed');
  expect(isBlocked(s)).toBe(true);
  await expect(cleanupCharacter(s)).rejects.toThrow('尚未确认');
  expect(FS.deleteAsync).not.toHaveBeenCalled();
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(messageKey(s))).toBe('history');
  expect(await AsyncStorage.getItem(unreadKey(s))).toBe('3');
  await cancelFailedDeletion(s);
  expect(await deletionState(s)).toBeNull();
  expect(await pendingDeletions(s.server, s.user)).toEqual([]);
  expect(isBlocked(s)).toBe(false);
  expect(isBlocked(oldChat)).toBe(true);
  // Old callbacks stay invalid even after the role is unblocked, across users.
  await writeMessages(oldChat, 'stale replacement'); await writeMessages(otherUser, 'stale');
  const audio = jest.fn(); await guardedWrite(oldChat, audio);
  expect(audio).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(messageKey(s))).toBe('history');
  expect(await AsyncStorage.getItem(messageKey(otherUser))).toBe('other user history');
  const newChat = captureWriteScope(s);
  expect(isBlocked(newChat)).toBe(false);
  await writeMessages(newChat, 'history + new reply'); await setUnread(newChat, 1, true);
  expect(await AsyncStorage.getItem(messageKey(s))).toBe('history + new reply');
  expect(await AsyncStorage.getItem(unreadKey(s))).toBe('4');
});

test.each([403, 409])('an earlier unknown request stays blocked after retry %s and not_committed', async status => {
  const s = scope(); await writeMessages(s, 'history');
  (axios.post as jest.Mock).mockRejectedValueOnce(new Error('timeout')).mockRejectedValueOnce(refusal(status, s, 'original'));
  (axios.get as jest.Mock).mockResolvedValue({ data: { status: 'not_committed', operation_id: 'original' } });
  await expect(deletePermanently(s, 'valid', 'original')).rejects.toThrow('结果未知');
  await expect(deletePermanently(s, 'wrong', 'different')).rejects.toThrow('结果未知');
  expect((await deletionState(s))?.phase).toBe('pending');
  expect((await deletionState(s))?.previousOutcomeUnknown).toBe(true);
  expect((axios.post as jest.Mock).mock.calls[1][1].operation_id).toBe('original');
  await expect(cancelFailedDeletion(s)).rejects.toThrow('不能恢复聊天');
  await writeMessages(captureWriteScope(s), 'must not write');
  expect(isBlocked(s)).toBe(true);
  expect(await AsyncStorage.getItem(messageKey(s))).toBe('history');
  expect(FS.deleteAsync).not.toHaveBeenCalled();
});

test.each(['generic', 'wrong-operation', 'wrong-character'])('uncorrelated 409 (%s) never enables cancellation', async variant => {
  const s = scope(); const error: any = refusal(409, s);
  if (variant === 'generic') error.response.data.detail = 'Conflict';
  if (variant === 'wrong-operation') error.response.data.detail.operation_id = 'other';
  if (variant === 'wrong-character') error.response.data.detail.character_id = 'Gojo';
  (axios.post as jest.Mock).mockRejectedValueOnce(error);
  (axios.get as jest.Mock).mockResolvedValueOnce({ data: { status: 'not_committed' } });
  await expect(deletePermanently(s, 'key', 'op')).rejects.toThrow('结果未知');
  await expect(cancelFailedDeletion(s)).rejects.toThrow('不能恢复聊天');
});

test('duplicate service calls share one request; cancellation while inflight is refused', async () => {
  const s = scope(); let reject!: (e: unknown) => void;
  (axios.post as jest.Mock).mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
  const first = deletePermanently(s, 'bad', 'op');
  const duplicate = deletePermanently({ ...s, user: 'u2' }, 'other', 'other-op');
  expect(duplicate).toBe(first);
  const checked = expect(first).rejects.toThrow('原数据已保留');
  await new Promise(r => setImmediate(r));
  expect(axios.post).toHaveBeenCalledTimes(1);
  await expect(cancelFailedDeletion(s)).rejects.toThrow('不能恢复聊天');
  reject(refusal(403, s)); await checked;
  await cancelFailedDeletion(s); expect(isBlocked(s)).toBe(false);
});

test('cancel storage failure preserves the block and history until durable cancellation', async () => {
  const s = scope(); await writeMessages(s, 'history');
  (axios.post as jest.Mock).mockRejectedValueOnce(refusal(403, s));
  await expect(deletePermanently(s, 'bad', 'op')).rejects.toThrow('未执行');
  (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('disk failed'));
  await expect(cancelFailedDeletion(s)).rejects.toThrow('disk failed');
  expect(isBlocked(s)).toBe(true); expect((await deletionState(s))?.phase).toBe('failed');
  await cancelFailedDeletion(s);
  expect(await AsyncStorage.getItem(messageKey(s))).toBe('history');
});

test('retry queued during cancellation reinstates its fence before dispatch', async () => {
  const s = scope(); (axios.post as jest.Mock).mockRejectedValue(refusal(403, s));
  await expect(deletePermanently(s, 'bad', 'op')).rejects.toThrow('未执行');
  const cancellation = cancelFailedDeletion(s);
  const retry = deletePermanently(s, 'bad', 'new-op');
  const checked = expect(retry).rejects.toThrow('未执行');
  await cancellation;
  expect(isBlocked(s)).toBe(true);
  await checked; expect((await deletionState(s))?.phase).toBe('failed');
});

// Fresh module memory plus the SAME durable disk emulates process restart.
function restartClient() {
  let storage!: typeof import('../services/characterStorage');
  let deletion!: typeof import('../services/characterDeletion');
  jest.isolateModules(() => {
    jest.doMock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: AsyncStorage }));
    jest.doMock('axios', () => ({ __esModule: true, default: axios }));
    storage = require('../services/characterStorage');
    deletion = require('../services/characterDeletion');
  });
  return { storage, deletion };
}

test('restart preserves definite failure cancellation, data and continued chat; no credential saved', async () => {
  const s = scope(); await writeMessages(s, 'history');
  (axios.post as jest.Mock).mockRejectedValueOnce(refusal(403, s));
  await expect(deletePermanently(s, 'secret-that-must-not-persist', 'op')).rejects.toThrow('未执行');
  expect(JSON.stringify(await AsyncStorage.multiGet(await AsyncStorage.getAllKeys()))).not.toContain('secret-that-must-not-persist');
  const { storage } = restartClient();
  await storage.initializeCharacterStorage(s.server, s.user);
  expect(storage.isBlocked(s)).toBe(true); expect((await storage.deletionState(s))?.phase).toBe('failed');
  await storage.cancelFailedDeletion(s);
  await storage.writeMessages(storage.captureWriteScope(s), 'history + resumed');
  const next = restartClient().storage;
  await next.initializeCharacterStorage(s.server, s.user);
  expect(next.isBlocked(s)).toBe(false); expect(await next.pendingDeletions(s.server, s.user)).toEqual([]);
  expect(await AsyncStorage.getItem(messageKey(s))).toBe('history + resumed');
});

test.each(['crash-before-response', 'legacy-pending'])('restart of %s cannot be cleared by 403 or status absence', async variant => {
  const s = scope(); await writeMessages(s, 'history'); await beginDeletion(s, 'original');
  if (variant === 'legacy-pending') {
    const key = (await AsyncStorage.getAllKeys()).find(k => k.startsWith('character_delete:'))!;
    const saved = JSON.parse((await AsyncStorage.getItem(key))!); delete saved.previousOutcomeUnknown;
    await AsyncStorage.setItem(key, JSON.stringify(saved));
  }
  const { storage, deletion } = restartClient();
  await storage.initializeCharacterStorage(s.server, s.user);
  (axios.post as jest.Mock).mockRejectedValueOnce(refusal(403, s, 'original'));
  (axios.get as jest.Mock).mockResolvedValueOnce({ data: { status: 'not_committed' } });
  await expect(deletion.deletePermanently(s, 'bad', 'new')).rejects.toThrow('结果未知');
  await expect(storage.cancelFailedDeletion(s)).rejects.toThrow('不能恢复聊天');
  const next = restartClient().storage; await next.initializeCharacterStorage(s.server, s.user);
  expect(next.isBlocked(s)).toBe(true); expect((await next.deletionState(s))?.operationId).toBe('original');
  expect(await AsyncStorage.getItem(messageKey(s))).toBe('history');
});

test('retrying a definite failure can delete, but a timeout makes it non-cancellable', async () => {
  const s = scope(); (axios.post as jest.Mock).mockRejectedValueOnce(refusal(403, s)).mockRejectedValueOnce(new Error('timeout'));
  (axios.get as jest.Mock).mockRejectedValueOnce({ response: { status: 403 } });
  await expect(deletePermanently(s, 'bad', 'op')).rejects.toThrow('未执行');
  await expect(deletePermanently(s, 'valid', 'unused')).rejects.toThrow('结果未知');
  await expect(cancelFailedDeletion(s)).rejects.toThrow('不能恢复聊天');
  (axios.post as jest.Mock).mockResolvedValueOnce({ data: { status: 'deleted', character_id: s.id } });
  await deletePermanently(s, 'valid', 'unused');
  expect((await deletionState(s))?.phase).toBe('complete');
  await expect(cancelFailedDeletion(s)).rejects.toThrow('不能恢复聊天');
});
