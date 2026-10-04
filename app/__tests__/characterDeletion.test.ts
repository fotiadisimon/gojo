import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FS from 'expo-file-system/legacy';
import * as Notifications from 'expo-notifications';
import axios from 'axios';
import { beginDeletion, cleanupCharacter, deletionState, guardedWrite, initializeCharacterStorage, markServerDeleted, messageKey, migrateLegacy, scopeKey, writeMessages } from '../services/characterStorage';
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
