// 聊天 tab —— 角色列表页（跟完整版一样是"会话列表"）
// 点角色卡片 → 进单聊；点右上角 ➕ → 新建角色；长按角色卡片 → 编辑/删除
import axios from 'axios';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput,
  TouchableOpacity, View
} from 'react-native';
import { C } from '../../constants/theme';
import { useServerConfig } from '../../hooks/useServerConfig';

interface Character {
  id: string;
  name: string;
  core_prompt: string;
  greeting: string;
  voice_id: string;
  avatar_emoji: string;
}

const EMOJI_CHOICES = ['🤖', '🕶️', '🎭', '🎨', '📚', '💫', '🌸', '⚡', '🔮', '🌙', '☕', '🎮'];

export default function ChatListScreen() {
  const router = useRouter();
  const { serverUrl, loading: cfgLoading } = useServerConfig();
  const [chars, setChars] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);

  const [showEditor, setShowEditor] = useState(false);
  const [editingOriginalId, setEditingOriginalId] = useState<string | null>(null);
  const [fId, setFId] = useState('');
  const [fName, setFName] = useState('');
  const [fPrompt, setFPrompt] = useState('');
  const [fGreeting, setFGreeting] = useState('');
  const [fVoiceId, setFVoiceId] = useState('');
  const [fEmoji, setFEmoji] = useState('🤖');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const r = await axios.get(`${serverUrl}/characters`, { timeout: 8000 });
      setChars(r.data?.characters || []);
    } catch (e: any) { console.warn('load chars', e?.message); }
  };

  useFocusEffect(useCallback(() => {
    if (cfgLoading) return;
    (async () => { setLoading(true); await load(); setLoading(false); })();
  }, [serverUrl, cfgLoading]));

  const openNew = () => {
    setEditingOriginalId(null);
    setFId(''); setFName(''); setFPrompt('');
    setFGreeting(''); setFVoiceId(''); setFEmoji('🤖');
    setShowEditor(true);
  };

  const openEdit = (c: Character) => {
    setEditingOriginalId(c.id);
    setFId(c.id); setFName(c.name); setFPrompt(c.core_prompt);
    setFGreeting(c.greeting || ''); setFVoiceId(c.voice_id || '');
    setFEmoji(c.avatar_emoji || '🤖');
    setShowEditor(true);
  };

  const longPress = (c: Character) => {
    Alert.alert(c.name, undefined, [
      { text: '编辑', onPress: () => openEdit(c) },
      { text: '删除', style: 'destructive', onPress: () => del(c) },
      { text: '取消', style: 'cancel' },
    ]);
  };

  const del = (c: Character) => {
    Alert.alert('删除角色', `删除「${c.name}」？其聊天历史不会自动删除，但对话再也拉不出来了。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        try {
          await axios.delete(`${serverUrl}/characters/${c.id}`);
          await load();
        } catch (e: any) { Alert.alert('删除失败', e?.message); }
      }},
    ]);
  };

  const save = async () => {
    const id = fId.trim();
    const name = fName.trim();
    const prompt = fPrompt.trim();
    if (!id) { Alert.alert('提示', '请填 id（1-32 位字母/数字/下划线/连字符）'); return; }
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id)) { Alert.alert('提示', 'id 只能是字母/数字/下划线/连字符'); return; }
    if (!name) { Alert.alert('提示', '请填名字'); return; }
    if (!prompt) { Alert.alert('提示', '请填人设 Prompt'); return; }

    setSaving(true);
    try {
      await axios.post(`${serverUrl}/characters`, {
        id, name, core_prompt: prompt,
        greeting: fGreeting.trim(),
        voice_id: fVoiceId.trim(),
        avatar_emoji: fEmoji,
      });
      setShowEditor(false);
      await load();
    } catch (e: any) {
      Alert.alert('保存失败', e?.response?.data?.error || e?.message);
    } finally { setSaving(false); }
  };

  if (loading) return (
    <View style={s.center}><ActivityIndicator color={C.accent} /></View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={C.card} />

      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>💬 聊天</Text>
          <Text style={s.sub}>{chars.length} 个角色</Text>
        </View>
        <TouchableOpacity style={s.addBtn} onPress={openNew}>
          <Text style={s.addText}>➕ 新角色</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.list}>
        {chars.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>🕳️</Text>
            <Text style={s.emptyText}>还没有角色{'\n'}点右上角 ➕ 加一个？</Text>
          </View>
        )}
        {chars.map(c => (
          <TouchableOpacity key={c.id} style={s.card}
            onPress={() => router.push(`/chat/${c.id}` as any)}
            onLongPress={() => longPress(c)}
            activeOpacity={0.75}
          >
            <View style={s.avatar}>
              <Text style={s.avatarText}>{c.avatar_emoji || '🤖'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardName}>{c.name}</Text>
              <Text style={s.cardId}>@{c.id}</Text>
              {c.greeting ? (
                <Text style={s.cardGreeting} numberOfLines={1}>「{c.greeting}」</Text>
              ) : null}
            </View>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal visible={showEditor} transparent animationType="slide">
        <KeyboardAvoidingView style={s.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowEditor(false)} />
          <View style={s.sheet}>
            <ScrollView>
              <View style={s.sheetHead}>
                <Text style={s.sheetTitle}>{editingOriginalId ? '编辑角色' : '新建角色'}</Text>
                <TouchableOpacity onPress={() => setShowEditor(false)}>
                  <Text style={s.cancelText}>取消</Text>
                </TouchableOpacity>
              </View>

              <Text style={s.formLabel}>头像 emoji</Text>
              <View style={s.emojiRow}>
                {EMOJI_CHOICES.map(e => (
                  <TouchableOpacity key={e}
                    style={[s.emojiChip, fEmoji === e && s.emojiChipActive]}
                    onPress={() => setFEmoji(e)}>
                    <Text style={s.emojiText}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={s.formLabel}>id（英文，创建后请勿改动）</Text>
              <TextInput
                style={[s.input, editingOriginalId && s.inputReadonly]}
                value={fId}
                onChangeText={setFId}
                placeholder="例如 gojo、my_ai"
                placeholderTextColor={C.textMute}
                autoCapitalize="none"
                editable={!editingOriginalId}
              />

              <Text style={s.formLabel}>名字（显示用）</Text>
              <TextInput
                style={s.input}
                value={fName} onChangeText={setFName}
                placeholder="例如 五条悟" placeholderTextColor={C.textMute}
              />

              <Text style={s.formLabel}>人设 Prompt ★</Text>
              <TextInput
                style={[s.input, { minHeight: 140, textAlignVertical: 'top' }]}
                value={fPrompt} onChangeText={setFPrompt}
                placeholder="TA 是谁？说话怎么样？喜欢/讨厌什么？&#10;越具体越"入戏"。可以写好几段。"
                placeholderTextColor={C.textMute}
                multiline
              />

              <Text style={s.formLabel}>开场白（可选）</Text>
              <TextInput
                style={s.input}
                value={fGreeting} onChangeText={setFGreeting}
                placeholder="打开对话时首页/聊天页会显示" placeholderTextColor={C.textMute}
              />

              <Text style={s.formLabel}>Fish Voice ID（可选，用于 TTS）</Text>
              <TextInput
                style={s.input}
                value={fVoiceId} onChangeText={setFVoiceId}
                placeholder="Fish Audio 的 reference_id" placeholderTextColor={C.textMute}
                autoCapitalize="none"
              />

              <TouchableOpacity
                style={[s.saveBtn, saving && { opacity: 0.5 }]}
                onPress={save} disabled={saving}
              >
                <Text style={s.saveText}>{saving ? '保存中…' : '保存'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 50, paddingBottom: 12,
  },
  title: { color: C.text, fontSize: 26, fontWeight: '800' },
  sub: { color: C.textDim, fontSize: 12, marginTop: 2 },
  addBtn: {
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: C.accent, borderRadius: 8,
  },
  addText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  list: { padding: 16, paddingBottom: 30 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: C.textDim, fontSize: 14, textAlign: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
    borderRadius: 12, padding: 14, marginBottom: 10,
  },
  avatar: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: C.card2, borderColor: C.border, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  avatarText: { fontSize: 22 },
  cardName: { color: C.text, fontSize: 16, fontWeight: '700' },
  cardId: { color: C.textMute, fontSize: 11, marginTop: 2 },
  cardGreeting: { color: C.textDim, fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  chevron: { color: C.textMute, fontSize: 28, marginLeft: 8 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 30, maxHeight: '90%',
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { color: C.text, fontSize: 18, fontWeight: '700', flex: 1 },
  cancelText: { color: C.textDim, fontSize: 14 },
  formLabel: { color: C.textDim, fontSize: 12, marginBottom: 6, marginTop: 10 },
  input: {
    color: C.text, backgroundColor: C.card2,
    borderColor: C.border, borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
  },
  inputReadonly: { opacity: 0.5 },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap' },
  emojiChip: {
    width: 44, height: 44, borderRadius: 22,
    borderColor: C.border, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 8, marginBottom: 8,
    backgroundColor: C.card2,
  },
  emojiChipActive: { borderColor: C.accent, backgroundColor: C.accent + '33' },
  emojiText: { fontSize: 22 },
  saveBtn: {
    backgroundColor: C.accent, borderRadius: 24,
    paddingVertical: 14, alignItems: 'center', marginTop: 20,
  },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
