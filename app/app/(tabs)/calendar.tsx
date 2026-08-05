// 日程页 —— 简化版
// 保留：分类过滤、DDL、勾选完成、新建/编辑/删除
// 删除：本地通知调度、每日打卡多重提醒、原生日期/时间选择器（改成手输 YYYY-MM-DD / HH:MM）
// 通知功能公开版按需可加，不强绑 expo-notifications
import axios from 'axios';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput,
  TouchableOpacity, View
} from 'react-native';
import { C, TASK_CATEGORIES, TASK_CATEGORY_COLORS } from '../../constants/theme';
import { useServerConfig } from '../../hooks/useServerConfig';

interface Task {
  id: number;
  title: string;
  category: string;
  due_date: string | null;
  due_time: string | null;
  completed: boolean;
}

const FILTER_TABS = ['所有', ...TASK_CATEGORIES];

function friendlyDate(s: string | null): string {
  if (!s) return '无日期';
  const t = new Date(s + 'T00:00:00');
  const n = new Date(); n.setHours(0, 0, 0, 0);
  const d = Math.round((t.getTime() - n.getTime()) / 86400000);
  if (d === 0) return '今天';
  if (d === 1) return '明天';
  if (d === -1) return '昨天';
  if (d < 0) return `${-d}天前`;
  if (d < 7) return `${d}天后`;
  return s.slice(5);
}

