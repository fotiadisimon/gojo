// 沿用完整版的暗色主题色
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
  danger:    '#ef4444',
};

// 11 种情绪配色（跟后端 EMOTIONS 一一对应）
export const EMOTION_COLORS: Record<string, string> = {
  平静: '#4a90a4', 自信: '#c9a84c', 嘲讽: '#8e6b9e',
  开心: '#3b82f6', 激动: '#e05c5c', 温柔: '#5ba88a',
  认真: '#2563eb', 疑惑: '#7c8fa6', 调皮: '#3b82f6',
  悲伤: '#3a5f7a', 愤怒: '#c0392b',
};

export const EMOTION_LABELS: Record<string, string> = {
  平静: '😐', 自信: '😏', 嘲讽: '🙄', 开心: '😄', 激动: '🔥',
  温柔: '🌸', 认真: '😤', 疑惑: '🤔', 调皮: '😝', 悲伤: '😔', 愤怒: '😠',
};

// 记账分类
export const ACCOUNTING_CATEGORIES = ['餐饮', '购物', '交通', '娱乐', '学习', '医疗', '收入', '其他'];

// 日程分类
export const TASK_CATEGORIES = ['个人', '工作', '心愿单', '纪念日'];
export const TASK_CATEGORY_COLORS: Record<string, string> = {
  工作:   '#3b82f6',
  个人:   '#0e7490',
  心愿单: '#d97706',
  纪念日: '#e879a0',
};

// 日记心情
export const DIARY_MOODS = ['开心', '平静', '难过', '生气', '兴奋', '疲惫'];

// SERVER_URL 是运行时可改的，见 hooks/useServerConfig.ts
// 默认值：Android 模拟器 → 10.0.2.2；iOS 模拟器 / web → localhost。
// 真机环境用户必须在"设置"页填自己的后端地址。
import { Platform } from 'react-native';
export const DEFAULT_SERVER_URL = Platform.select({
  android: 'http://10.0.2.2:8080',
  default: 'http://localhost:8080',
}) as string;

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function uid(): string {
  return Math.random().toString(36).slice(2);
}
