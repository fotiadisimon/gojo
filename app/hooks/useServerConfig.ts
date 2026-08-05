// 全局配置 hook：SERVER_URL 和 USER_ID
// SERVER_URL 用户可以在"设置"页里改；USER_ID 首次运行随机生成一次然后固化。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SERVER_URL, uid } from '../constants/theme';

const KEY_SERVER = 'gojo_server_url';
const KEY_USER = 'gojo_user_id';

// 全局订阅者列表 —— 一个地方改，其他页面立刻重新加载
type Sub = (v: string) => void;
const subs = new Set<Sub>();

let cachedServerUrl = DEFAULT_SERVER_URL;
let cachedUserId = '';

export function useServerConfig() {
  const [serverUrl, setServerUrlState] = useState(cachedServerUrl);
  const [userId, setUserIdState] = useState(cachedUserId);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [s, u] = await Promise.all([
        AsyncStorage.getItem(KEY_SERVER),
        AsyncStorage.getItem(KEY_USER),
      ]);
      if (s) {
        cachedServerUrl = s;
        setServerUrlState(s);
      }
      let currentUid = u;
      if (!currentUid) {
        currentUid = 'user_' + uid();
        await AsyncStorage.setItem(KEY_USER, currentUid);
      }
      cachedUserId = currentUid;
      setUserIdState(currentUid);
      setLoading(false);
    })();

    const sub: Sub = (v) => setServerUrlState(v);
    subs.add(sub);
    return () => { subs.delete(sub); };
  }, []);

  const setServerUrl = useCallback(async (v: string) => {
    const trimmed = v.trim().replace(/\/$/, '');
    cachedServerUrl = trimmed;
    await AsyncStorage.setItem(KEY_SERVER, trimmed);
    subs.forEach((f) => f(trimmed));
  }, []);

  return { serverUrl, userId, setServerUrl, loading };
}

// 供非 React 场景用（不推荐，只在必要时）
export function getServerUrl() {
  return cachedServerUrl;
}
export function getUserId() {
  return cachedUserId;
}
