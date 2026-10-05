import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Notifications from 'expo-notifications';

export type Scope = { server: string; user: string; id: string; writeGeneration?: number };
export type DeleteState = Scope & {
  operationId: string;
  phase: 'pending' | 'failed' | 'server_deleted' | 'complete';
  // Pending is always uncertain on reload/retry, including old v1 records.
  // This flag describes attempts BEFORE the currently dispatched request.
  previousOutcomeUnknown?: boolean;
};
export const normalizeServer = (server: string) => server.trim().replace(/\/+$/, '');
export const scopeKey = (s: Scope) => JSON.stringify([normalizeServer(s.server), s.user, s.id]);
const token = (s: Scope) => encodeURIComponent(scopeKey(s));
const chunkToken = (value: string): string[] => {
  const chunks: string[] = [];
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + 80, value.length);
    if (end < value.length) {
      if (value[end - 1] === '%') end -= 1;
      else if (value[end - 2] === '%') end -= 2;
    }
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
};
export const messageKey = (s: Scope) => `chat_v2:${token(s)}:messages`;
export const unreadKey = (s: Scope) => `chat_v2:${token(s)}:unread`;
export const proactiveKey = (s: Scope) => `chat_v2:${token(s)}:proactive`;
export const audioDirectory = (s: Scope) => `${FileSystem.documentDirectory}chat_v2/${chunkToken(token(s)).join('/')}/files/`;
export async function ensureAudioDirectory(s: Scope): Promise<void> {
  const dir = audioDirectory(s);
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  else if (!info.isDirectory) throw new Error(`Audio cache path is not a directory: ${dir}`);
}
export async function writeAudioFile(s: Scope, msgId: string, base64: string): Promise<string | null> {
  if (!msgId || !base64) return null;
  try {
    return await guardedWrite(s, async () => {
      await ensureAudioDirectory(s);
      const uri = `${audioDirectory(s)}${encodeURIComponent(msgId)}.mp3`;
      await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
      return uri;
    }) ?? null;
  } catch (error) {
    console.warn('saveAudioFile', error);
    return null;
  }
}
export function clearAudioDirectory(s: Scope): Promise<void | undefined> {
  return guardedWrite(s, () => FileSystem.deleteAsync(audioDirectory(s), { idempotent: true }));
}
const deletionKey = (s: Scope) => JSON.stringify([normalizeServer(s.server), s.id]);
const stateKey = (s: Scope) => `character_delete:${encodeURIComponent(deletionKey(s))}`;
const LEGACY_OWNER = 'chat_legacy_owner_v1';
const listeners = new Set<(s: Scope) => void>();
const blocked = new Set<string>();
const generations = new Map<string, number>();
let queue: Promise<unknown> = Promise.resolve();

