// 设置 tab —— 后端地址 + 所有 API 配置
// ★ v5 最终版：
//   - 砍掉快速切换 PRESETS（DeepSeek/Gemini/Claude 一键按钮）
//   - Provider 只保留 claude / deepseek 二选一
//   - hint 改成功能描述不写具体模型名
//   - 身份 ID 改成 TextInput 可编辑（换手机找回数据）
//   - 不用 Alert.prompt（Android 不支持）
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SERVER_URL, FIXED_USER_ID, DEFAULT_SERVER_URL, setServerUrl } from '../../constants/theme';

// 所有可改字段（和后端 route_settings.py 的 ALLOWED 对齐）
const FIELDS = [
  { key: 'ANTHROPIC_KEY',     label: 'Claude API Key',        secret: true, hint: '直连 Claude 官方或中转 Anthropic 端点用' },
  { key: 'MODEL_MAIN',        label: '主聊天模型',              hint: '聊天正文用，推荐用最好的模型' },
  { key: 'MODEL_JP_AUX',      label: '日语辅助模型',            hint: '日语小任务用，便宜快的即可' },
  { key: 'DEEPSEEK_KEY',      label: '中转 / DeepSeek Key',    secret: true, hint: '走中转或 DeepSeek 官方的 key' },
  { key: 'DEEPSEEK_MODEL',    label: '中转模型名',              hint: '中转支持的模型名（如 claude-opus-4-6 / deepseek-chat）' },
  { key: 'DEEPSEEK_BASE_URL', label: '中转 Base URL',          hint: '中转地址（如 https://tdyun.ai/v1）' },
  { key: 'MODEL_CN_AUX',      label: '后台任务模型',            hint: '记忆提取/日记生成用，推荐 claude-haiku-4-5-20251001' },
  { key: 'FISH_KEY',          label: 'Fish Audio Key',        secret: true, hint: '语音 TTS 用，不用就不填' },
  { key: 'FISH_VOICE_ID',     label: '默认 Voice ID',          hint: '角色没单独配音色时用这个' },
] as const;

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();

  const [urlInput, setUrlInput] = useState(SERVER_URL);
  const [uidInput, setUidInput] = useState(FIXED_USER_ID);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');

  const [remote, setRemote] = useState<Record<string, string>>({});
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSettings = async (base?: string) => {
    const url = (base || SERVER_URL).replace(/\/+$/, '');
    if (!url) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await axios.get(`${url}/settings`, { timeout: 10000 });
      const data = r.data || {};
      setRemote(data);
      setForm({ ...data });
    } catch (e: any) {
      console.warn('[settings] load failed', e?.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadSettings(); }, []);

  const testConnection = async () => {
    setTesting(true); setTestResult('');
    const url = urlInput.trim().replace(/\/+$/, '');
    if (!url) { setTestResult('❌ 请先填写后端地址'); setTesting(false); return; }
    try {
      const r = await axios.get(`${url}/health`, { timeout: 8000 });
      setTestResult(`✅ 连接正常（provider: ${r.data?.provider || '?'}）`);
    } catch (e: any) {
      setTestResult(`❌ ${e?.message || '连接失败'}`);
    } finally { setTesting(false); }
  };

  const saveUrl = async () => {
    const v = urlInput.trim();
    if (!v) { Alert.alert('提示', '请填写后端地址'); return; }
    if (!/^https?:\/\//.test(v)) {
      Alert.alert('提示', '地址必须以 https:// 开头');
      return;
    }
    await setServerUrl(v);
    await loadSettings(v);
    Alert.alert('已保存', '后端地址已更新');
  };

  const resetUrl = () => {
    if (!DEFAULT_SERVER_URL) {
      Alert.alert('提示', '没有默认地址，请手动填写');
      return;
    }
    Alert.alert('恢复默认', `恢复为 ${DEFAULT_SERVER_URL}？`, [
      { text: '取消', style: 'cancel' },
      { text: '确定', onPress: async () => {
        await setServerUrl(DEFAULT_SERVER_URL);
        setUrlInput(DEFAULT_SERVER_URL);
        await loadSettings(DEFAULT_SERVER_URL);
      }},
    ]);
  };

  const setVal = (key: string, v: string) => {
    setForm(prev => ({ ...prev, [key]: v }));
  };

  const onSecretFocus = (key: string) => {
    if ((form[key] || '').includes('****')) {
      setForm(prev => ({ ...prev, [key]: '' }));
    }
  };

  const save = async () => {
    const payload: Record<string, string> = {};
    for (const key of Object.keys(form)) {
      const v = (form[key] ?? '').trim();
      if (!v) continue;
      if (v.includes('****')) continue;
      if (v === (remote[key] ?? '')) continue;
      payload[key] = v;
    }
    if (Object.keys(payload).length === 0) {
      Alert.alert('提示', '没有需要保存的改动');
      return;
    }
    setSaving(true);
    try {
      const url = SERVER_URL.replace(/\/+$/, '');
      if (!url) { Alert.alert('错误', '请先在最上方填写并保存后端地址'); setSaving(false); return; }
      const r = await axios.put(`${url}/settings`, payload, { timeout: 15000 });
      const updated = r.data?.updated || [];
      Alert.alert('✅ 已保存', `更新了 ${updated.length} 项，立刻生效\n\n${updated.join('、')}`);
      await loadSettings();
    } catch (e: any) {
      Alert.alert('保存失败', e?.response?.data?.error || e?.message);
    } finally { setSaving(false); }
  };

  const provider = (form.LLM_PROVIDER || 'claude').toLowerCase();

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── 后端地址 ── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>后端地址</Text>
          <TextInput
            style={s.input}
            value={urlInput} onChangeText={setUrlInput}
            placeholder="https://your-app.zeabur.app"
            placeholderTextColor={C.textMute}
            autoCapitalize="none" autoCorrect={false}
          />
          <View style={s.row}>
            <TouchableOpacity style={s.ghostBtn} onPress={testConnection} disabled={testing}>
              <Text style={s.ghostBtnText}>{testing ? '测试中…' : '测试连接'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.primaryBtn} onPress={saveUrl}>
              <Text style={s.primaryBtnText}>保存地址</Text>
            </TouchableOpacity>
          </View>
          {testResult ? <Text style={s.testResult}>{testResult}</Text> : null}
          <TouchableOpacity onPress={resetUrl}>
            <Text style={s.resetText}>恢复默认</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={s.card}>
            <ActivityIndicator color={C.accent} />
            <Text style={[s.hint, { textAlign: 'center', marginTop: 10 }]}>
              加载后端配置中…{'\n'}连不上就先检查上面的地址（必须 https:// 开头）
            </Text>
          </View>
        ) : (
          <>
            {/* ── Provider ── */}
            <View style={s.card}>
              <Text style={s.cardTitle}>当前 Provider</Text>
              <View style={s.providerRow}>
                {['claude', 'deepseek'].map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[s.providerBtn, provider === p && s.providerBtnActive]}
                    onPress={() => setVal('LLM_PROVIDER', p)}
                  >
                    <Text style={[s.providerBtnText, provider === p && { color: '#fff', fontWeight: '700' }]}>
                      {p === 'claude' ? 'Claude 直连' : '中转 / DeepSeek'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={s.hint}>
                Claude 官方 → 选 Claude 直连{'\n'}
                中转(tdyun/oneapi 等) / DeepSeek / Gemini → 选 中转
              </Text>
            </View>

            {/* ── API 配置 ── */}
            <View style={s.card}>
              <Text style={s.cardTitle}>API 配置</Text>
              {FIELDS.map(f => {
                const isSecret = (f as any).secret;
                const val = form[f.key] ?? '';
                const masked = isSecret && val.includes('****');
                return (
                  <View key={f.key} style={{ marginBottom: 14 }}>
                    <Text style={s.fieldLabel}>{f.label}</Text>
                    {f.hint ? <Text style={s.fieldHint}>{f.hint}</Text> : null}
                    <TextInput
                      style={[s.input, masked && s.inputMasked]}
                      value={val}
                      onChangeText={v => setVal(f.key, v)}
                      onFocus={() => isSecret && onSecretFocus(f.key)}
                      placeholder={f.hint || f.label}
                      placeholderTextColor={C.textMute}
                      autoCapitalize="none" autoCorrect={false} spellCheck={false}
                    />
                    {masked ? <Text style={s.maskedHint}>已配置 · 点输入框可填新值覆盖</Text> : null}
                  </View>
                );
              })}
            </View>

            <TouchableOpacity
              style={[s.bigSave, saving && { opacity: 0.5 }]}
              onPress={save} disabled={saving}
            >
              <Text style={s.bigSaveText}>{saving ? '保存中…' : '保存到后端'}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── 身份 ── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>身份</Text>
          <Text style={s.hint}>
            你的聊天记录、记忆都绑在这个 ID 上{'\n'}
            换手机后填回老 ID → 点保存 → 重启 App 就能找回所有数据
          </Text>
          <TextInput
            style={s.input}
            value={uidInput}
            onChangeText={setUidInput}
            placeholder="user_xxxxxxxxxx"
            placeholderTextColor={C.textMute}
            autoCapitalize="none" autoCorrect={false}
          />
          {uidInput !== FIXED_USER_ID && uidInput.trim().length >= 5 ? (
            <TouchableOpacity
              style={[s.ghostBtn, { marginTop: 10, marginRight: 0 }]}
              onPress={async () => {
                const id = uidInput.trim();
                await AsyncStorage.setItem('user_id', id);
                await AsyncStorage.setItem('gojo_user_id', id);
                Alert.alert('已保存', `ID 已切换为 ${id}\n关掉 App 重新打开即生效`);
              }}
            >
              <Text style={s.ghostBtnText}>保存新 ID（重启生效）</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
    borderRadius: 14, padding: 16, marginBottom: 16,
  },
  cardTitle: { color: C.text, fontSize: 17, fontWeight: '700', marginBottom: 10 },
  hint: { color: C.textDim, fontSize: 12, lineHeight: 18, marginBottom: 8 },
  fieldLabel: { color: C.text, fontSize: 14, fontWeight: '600', marginBottom: 4 },
  fieldHint: { color: C.textMute, fontSize: 11, marginBottom: 5 },
  input: {
    color: C.text, backgroundColor: C.card2,
    borderColor: C.border, borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 14,
  },
  inputMasked: { color: C.textDim },
  maskedHint: { color: C.textMute, fontSize: 10, marginTop: 4, fontStyle: 'italic' },
  row: { flexDirection: 'row', marginTop: 10 },
  ghostBtn: {
    flex: 1, borderColor: C.accent, borderWidth: 1, borderRadius: 10,
    paddingVertical: 11, alignItems: 'center' as const, marginRight: 8,
  },
  ghostBtnText: { color: C.accent2, fontSize: 14, fontWeight: '600' },
  primaryBtn: {
    flex: 1, backgroundColor: C.accent, borderRadius: 10,
    paddingVertical: 11, alignItems: 'center' as const,
  },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  testResult: { color: C.textDim, fontSize: 12, marginTop: 10 },
  resetText: {
    color: C.textMute, fontSize: 12, textAlign: 'center' as const, marginTop: 12,
    textDecorationLine: 'underline' as const,
  },
  providerRow: { flexDirection: 'row' as const, marginTop: 6, marginBottom: 8 },
  providerBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' as const,
    borderColor: C.border, borderWidth: 1, marginRight: 8, backgroundColor: C.card2,
  },
  providerBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
  providerBtnText: { color: C.textDim, fontSize: 14 },
  bigSave: {
    backgroundColor: C.accent, borderRadius: 26,
    paddingVertical: 16, alignItems: 'center' as const, marginBottom: 16,
  },
  bigSaveText: { color: '#fff', fontSize: 17, fontWeight: '800' },
});