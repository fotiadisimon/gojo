// 设置 tab —— 后端地址 + 所有 API 配置
// ★ v3 修复：
//   1. 保存时提交"所有非空且与服务端不同"的字段，不再依赖 localEdits 状态
//   2. 密钥字段：点击输入框自动清空打码值，避免把 **** 存进库
//   3. Provider 改成按钮选择，不用手打（打错就走不到任何分支）
//   4. 支持 Gemini —— 借用 DeepSeek 通道，一键填好 base_url
import axios from 'axios';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SERVER_URL, FIXED_USER_ID, DEFAULT_SERVER_URL, setServerUrl } from '../../constants/theme';

// 所有可改字段（要和后端 route_settings.py 的 ALLOWED 对齐）
const FIELDS = [
  { key: 'ANTHROPIC_KEY',     label: 'Claude API Key',    secret: true,  hint: 'sk-ant-...' },
  { key: 'MODEL_MAIN',        label: 'Claude 主模型',      hint: 'claude-sonnet-4-5-20250929' },
  { key: 'MODEL_JP_AUX',      label: 'Claude 辅助模型',    hint: 'claude-haiku-4-5-20251001' },
  { key: 'DEEPSEEK_KEY',      label: 'DeepSeek / Gemini Key', secret: true, hint: '两者共用这一栏' },
  { key: 'DEEPSEEK_MODEL',    label: '模型名',             hint: 'deepseek-chat 或 gemini-3.6-flash' },
  { key: 'DEEPSEEK_BASE_URL', label: 'Base URL',          hint: 'https://api.deepseek.com' },
  { key: 'MODEL_CN_AUX',      label: '后台任务模型',       hint: '记忆提取/日记生成用，填同上' },
  { key: 'FISH_KEY',          label: 'Fish Audio Key',    secret: true,  hint: 'sk-fish-...' },
  { key: 'FISH_VOICE_ID',     label: '默认 Voice ID',      hint: '角色没单独配音色时用这个' },
] as const;

const SECRET_KEYS = FIELDS.filter(f => (f as any).secret).map(f => f.key) as string[];