// All character-owned disk mutations use this queue, including already unmounted
// screens. Deletion sets the in-memory fence synchronously, then drains writes.
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.catch(() => {});
  return result;
}
export const subscribeDeletion = (listener: (s: Scope) => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const generation = (s: Scope) => generations.get(deletionKey(s)) || 0;
const invalidateWriters = (s: Scope) => generations.set(deletionKey(s), generation(s) + 1);
// Capture once per chat mount. Unblocking permits a new chat, never callbacks
// belonging to a chat that was stopped by a deletion attempt.
export const captureWriteScope = (s: Scope): Scope => ({ ...s, writeGeneration: generation(s) });
export const isBlocked = (s: Scope) => blocked.has(deletionKey(s)) ||
  (s.writeGeneration !== undefined && s.writeGeneration !== generation(s));

export async function initializeCharacterStorage(server: string, user: string) {
  await serial(async () => {
    if (server && !(await AsyncStorage.getItem(LEGACY_OWNER))) {
      // Old keys have no provenance. Claim them ONCE for the configured server
      // at upgrade, never for a subsequently selected server.
      await AsyncStorage.setItem(LEGACY_OWNER, JSON.stringify([normalizeServer(server), user]));
    }
    for (const key of await AsyncStorage.getAllKeys()) {
      if (!key.startsWith('character_delete:')) continue;
      const raw = await AsyncStorage.getItem(key);
      if (raw) blocked.add(deletionKey(JSON.parse(raw)));
    }
  });
}

async function ownsLegacy(s: Scope) {
  return await AsyncStorage.getItem(LEGACY_OWNER) === JSON.stringify([normalizeServer(s.server), s.user]);
}
export async function deletionState(s: Scope): Promise<DeleteState | null> {
  const raw = await AsyncStorage.getItem(stateKey(s));
  return raw ? JSON.parse(raw) : null;
}
export async function pendingDeletions(server: string, user: string): Promise<DeleteState[]> {
  const result: DeleteState[] = [];
  for (const key of await AsyncStorage.getAllKeys()) {
    if (!key.startsWith('character_delete:')) continue;
    const raw = await AsyncStorage.getItem(key);
    if (!raw) continue;
    const state: DeleteState = JSON.parse(raw);
    if (normalizeServer(state.server) === normalizeServer(server) && state.phase !== 'complete') result.push(state);
  }
  return result;
}
export function beginDeletion(s: Scope, operationId: string): Promise<DeleteState> {
  blocked.add(deletionKey(s));
  invalidateWriters(s);
  listeners.forEach(listener => listener(s));
  return serial(async () => {
    const old = await deletionState(s);
    if (old?.phase === 'server_deleted' || old?.phase === 'complete') return old;
    const state: DeleteState = {
      server: s.server, user: s.user, id: s.id,
      operationId: old?.operationId || operationId, phase: 'pending',
      previousOutcomeUnknown: !!old && old.phase !== 'failed',
    };
    // Persist BEFORE dispatch. A crash at any later point must leave an
    // uncertain operation, even if its response was never processed.
    await AsyncStorage.setItem(stateKey(s), JSON.stringify(state));
    return state;
  });
}
export function markDefinitiveFailure(s: Scope, operationId: string): Promise<boolean> {
  return serial(async () => {
    const state = await deletionState(s);
    if (state?.phase !== 'pending' || state.operationId !== operationId || state.previousOutcomeUnknown !== false) return false;
    await AsyncStorage.setItem(stateKey(s), JSON.stringify({ ...state, phase: 'failed' }));
    return true;
  });
}
export function cancelFailedDeletion(s: Scope): Promise<void> {
  const cancelledGeneration = generation(s);
  return serial(async () => {
    const state = await deletionState(s);
    if (state?.phase !== 'failed') throw new Error('删除结果未明确失败，不能恢复聊天；请查询／重试同一操作。');
    // Do not remove a fence installed by a retry queued after this cancellation.
    await AsyncStorage.removeItem(stateKey(s));
    const retryStarted = generation(s) !== cancelledGeneration;
    invalidateWriters(s);
    if (!retryStarted) blocked.delete(deletionKey(s));
  });
}
export function markServerDeleted(s: Scope): Promise<void> {
  return serial(async () => {
    const state = await deletionState(s);
    if (!state) throw new Error('缺少本地删除操作记录');
    await AsyncStorage.setItem(stateKey(s), JSON.stringify({ ...state, phase: 'server_deleted' }));
  });
}
export function guardedWrite<T>(s: Scope, fn: () => Promise<T>): Promise<T | undefined> {
  return serial(async () => {
    if (isBlocked(s) || await deletionState(s)) return undefined;
    await AsyncStorage.setItem(`chat_scope:${token(s)}`, scopeKey(s));
    return fn();
  });
}
export function writeMessages(s: Scope, json: string) {
  return guardedWrite(s, () => AsyncStorage.setItem(messageKey(s), json));
}
export function setUnread(s: Scope, count: number, increment = false) {
  return guardedWrite(s, async () => {
    const old = increment ? Number(await AsyncStorage.getItem(unreadKey(s)) || 0) : 0;
    await AsyncStorage.setItem(unreadKey(s), String(old + count));
  });
}

export function migrateLegacy(s: Scope): Promise<void> {
  return serial(async () => {
    if (isBlocked(s) || await deletionState(s) || !(await ownsLegacy(s))) return;
    await AsyncStorage.setItem(`chat_scope:${token(s)}`, scopeKey(s));
    for (const [oldKey, newKey] of [[`chat_msgs_${s.id}`, messageKey(s)], [`char_unread_${s.id}`, unreadKey(s)]]) {
      const old = await AsyncStorage.getItem(oldKey);
      if (old !== null) {
        if (await AsyncStorage.getItem(newKey) === null) await AsyncStorage.setItem(newKey, old);
        await AsyncStorage.removeItem(oldKey);
      }
    }
    // The old proactive map is taskId_date => flags, written only by exact gojo.
    if (s.id === 'gojo') {
      const old = await AsyncStorage.getItem('gojo_proactive_state');
      if (old !== null) {
        if (await AsyncStorage.getItem(proactiveKey(s)) === null) await AsyncStorage.setItem(proactiveKey(s), old);
        await AsyncStorage.removeItem('gojo_proactive_state');
      }
    }
    // Old filesystem paths were not escaped; never interpret an ID as a path.
    if (/^[a-zA-Z0-9_-]{1,128}$/.test(s.id)) {
      const oldDir = `${FileSystem.documentDirectory}chat_audio_${s.id}/`;
      if ((await FileSystem.getInfoAsync(oldDir)).exists) {
        const target = audioDirectory(s);
        await FileSystem.makeDirectoryAsync(target, { intermediates: true });
        for (const file of await FileSystem.readDirectoryAsync(oldDir)) {
          if (!/^[\w.-]+\.mp3$/.test(file)) throw new Error('旧语音目录存在未知文件，需人工核对');
          if (!(await FileSystem.getInfoAsync(target + file)).exists) await FileSystem.copyAsync({ from: oldDir + file, to: target + file });
        }
        await FileSystem.deleteAsync(oldDir, { idempotent: true });
      }
    }
  });
}

export function cleanupCharacter(s: Scope): Promise<void> {
  blocked.add(deletionKey(s));
  listeners.forEach(listener => listener(s));
  return serial(async () => {
    const state = await deletionState(s);
    if (!state || (state.phase !== 'server_deleted' && state.phase !== 'complete')) throw new Error('服务器删除结果尚未确认');
    // Backend deletion covers all users. On this phone erase this exact
    // server/character for every cached user, preserving other servers/IDs.
    const scopes = new Map<string, Scope>([[scopeKey(s), s]]);
    for (const key of await AsyncStorage.getAllKeys()) {
      const match = key.match(/^chat_v2:(.+):(messages|unread|proactive|draft)$/) || key.match(/^chat_scope:(.+)$/);
      if (!match) continue;
      const [server, user, id] = JSON.parse(decodeURIComponent(match[1]));
      if (normalizeServer(server) === normalizeServer(s.server) && id === s.id) {
        const owned = { server, user, id };
        scopes.set(scopeKey(owned), owned);
      }
    }
    for (const owned of scopes.values()) {
      await AsyncStorage.multiRemove([messageKey(owned), unreadKey(owned), proactiveKey(owned), `chat_v2:${token(owned)}:draft`]);
      await FileSystem.deleteAsync(audioDirectory(owned), { idempotent: true });
      await AsyncStorage.removeItem(`chat_scope:${token(owned)}`);
    }
    const legacyRaw = await AsyncStorage.getItem(LEGACY_OWNER);
    if (legacyRaw && JSON.parse(legacyRaw)[0] === normalizeServer(s.server)) {
      await AsyncStorage.multiRemove([`chat_msgs_${s.id}`, `char_unread_${s.id}`]);
      if (s.id === 'gojo') await AsyncStorage.removeItem('gojo_proactive_state');
      if (/^[a-zA-Z0-9_-]{1,128}$/.test(s.id)) {
        await FileSystem.deleteAsync(`${FileSystem.documentDirectory}chat_audio_${s.id}/`, { idempotent: true });
      }
    }
    const belongsToDeleted = (value: unknown) => {
      if (typeof value !== 'string') return false;
      try {
        const [server, , id] = JSON.parse(value);
        return normalizeServer(server) === normalizeServer(s.server) && id === s.id;
      } catch { return false; }
    };
    for (const notification of await Notifications.getAllScheduledNotificationsAsync()) {
      const data = notification.content.data;
      // Personal task reminders remain, even if a character originally suggested them.
      if (belongsToDeleted(data?.character_scope) && !data?.task_id) await Notifications.cancelScheduledNotificationAsync(notification.identifier);
    }
    for (const notification of await Notifications.getPresentedNotificationsAsync()) {
      if (belongsToDeleted(notification.request.content.data?.character_scope)) await Notifications.dismissNotificationAsync(notification.request.identifier);
    }
    await AsyncStorage.setItem(stateKey(s), JSON.stringify({ ...state, phase: 'complete' }));
  });
}
