// constants/theme.ts — 共享颜色和常量
export const C = {
  bg:        '#070d1a',
  card:      '#0d1a2e',
  card2:     '#0f2040',
  border:    '#1a3a5c',
  accent:    '#3b82f6',
  accent2:   '#60a5fa',
  accentDim: '#1d4ed8',
  text:      '#e8f4ff',
  textDim:   '#7ba8d0',
  textMute:  '#3d6080',
  userBubble:'#1d4ed8',
  income:    '#22c55e',
  expense:   '#ef4444',
};

export const EMOTION_COLORS: Record<string,string> = {
  平静:'#4a90a4', 自信:'#c9a84c', 嘲讽:'#8e6b9e',
  开心:'#3b82f6', 激动:'#e05c5c', 温柔:'#5ba88a',
  认真:'#2563eb', 疑惑:'#7c8fa6', 调皮:'#3b82f6',
  悲伤:'#3a5f7a', 愤怒:'#c0392b',
};

export const EMOTION_LABELS: Record<string,string> = {
  平静:'😐', 自信:'😏', 嘲讽:'🙄', 开心:'😄', 激动:'🔥',
  温柔:'🌸', 认真:'😤', 疑惑:'🤔', 调皮:'😝', 悲伤:'😔', 愤怒:'😠',
};

export const TAG_COLORS: Record<string,string> = {
  约定:'#3b82f6', 学习:'#8b5cf6', 运动:'#22c55e', 工作:'#f59e0b', 其他:'#6b7280',
};

export const TAGS = Object.keys(TAG_COLORS);
export const CATEGORIES = ['餐饮','购物','交通','娱乐','学习','医疗','收入','其他'];
export const WEEKDAYS = ['日','一','二','三','四','五','六'];
export const MONTHS = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];

import AsyncStorage from '@react-native-async-storage/async-storage';
export const DEFAULT_SERVER_URL = '';  // ★ 不硬编码，用户在设置里填自己的地址

export let SERVER_URL = DEFAULT_SERVER_URL;

// ★ 用户 ID：首次启动随机生成一次然后固化到本机
export let FIXED_USER_ID = 'default';

export const setServerUrl = async (url: string) => {
  SERVER_URL = url.replace(/\/+$/, '');
  try { await AsyncStorage.setItem('server_url', SERVER_URL); } catch {}
};

/** ★ App 启动时 await 调用一次，把存的配置恢复出来 */
export async function loadAppConfig() {
  try {
    const [s, u, uAlt] = await Promise.all([
      AsyncStorage.getItem('server_url'),
      AsyncStorage.getItem('user_id'),
      AsyncStorage.getItem('gojo_user_id'),    // ★ 老代码写的这个 key,兼容读回
    ]);
    if (s) SERVER_URL = s;
    // ★ user_id 双 key 兼容:任一存在就用,同时写回两个 key
    const chosen = u || uAlt;
    if (chosen) {
      FIXED_USER_ID = chosen;
      if (!u)    await AsyncStorage.setItem('user_id', chosen);
      if (!uAlt) await AsyncStorage.setItem('gojo_user_id', chosen);
    } else {
      const newId = 'user_' + Math.random().toString(36).slice(2, 14);
      await AsyncStorage.setItem('user_id', newId);
      await AsyncStorage.setItem('gojo_user_id', newId);
      FIXED_USER_ID = newId;
    }
  } catch (e) {
    console.warn('[theme] loadAppConfig failed', e);
  }
}

/** ★ 首页/账户/日程等页面用这个拿最新 user_id ——
 *  不要直接 import FIXED_USER_ID,因为 Metro 打包器对 `export let` 的
 *  live binding 支持不稳定,导入方可能拿到的是初始值 'default',
 *  导致 /stats 用错 user_id 查不到数据。
 *  这个函数每次都直接从 AsyncStorage 读,永远拿到最新值。 */
export async function getCurrentUserId(): Promise<string> {
  try {
    const u = await AsyncStorage.getItem('user_id')
           || await AsyncStorage.getItem('gojo_user_id');
    if (u) return u;
  } catch {}
  return FIXED_USER_ID || 'default';
}

export function uid() { return Math.random().toString(36).slice(2); }
export function nowTime() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}
export function dateKey(y:number, m:number, d:number) {
  return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
export function todayStr() {
  const d = new Date();
  return `${d.getMonth()+1}月${d.getDate()}日`;
}