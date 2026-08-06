// 日记页 —— 新增功能（原版没有）
// 列表显示所有条目；点击新建/编辑；长按删除
import axios from 'axios';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput,
  TouchableOpacity, View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, DIARY_MOODS, todayStr } from '../../constants/theme';
import { useServerConfig } from '../../hooks/useServerConfig';

interface Entry {
  id: number;
  date: string;
  mood: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export default function DiaryScreen() {
  const insets = useSafeAreaInsets();
  const { serverUrl, userId, loading: cfgLoading } = useServerConfig();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [date, setDate] = useState(todayStr());
  const [mood, setMood] = useState('');
  const [content, setContent] = useState('');

  const load = async () => {
    if (!userId) return;
    try {
      const r = await axios.get(`${serverUrl}/diary`, { params: { user_id: userId } });
      setEntries(r.data?.entries || []);
    } catch (e: any) { console.warn('load diary', e?.message); }
  };

  useFocusEffect(useCallback(() => {
    if (cfgLoading) return;
    (async () => { setLoading(true); await load(); setLoading(false); })();
  }, [serverUrl, userId, cfgLoading]));

  const openNew = () => {
    setEditingId(null);
    setDate(todayStr());
    setMood('');
    setContent('');
    setShowModal(true);
  };

  const openEdit = (e: Entry) => {
    setEditingId(e.id);
    setDate(e.date);
    setMood(e.mood);
    setContent(e.content);
    setShowModal(true);
  };

  const save = async () => {
    const c = content.trim();
    if (!c) { Alert.alert('提示', '日记内容不能为空'); return; }
    try {
      if (editingId == null) {
        await axios.post(`${serverUrl}/diary`, { user_id: userId, date, mood, content: c });
      } else {
        await axios.put(`${serverUrl}/diary/${editingId}`, { user_id: userId, date, mood, content: c });
      }
      setShowModal(false);
      await load();
    } catch (e: any) { Alert.alert('保存失败', e?.message); }
  };

  const del = (e: Entry) => {
    Alert.alert('删除日记', `确认删除 ${e.date} 的这条日记？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        try {
          await axios.delete(`${serverUrl}/diary/${e.id}`, { params: { user_id: userId } });
          setEntries(prev => prev.filter(x => x.id !== e.id));
        } catch (err: any) { Alert.alert('删除失败', err?.message); }
      }},
    ]);
  };

  if (loading) return (
    <View style={s.center}><ActivityIndicator color={C.accent} /></View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <View style={s.header}>
        <Text style={s.title}>📖 日记</Text>
      </View>

      <ScrollView contentContainerStyle={s.list}>
        {entries.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>📝</Text>
            <Text style={s.emptyText}>还没有日记{'\n'}点右下角写一篇？</Text>
          </View>
        )}
        {entries.map(e => (
          <TouchableOpacity key={e.id} style={s.card}
            onPress={() => openEdit(e)}
            onLongPress={() => del(e)}
            activeOpacity={0.75}
          >
            <View style={s.cardHead}>
              <Text style={s.cardDate}>{e.date}</Text>
              {e.mood ? <Text style={s.cardMood}>{e.mood}</Text> : null}
            </View>
            <Text style={s.cardContent} numberOfLines={4}>{e.content}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <TouchableOpacity style={s.fab} onPress={openNew} activeOpacity={0.85}>
        <Text style={s.fabText}>＋</Text>
      </TouchableOpacity>

      <Modal visible={showModal} transparent animationType="slide">
        <KeyboardAvoidingView style={s.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowModal(false)} />
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>{editingId == null ? '新建日记' : '编辑日记'}</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Text style={s.cancelText}>取消</Text>
              </TouchableOpacity>
            </View>

            <View style={s.dateRow}>
              <Text style={s.rowLabel}>日期</Text>
              <TextInput
                style={s.dateInput}
                value={date}
                onChangeText={setDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={C.textMute}
              />
            </View>

            <View style={s.moodRow}>
              <Text style={s.rowLabel}>心情</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                {DIARY_MOODS.map(m => (
                  <TouchableOpacity key={m}
                    style={[s.moodChip, mood === m && s.moodChipActive]}
                    onPress={() => setMood(mood === m ? '' : m)}
                  >
                    <Text style={[s.moodChipText, mood === m && s.moodChipTextActive]}>{m}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <TextInput
              style={s.contentInput}
              value={content}
              onChangeText={setContent}
              placeholder="今天发生了什么…"
              placeholderTextColor={C.textMute}
              multiline
            />

            <TouchableOpacity style={s.saveBtn} onPress={save}>
              <Text style={s.saveText}>保存</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
header: { paddingHorizontal: 20, paddingTop: 50, paddingBottom: 8 },  title: { color: C.text, fontSize: 26, fontWeight: '800' },
  list: { padding: 16, paddingBottom: 100 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: C.textDim, fontSize: 14, textAlign: 'center' },
  card: {
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
    borderRadius: 12, padding: 14, marginBottom: 10,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  cardDate: { color: C.accent2, fontSize: 13, fontWeight: '700', flex: 1 },
  cardMood: {
    color: C.text, fontSize: 12, backgroundColor: C.card2,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
  },
  cardContent: { color: C.text, fontSize: 14, lineHeight: 20 },
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
    padding: 20, paddingBottom: 30, maxHeight: '80%',
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { color: C.text, fontSize: 18, fontWeight: '700', flex: 1 },
  cancelText: { color: C.textDim, fontSize: 14 },
  rowLabel: { color: C.textDim, fontSize: 13, width: 40 },
  dateRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  dateInput: {
    flex: 1, color: C.text, backgroundColor: C.card2,
    borderColor: C.border, borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 14,
  },
  moodRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  moodChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    borderColor: C.border, borderWidth: 1, marginRight: 6,
  },
  moodChipActive: { backgroundColor: C.accent, borderColor: C.accent },
  moodChipText: { color: C.textDim, fontSize: 12 },
  moodChipTextActive: { color: '#fff', fontWeight: '700' },
  contentInput: {
    minHeight: 160, maxHeight: 260, color: C.text, backgroundColor: C.card2,
    borderColor: C.border, borderWidth: 1, borderRadius: 8,
    padding: 12, fontSize: 15, textAlignVertical: 'top', marginBottom: 14,
  },
  saveBtn: {
    backgroundColor: C.accent, borderRadius: 24,
    paddingVertical: 14, alignItems: 'center',
  },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