export default function CalendarScreen() {
  const { serverUrl, userId, loading: cfgLoading } = useServerConfig();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('所有');

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [fTitle, setFTitle] = useState('');
  const [fCat, setFCat] = useState('个人');
  const [fDate, setFDate] = useState('');
  const [fTime, setFTime] = useState('');

  const load = async () => {
    if (!userId) return;
    try {
      const r = await axios.get(`${serverUrl}/tasks`, { params: { user_id: userId } });
      setTasks(r.data?.tasks || []);
    } catch (e: any) { console.warn('load tasks', e?.message); }
  };

  useFocusEffect(useCallback(() => {
    if (cfgLoading) return;
    (async () => { setLoading(true); await load(); setLoading(false); })();
  }, [serverUrl, userId, cfgLoading]));

  const openNew = () => {
    setEditing(null);
    setFTitle(''); setFCat('个人'); setFDate(''); setFTime('');
    setShowAdd(true);
  };
  const openEdit = (t: Task) => {
    setEditing(t);
    setFTitle(t.title); setFCat(t.category);
    setFDate(t.due_date || ''); setFTime(t.due_time || '');
    setShowAdd(true);
  };

  const save = async () => {
    const title = fTitle.trim();
    if (!title) { Alert.alert('提示', '标题不能为空'); return; }
    try {
      if (editing == null) {
        await axios.post(`${serverUrl}/tasks`, {
          user_id: userId, title, category: fCat,
          due_date: fDate || null, due_time: fTime || null,
        });
      } else {
        await axios.put(`${serverUrl}/tasks/${editing.id}`, {
          user_id: userId, title, category: fCat,
          due_date: fDate || null, due_time: fTime || null,
        });
      }
      setShowAdd(false);
      await load();
    } catch (e: any) { Alert.alert('保存失败', e?.message); }
  };

  const del = () => {
    if (!editing) return;
    Alert.alert('删除任务', `确认删除「${editing.title}」？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        try {
          await axios.delete(`${serverUrl}/tasks/${editing.id}`, { params: { user_id: userId } });
          setShowAdd(false);
          setTasks(prev => prev.filter(t => t.id !== editing.id));
        } catch (e: any) { Alert.alert('删除失败', e?.message); }
      }},
    ]);
  };

  const toggle = async (t: Task) => {
    try {
      await axios.put(`${serverUrl}/tasks/${t.id}`, {
        user_id: userId, completed: !t.completed,
      });
      setTasks(prev => prev.map(x => x.id === t.id ? { ...x, completed: !x.completed } : x));
    } catch (e: any) { Alert.alert('操作失败', e?.message); }
  };

  const filtered = activeTab === '所有' ? tasks : tasks.filter(t => t.category === activeTab);
  const todo = filtered.filter(t => !t.completed);
  const done = filtered.filter(t => t.completed);

  if (loading) return (
    <View style={s.center}><ActivityIndicator color={C.accent} /></View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <View style={s.header}>
        <Text style={s.title}>📅 日程</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={s.tabBarInner}>
        {FILTER_TABS.map(tab => {
          const col = TASK_CATEGORY_COLORS[tab] || C.accent;
          const active = activeTab === tab;
          return (
            <TouchableOpacity key={tab}
              style={[s.tab, active && { backgroundColor: col }]}
              onPress={() => setActiveTab(tab)}>
              <Text style={[s.tabText, active && { color: '#fff', fontWeight: '700' }]}>{tab}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={s.list}>
        {todo.length === 0 && done.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>📌</Text>
            <Text style={s.emptyText}>没有任务</Text>
          </View>
        )}
        {todo.map(t => (
          <TaskRow key={t.id} task={t} onPress={() => openEdit(t)} onCheck={() => toggle(t)} />
        ))}
        {done.length > 0 && (
          <>
            <Text style={s.sectionLabel}>已完成 ({done.length})</Text>
            {done.map(t => (
              <TaskRow key={t.id} task={t} onPress={() => openEdit(t)} onCheck={() => toggle(t)} done />
            ))}
          </>
        )}
      </ScrollView>

      <TouchableOpacity style={s.fab} onPress={openNew} activeOpacity={0.85}>
        <Text style={s.fabText}>＋</Text>
      </TouchableOpacity>

      <Modal visible={showAdd} transparent animationType="slide">
        <KeyboardAvoidingView style={s.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowAdd(false)} />
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>{editing ? '编辑任务' : '新建任务'}</Text>
              <TouchableOpacity onPress={() => setShowAdd(false)}>
                <Text style={s.cancelText}>取消</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={s.input}
              value={fTitle} onChangeText={setFTitle}
              placeholder="要做什么？" placeholderTextColor={C.textMute}
            />

            <View style={s.row}>
              <Text style={s.rowLabel}>分类</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                {TASK_CATEGORIES.map(cat => {
                  const active = cat === fCat;
                  const col = TASK_CATEGORY_COLORS[cat];
                  return (
                    <TouchableOpacity key={cat}
                      style={[s.chip, active && { backgroundColor: col, borderColor: col }]}
                      onPress={() => setFCat(cat)}>
                      <Text style={[s.chipText, active && { color: '#fff', fontWeight: '700' }]}>{cat}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            <View style={s.row}>
              <Text style={s.rowLabel}>日期</Text>
              <TextInput style={s.inputSmall}
                value={fDate} onChangeText={setFDate}
                placeholder="YYYY-MM-DD" placeholderTextColor={C.textMute}
              />
            </View>

            <View style={s.row}>
              <Text style={s.rowLabel}>时间</Text>
              <TextInput style={s.inputSmall}
                value={fTime} onChangeText={setFTime}
                placeholder="HH:MM" placeholderTextColor={C.textMute}
              />
            </View>

            <View style={s.btnRow}>
              {editing && (
                <TouchableOpacity style={s.delBtn} onPress={del}>
                  <Text style={s.delText}>删除</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={s.saveBtn} onPress={save}>
                <Text style={s.saveText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function TaskRow({ task, onPress, onCheck, done }: {
  task: Task; onPress: () => void; onCheck: () => void; done?: boolean;
}) {
  const catColor = TASK_CATEGORY_COLORS[task.category] || C.accent;
  return (
    <TouchableOpacity style={s.taskCard} onPress={onPress} activeOpacity={0.75}>
      <TouchableOpacity style={[s.check, done && { backgroundColor: catColor, borderColor: catColor }]}
        onPress={onCheck}>
        {done && <Text style={s.checkMark}>✓</Text>}
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={[s.taskTitle, done && s.taskTitleDone]} numberOfLines={2}>{task.title}</Text>
        <View style={s.taskMeta}>
          <View style={[s.catBadge, { backgroundColor: catColor + '33', borderColor: catColor }]}>
            <Text style={[s.catBadgeText, { color: catColor }]}>{task.category}</Text>
          </View>
          {task.due_date && (
            <Text style={s.taskDate}>
              {friendlyDate(task.due_date)}{task.due_time ? ' ' + task.due_time : ''}
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 20, paddingTop: 50, paddingBottom: 8 },
  title: { color: C.text, fontSize: 26, fontWeight: '800' },
  tabBar: { maxHeight: 44, marginBottom: 4 },
  tabBarInner: { paddingHorizontal: 12, paddingVertical: 6 },
  tab: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16,
    borderColor: C.border, borderWidth: 1, marginRight: 6,
    backgroundColor: C.card,
  },
  tabText: { color: C.textDim, fontSize: 12 },
  list: { padding: 16, paddingBottom: 100 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: C.textDim, fontSize: 14 },
  sectionLabel: { color: C.textMute, fontSize: 12, marginTop: 20, marginBottom: 8, marginLeft: 4 },
  taskCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
    borderRadius: 12, padding: 12, marginBottom: 10,
  },
  check: {
    width: 24, height: 24, borderRadius: 12,
    borderColor: C.border, borderWidth: 2, marginRight: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  checkMark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  taskTitle: { color: C.text, fontSize: 15, fontWeight: '600' },
  taskTitleDone: { color: C.textMute, textDecorationLine: 'line-through' },
  taskMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  catBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
    borderWidth: 1, marginRight: 8,
  },
  catBadgeText: { fontSize: 11, fontWeight: '600' },
  taskDate: { color: C.textDim, fontSize: 12 },
  fab: {
    position: 'absolute', bottom: 24, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center',
    elevation: 6,
  },
  fabText: { color: '#fff', fontSize: 28, fontWeight: '700' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 30,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { color: C.text, fontSize: 18, fontWeight: '700', flex: 1 },
  cancelText: { color: C.textDim, fontSize: 14 },
  input: {
    color: C.text, backgroundColor: C.card2,
    borderColor: C.border, borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 12,
  },
  inputSmall: {
    flex: 1, color: C.text, backgroundColor: C.card2,
    borderColor: C.border, borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  rowLabel: { color: C.textDim, fontSize: 13, width: 40 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    borderColor: C.border, borderWidth: 1, marginRight: 6,
  },
  chipText: { color: C.textDim, fontSize: 12 },
  btnRow: { flexDirection: 'row', marginTop: 8 },
  saveBtn: {
    flex: 1, backgroundColor: C.accent, borderRadius: 24,
    paddingVertical: 14, alignItems: 'center',
  },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  delBtn: {
    backgroundColor: C.danger + '33', borderColor: C.danger, borderWidth: 1,
    borderRadius: 24, paddingVertical: 14, paddingHorizontal: 24, marginRight: 10,
  },
  delText: { color: C.danger, fontSize: 15, fontWeight: '700' },
});