// 一键预设
const PRESETS = [
  {
    name: 'DeepSeek',
    values: {
      LLM_PROVIDER: 'deepseek',
      DEEPSEEK_MODEL: 'deepseek-chat',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
      MODEL_CN_AUX: 'deepseek-chat',
    },
  },
  {
    name: 'Gemini',
    values: {
      LLM_PROVIDER: 'deepseek',   // 借用 DeepSeek 通道（OpenAI 兼容）
      DEEPSEEK_MODEL: 'gemini-3.6-flash',
      DEEPSEEK_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      MODEL_CN_AUX: 'gemini-3.6-flash',
    },
  },
  {
    name: 'Claude',
    values: {
      LLM_PROVIDER: 'claude',
      MODEL_MAIN: 'claude-sonnet-4-5-20250929',
      MODEL_JP_AUX: 'claude-haiku-4-5-20251001',
      MODEL_CN_AUX: 'claude-haiku-4-5-20251001',
    },
  },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();

  const [urlInput, setUrlInput] = useState(SERVER_URL);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');

  // 服务端当前值（密钥是打码的）
  const [remote, setRemote] = useState<Record<string, string>>({});
  // 表单里的值
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSettings = async (base?: string) => {
    const url = (base || SERVER_URL).replace(/\/+$/, '');
    setLoading(true);
    try {
      const r = await axios.get(`${url}/settings`, { timeout: 10000 });
      const data = r.data || {};
      setRemote(data);
      setForm({ ...data });
    } catch (e: any) {
      console.warn('[settings] load failed', e?.message);
      setRemote({});
      setForm({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSettings(); }, []);

  const testConnection = async () => {
    setTesting(true); setTestResult('');
    const url = urlInput.trim().replace(/\/+$/, '');
    try {
      const r = await axios.get(`${url}/health`, { timeout: 8000 });
      setTestResult(`✅ 连接正常（provider: ${r.data?.provider || '?'}）`);
    } catch (e: any) {
      setTestResult(`❌ ${e?.message || '连接失败'}`);
    } finally { setTesting(false); }
  };

  const saveUrl = async () => {
    const v = urlInput.trim();
    if (!/^https?:\/\//.test(v)) {
      Alert.alert('提示', '地址必须以 http:// 或 https:// 开头');
      return;
    }
    await setServerUrl(v);
    await loadSettings(v);
    Alert.alert('已保存', '后端地址已更新');
  };

  const resetUrl = () => {
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

  // ★ 密钥框获得焦点时，如果当前是打码值就清空，方便直接粘贴新值
  const onSecretFocus = (key: string) => {
    if ((form[key] || '').includes('****')) {
      setForm(prev => ({ ...prev, [key]: '' }));
    }
  };

  const applyPreset = (values: Record<string, string>) => {
    setForm(prev => ({ ...prev, ...values }));
    Alert.alert('已填入', '记得填 API Key，然后点最下面的保存');
  };

  const save = async () => {
    // ★ 关键修复：提交所有"有值且和服务端不同"的字段
    //   不再依赖 localEdits，避免输入没被记录导致提交 0 项
    const payload: Record<string, string> = {};
    for (const key of Object.keys(form)) {
      const v = (form[key] ?? '').trim();
      if (!v) continue;                     // 空值跳过（不清空服务端配置）
      if (v.includes('****')) continue;     // 打码值跳过
      if (v === (remote[key] ?? '')) continue;  // 没变的跳过
      payload[key] = v;
    }

    if (Object.keys(payload).length === 0) {
      Alert.alert('提示', '没有需要保存的改动');
      return;
    }

    setSaving(true);
    try {
      const url = SERVER_URL.replace(/\/+$/, '');
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
              加载后端配置中…连不上就只能改上面的地址
            </Text>
          </View>
        ) : (
          <>
            {/* ── 一键预设 ── */}
            <View style={s.card}>
              <Text style={s.cardTitle}>快速切换</Text>
              <Text style={s.hint}>点一下自动填好模型和地址，然后补 API Key</Text>
              <View style={s.presetRow}>
                {PRESETS.map(p => (
                  <TouchableOpacity
                    key={p.name}
                    style={s.presetBtn}
                    onPress={() => applyPreset(p.values as any)}
                  >
                    <Text style={s.presetText}>{p.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[s.fieldLabel, { marginTop: 14 }]}>当前 Provider</Text>
              <View style={s.providerRow}>
                {['claude', 'deepseek'].map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[s.providerBtn, provider === p && s.providerBtnActive]}
                    onPress={() => setVal('LLM_PROVIDER', p)}
                  >
                    <Text style={[s.providerBtnText, provider === p && { color: '#fff', fontWeight: '700' }]}>
                      {p}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={s.hint}>
                用 Gemini 时也选 deepseek —— 它走的是同一套 OpenAI 兼容接口
              </Text>
            </View>

            {/* ── 各项配置 ── */}
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
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                    />
                    {masked ? (
                      <Text style={s.maskedHint}>已配置 · 点一下输入框可填新值覆盖</Text>
                    ) : null}
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
          <Text style={s.hint}>本机 ID（用于区分不同用户的数据）</Text>
          <View style={s.uidBox}>
            <Text style={s.uidText} selectable>{FIXED_USER_ID}</Text>
          </View>
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
    paddingVertical: 11, alignItems: 'center', marginRight: 8,
  },
  ghostBtnText: { color: C.accent2, fontSize: 14, fontWeight: '600' },
  primaryBtn: {
    flex: 1, backgroundColor: C.accent, borderRadius: 10,
    paddingVertical: 11, alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  testResult: { color: C.textDim, fontSize: 12, marginTop: 10 },
  resetText: {
    color: C.textMute, fontSize: 12, textAlign: 'center', marginTop: 12,
    textDecorationLine: 'underline',
  },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap' },
  presetBtn: {
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20,
    backgroundColor: C.card2, borderColor: C.border, borderWidth: 1,
    marginRight: 8, marginBottom: 8,
  },
  presetText: { color: C.accent2, fontSize: 13, fontWeight: '600' },
  providerRow: { flexDirection: 'row', marginTop: 6, marginBottom: 8 },
  providerBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
    borderColor: C.border, borderWidth: 1, marginRight: 8,
    backgroundColor: C.card2,
  },
  providerBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
  providerBtnText: { color: C.textDim, fontSize: 14 },
  bigSave: {
    backgroundColor: C.accent, borderRadius: 26,
    paddingVertical: 16, alignItems: 'center', marginBottom: 16,
  },
  bigSaveText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  uidBox: {
    backgroundColor: C.card2, borderColor: C.border, borderWidth: 1,
    borderRadius: 10, padding: 12,
  },
  uidText: {
    color: C.accent2, fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});