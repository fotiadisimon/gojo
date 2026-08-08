// 角色编辑页 —— /character/new 是新建，/character/<id> 是编辑
import axios from 'axios';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform,
  ScrollView, StatusBar, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SERVER_URL } from '../../constants/theme';

interface MemItem {
  id?: number;
  content: string;
  category: string;
  keywords: string;
  importance: number;
}

const MEM_CATEGORIES = ['身世', '性格', '关系', '习惯', '经历', '其他'];

export default function CharacterEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const isNew = rawId === 'new';
  const charId = isNew ? '' : (rawId || '');

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  const [fId, setFId] = useState('');
  const [fName, setFName] = useState('');
  const [fNameEn, setFNameEn] = useState('');
  const [fAvatar, setFAvatar] = useState('');
  const [fVoiceId, setFVoiceId] = useState('');
  const [fPrompt, setFPrompt] = useState('');
  const [fCanon, setFCanon] = useState('');
  const [fGreeting, setFGreeting] = useState('');

  const [mems, setMems] = useState<MemItem[]>([]);
  const [showMemForm, setShowMemForm] = useState(false);
  const [mContent, setMContent] = useState('');
  const [mCategory, setMCategory] = useState('其他');
  const [mKeywords, setMKeywords] = useState('');
  const [mImportance, setMImportance] = useState('0.5');

  useEffect(() => {
    if (isNew) { setLoading(false); return; }
    (async () => {
      try {
        const [cRes, mRes] = await Promise.all([
          axios.get(`${SERVER_URL}/characters/${charId}`, { timeout: 10000 }),
          axios.get(`${SERVER_URL}/character_memory`, {
            params: { character_id: charId }, timeout: 10000,
          }).catch(() => ({ data: {} })),
        ]);
        const c = cRes.data || {};
        setFId(c.id || '');
        setFName(c.name || '');
        setFNameEn(c.name_en || '');
        setFAvatar(c.avatar_url || '');
        setFVoiceId(c.voice_id || '');
        setFPrompt(c.core_prompt || '');
        setFCanon(c.canon_lock || '');
        setFGreeting(c.greeting || '');
        setMems(mRes.data?.memories || []);
      } catch (e: any) {
        console.warn('[character] load failed', e?.message);
        Alert.alert('加载失败', e?.message || '请检查后端连接');
      } finally { setLoading(false); }
    })();
  }, [charId, isNew]);

  const pickAvatar = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('权限', '需要相册权限'); return; }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], quality: 0.5, base64: true,
        allowsEditing: true, aspect: [1, 1],
      });
      if (res.canceled || !res.assets?.[0]?.base64) return;
      const a = res.assets[0];
      setFAvatar(`data:${a.mimeType || 'image/jpeg'};base64,${a.base64}`);
    } catch (e: any) {
      console.warn('[character] pick avatar', e?.message);
      Alert.alert('选图失败', e?.message);
    }
  };

  const save = async () => {
    const id = fId.trim();
    const name = fName.trim();
    const prompt = fPrompt.trim();
    if (!id || !/^[a-zA-Z0-9_-]{1,32}$/.test(id)) {
      Alert.alert('提示', 'id 只能是英文/数字/下划线/连字符，1-32 位');
      console.warn('[character] 无效 id');
      return;
    }
    if (!name) { Alert.alert('提示', '名字不能为空'); return; }
    if (!prompt) { Alert.alert('提示', '人设 Prompt 不能为空'); return; }

    setSaving(true);
    try {
      if (isNew) {
        await axios.post(`${SERVER_URL}/characters`, {
          id, name,
          name_en: fNameEn.trim(),
          avatar_url: fAvatar,
          voice_id: fVoiceId.trim(),
          core_prompt: prompt,
          canon_lock: fCanon.trim(),
          greeting: fGreeting.trim(),
        }, { timeout: 30000 });
      } else {
        await axios.put(`${SERVER_URL}/characters/${charId}`, {
          name,
          name_en: fNameEn.trim(),
          avatar_url: fAvatar,
          voice_id: fVoiceId.trim(),
          core_prompt: prompt,
          canon_lock: fCanon.trim(),
          greeting: fGreeting.trim(),
        }, { timeout: 30000 });
      }
      // 浏览器里 Alert 不弹窗，直接返回更可靠
      router.back();
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || '未知错误';
      console.warn('[character] save failed', msg);
      Alert.alert('保存失败', msg);
    } finally { setSaving(false); }
  };

  const reloadMems = async () => {
    try {
      const r = await axios.get(`${SERVER_URL}/character_memory`, {
        params: { character_id: charId },
      });
      setMems(r.data?.memories || []);
    } catch (e: any) {
      console.warn('[character] reload memories', e?.message);
    }
  };

  const addMem = async () => {
    const content = mContent.trim();
    if (!content) { Alert.alert('提示', '记忆内容不能为空'); return; }
    if (isNew) { Alert.alert('提示', '先保存角色，再加背景记忆'); return; }
    try {
      await axios.post(`${SERVER_URL}/character_memory`, {
        character_id: charId,
        content,
        category: mCategory,
        keywords: mKeywords.trim(),
        importance: parseFloat(mImportance) || 0.5,
      });
      setMContent(''); setMKeywords(''); setMImportance('0.5');
      setShowMemForm(false);
      await reloadMems();
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message;
      console.warn('[character] add memory', msg);
      Alert.alert('添加失败', msg);
    }
  };

  const delMem = (m: MemItem) => {
    Alert.alert('删除记忆', m.content.slice(0, 40), [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        try {
          await axios.delete(`${SERVER_URL}/character_memory/${m.id}`);
          setMems(prev => prev.filter(x => x.id !== m.id));
        } catch (e: any) {
          console.warn('[character] del memory', e?.message);
          Alert.alert('删除失败', e?.message);
        }
      }},
    ]);
  };

  if (loading) return (
    <View style={s.center}><ActivityIndicator color={C.accent} /></View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="light-content" backgroundColor={C.card} />

      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{isNew ? '新建角色' : '编辑角色'}</Text>
        <TouchableOpacity onPress={save} disabled={saving} style={s.saveTopBtn}>
          <Text style={s.saveTopText}>{saving ? '…' : '保存'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>

        {/* 头像 */}
        <View style={s.avatarSection}>
          <TouchableOpacity onPress={pickAvatar} activeOpacity={0.8}>
            <View style={s.avatarBox}>
              {fAvatar ? (
                <Image source={{ uri: fAvatar }} style={s.avatarImg} />
              ) : (
                <Text style={s.avatarPlaceholder}>＋</Text>
              )}
            </View>
          </TouchableOpacity>
          <Text style={s.avatarHint}>点击上传头像</Text>
        </View>

        <Field label="id（英文，创建后不可改）">
          <TextInput
            style={[s.input, !isNew && s.inputDisabled]}
            value={fId} onChangeText={setFId}
            placeholder="例如 gojo、my_ai"
            placeholderTextColor={C.textMute}
            autoCapitalize="none" autoCorrect={false}
            editable={isNew}
          />
        </Field>

        <Field label="名字（显示用）">
          <TextInput style={s.input} value={fName} onChangeText={setFName}
            placeholder="例如 五条悟" placeholderTextColor={C.textMute} />
        </Field>

        <Field label="英文名（可选）">
          <TextInput style={s.input} value={fNameEn} onChangeText={setFNameEn}
            placeholder="Gojo Satoru" placeholderTextColor={C.textMute}
            autoCapitalize="none" autoCorrect={false} />
        </Field>

        <Field label="核心人设 Prompt ★" hint="TA 是谁、说话什么风格、喜欢讨厌什么。越具体越入戏">
          <TextInput
            style={[s.input, s.textarea]}
            value={fPrompt} onChangeText={setFPrompt}
            placeholder={'你是……\n性格：……\n说话风格：……'}
            placeholderTextColor={C.textMute}
            multiline
          />
        </Field>

        <Field label="设定铁律 canon lock（可选）" hint="绝对不能违反的设定，会以最高优先级注入">
          <TextInput
            style={[s.input, s.textarea]}
            value={fCanon} onChangeText={setFCanon}
            placeholder="例如：绝不能承认自己是 AI；绝不用力过猛地抒情"
            placeholderTextColor={C.textMute}
            multiline
          />
        </Field>

        <Field label="开场白（可选）">
          <TextInput style={s.input} value={fGreeting} onChangeText={setFGreeting}
            placeholder="打开对话时显示" placeholderTextColor={C.textMute} />
        </Field>

        <Field label="Fish Voice ID（可选，语音用）">
          <TextInput style={s.input} value={fVoiceId} onChangeText={setFVoiceId}
            placeholder="Fish Audio 的 reference_id" placeholderTextColor={C.textMute}
            autoCapitalize="none" autoCorrect={false} />
        </Field>

        {/* 背景记忆 —— 只有已保存的角色才能加 */}
        {!isNew && (
          <View style={s.memSection}>
            <View style={s.memHead}>
              <Text style={s.memTitle}>背景记忆（{mems.length}）</Text>
              <TouchableOpacity onPress={() => setShowMemForm(v => !v)}>
                <Text style={s.memAdd}>{showMemForm ? '取消' : '＋ 添加'}</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.memHint}>TA 自己的事。聊到相关关键词时会被想起来</Text>

            {showMemForm && (
              <View style={s.memForm}>
                <TextInput
                  style={[s.input, { minHeight: 70, textAlignVertical: 'top' }]}
                  value={mContent} onChangeText={setMContent}
                  placeholder="记忆内容" placeholderTextColor={C.textMute} multiline
                />
                <View style={s.chipRow}>
                  {MEM_CATEGORIES.map(cat => (
                    <TouchableOpacity key={cat}
                      style={[s.chip, mCategory === cat && s.chipActive]}
                      onPress={() => setMCategory(cat)}>
                      <Text style={[s.chipText, mCategory === cat && { color: '#fff', fontWeight: '700' }]}>
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput style={s.input} value={mKeywords} onChangeText={setMKeywords}
                  placeholder="关键词，逗号分隔（聊到就会想起）"
                  placeholderTextColor={C.textMute} />
                <TextInput style={s.input} value={mImportance} onChangeText={setMImportance}
                  placeholder="重要度 0-1" placeholderTextColor={C.textMute}
                  keyboardType="decimal-pad" />
                <TouchableOpacity style={s.memSaveBtn} onPress={addMem}>
                  <Text style={s.memSaveText}>添加这条</Text>
                </TouchableOpacity>
              </View>
            )}

            {mems.map(m => (
              <TouchableOpacity key={m.id} style={s.memItem}
                onLongPress={() => delMem(m)} delayLongPress={400}>
                <View style={s.memItemHead}>
                  <Text style={s.memCat}>{m.category || '其他'}</Text>
                  <Text style={s.memImp}>★{(m.importance ?? 0.5).toFixed(1)}</Text>
                </View>
                <Text style={s.memContent}>{m.content}</Text>
                {m.keywords ? <Text style={s.memKw}>🔑 {m.keywords}</Text> : null}
              </TouchableOpacity>
            ))}
            {mems.length > 0 && <Text style={s.memHint}>长按可删除</Text>}
          </View>
        )}

        <TouchableOpacity
          style={[s.bigSave, saving && { opacity: 0.5 }]}
          onPress={save} disabled={saving}
        >
          <Text style={s.bigSaveText}>{saving ? '保存中…' : '保存角色'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      {hint ? <Text style={s.fieldHint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingBottom: 12,
    backgroundColor: C.card, borderBottomColor: C.border, borderBottomWidth: 1,
  },
  backBtn: { width: 34 },
  backText: { color: C.accent2, fontSize: 30, lineHeight: 32 },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  saveTopBtn: {
    paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: C.accent, borderRadius: 16,
  },
  saveTopText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  avatarSection: { alignItems: 'center', marginBottom: 24 },
  avatarBox: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: C.card2, borderColor: C.border, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarPlaceholder: { color: C.textMute, fontSize: 36 },
  avatarHint: { color: C.textDim, fontSize: 12, marginTop: 8 },
  fieldLabel: { color: C.text, fontSize: 14, fontWeight: '600', marginBottom: 4 },
  fieldHint: { color: C.textMute, fontSize: 11, marginBottom: 6, lineHeight: 16 },
  input: {
    color: C.text, backgroundColor: C.card2,
    borderColor: C.border, borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, marginBottom: 8,
  },
  inputDisabled: { opacity: 0.45 },
  textarea: { minHeight: 130, textAlignVertical: 'top' },
  memSection: {
    marginTop: 10, paddingTop: 18,
    borderTopColor: C.border, borderTopWidth: 1,
  },
  memHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  memTitle: { color: C.text, fontSize: 16, fontWeight: '700', flex: 1 },
  memAdd: { color: C.accent2, fontSize: 13, fontWeight: '600' },
  memHint: { color: C.textMute, fontSize: 11, marginBottom: 12 },
  memForm: {
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
    borderRadius: 12, padding: 14, marginBottom: 14,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
    borderColor: C.border, borderWidth: 1, marginRight: 6, marginBottom: 6,
  },
  chipActive: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { color: C.textDim, fontSize: 12 },
  memSaveBtn: {
    backgroundColor: C.accent, borderRadius: 18,
    paddingVertical: 11, alignItems: 'center', marginTop: 4,
  },
  memSaveText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  memItem: {
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
    borderRadius: 10, padding: 12, marginBottom: 8,
  },
  memItemHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  memCat: { color: C.accent2, fontSize: 11, fontWeight: '700', flex: 1 },
  memImp: { color: C.textMute, fontSize: 11 },
  memContent: { color: C.text, fontSize: 13, lineHeight: 19 },
  memKw: { color: C.textMute, fontSize: 11, marginTop: 5 },
  bigSave: {
    backgroundColor: C.accent, borderRadius: 24,
    paddingVertical: 15, alignItems: 'center', marginTop: 24,
  },
  bigSaveText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});