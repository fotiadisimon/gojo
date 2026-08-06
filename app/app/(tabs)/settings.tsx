// 设置页 —— 所有后端配置都在这里填：
//   API Keys、Provider 切换、模型选择、TTS 配置
//   改完点"保存到后端"，写入 DB settings 表，立刻生效不用重启
import axios from 'axios';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, DEFAULT_SERVER_URL } from '../../constants/theme';
import { useServerConfig } from '../../hooks/useServerConfig';

// 要在页面上显示的配置项（按分组排列）
const GROUPS = [
  {
    title: 'LLM 提供商',
    fields: [
      { key: 'LLM_PROVIDER', label: 'Provider', hint: 'claude 或 deepseek' },
      { key: 'ANTHROPIC_API_KEY', label: 'Claude API Key', secret: true, hint: 'sk-ant-...' },
      { key: 'CLAUDE_MODEL', label: 'Claude 模型', hint: '如 claude-sonnet-4-5-20250929' },
      { key: 'DEEPSEEK_API_KEY', label: 'DeepSeek API Key', secret: true, hint: '' },
      { key: 'DEEPSEEK_MODEL', label: 'DeepSeek 模型', hint: '如 deepseek-chat' },
      { key: 'DEEPSEEK_BASE_URL', label: 'DeepSeek Base URL', hint: '' },
    ],
  },
  {
    title: 'Fish Audio TTS（语音）',
    fields: [
      { key: 'FISH_KEY', label: 'Fish Audio Key', secret: true, hint: '' },
      { key: 'FISH_VOICE_ID', label: '默认 Voice ID', hint: 'Fish 的 reference_id' },
    ],
  },
  {
    title: '默认角色（初始种子）',
    fields: [
      { key: 'CHARACTER_NAME', label: '角色名', hint: '' },
      { key: 'CHARACTER_GREETING', label: '开场白', hint: '' },
      { key: 'CHARACTER_PROMPT', label: '人设 Prompt', multiline: true, hint: '可以写很长' },
    ],
  },
];

export default function SettingsScreen() {
  const { serverUrl, userId, setServerUrl } = useServerConfig();
  const insets = useSafeAreaInsets();
  const [urlInput, setUrlInput] = useState(serverUrl);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [localEdits, setLocalEdits] = useState<Record<string, string>>({});
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');

  useEffect(() => { setUrlInput(serverUrl); }, [serverUrl]);

  const loadSettings = async (url?: string) => {
    const base = url || serverUrl;
    setLoadingSettings(true);
    try {
      const r = await axios.get(`${base}/settings`, { timeout: 8000 });
      setSettings(r.data || {});
      setLocalEdits({});
    } catch (e: any) {
      console.warn('load settings', e?.message);
      setSettings({});
    } finally { setLoadingSettings(false); }
  };

  useEffect(() => {
    loadSettings();
  }, [serverUrl]);

  const testConnection = async () => {
    setTesting(true); setTestResult('');
    const url = urlInput.trim().replace(/\/$/, '');
    try {
      const r = await axios.get(`${url}/health`, { timeout: 6000 });
      setTestResult(`✅ 连接正常 (${r.data?.provider || '?'})`);
    } catch (e: any) {
      setTestResult(`❌ ${e?.message || '连接失败'}`);
    } finally { setTesting(false); }
  };

  const saveUrl = async () => {
    const v = urlInput.trim();
    if (!v || !/^https?:\/\//.test(v)) {
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
      }},
    ]);
  };

  const getVal = (key: string) => {
    if (key in localEdits) return localEdits[key];
    return settings[key] || '';
  };

  const setVal = (key: string, v: string) => {
    setLocalEdits(prev => ({ ...prev, [key]: v }));
  };

  const hasChanges = Object.keys(localEdits).length > 0;

  const saveSettings = async () => {
    if (!hasChanges) { Alert.alert('提示', '没有修改'); return; }
    setSaving(true);
    try {
      const r = await axios.put(`${serverUrl}/settings`, localEdits, { timeout: 10000 });
      if (r.data?.ok) {
        Alert.alert('✅ 已保存', `更新了 ${r.data.updated?.length || 0} 项，立刻生效`);
        await loadSettings();
      } else {
        Alert.alert('失败', r.data?.error || '未知错误');
      }
    } catch (e: any) {
      Alert.alert('保存失败', e?.response?.data?.error || e?.message);
    } finally { setSaving(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 12 }]}>

        {/* 后端地址 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>后端地址</Text>
          <Text style={s.hint}>
            真机填电脑局域网 IP，如 http://192.168.1.100:8080
          </Text>
          <TextInput
            style={s.input} value={urlInput} onChangeText={setUrlInput}
            placeholder="http://your-server:8080" placeholderTextColor={C.textMute}
            autoCapitalize="none" autoCorrect={false}
          />
          <View style={s.btnRow}>
            <TouchableOpacity style={s.testBtn} onPress={testConnection}>
              <Text style={s.testText}>{testing ? '测试中…' : '测试连接'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.saveUrlBtn} onPress={saveUrl}>
              <Text style={s.saveUrlText}>保存地址</Text>
            </TouchableOpacity>
          </View>
          {testResult ? <Text style={s.testResult}>{testResult}</Text> : null}
          <TouchableOpacity onPress={resetUrl}>
            <Text style={s.resetText}>恢复默认 ({DEFAULT_SERVER_URL})</Text>
          </TouchableOpacity>
        </View>

        {/* 后端配置项 */}
        {loadingSettings ? (
          <View style={s.section}>
            <ActivityIndicator color={C.accent} />
            <Text style={[s.hint, { textAlign: 'center', marginTop: 10 }]}>
              加载后端配置中…（连不上就只能改地址）
            </Text>
          </View>
        ) : (
          <>
            {GROUPS.map(g => (
              <View key={g.title} style={s.section}>
                <Text style={s.sectionTitle}>{g.title}</Text>
                {g.fields.map(f => (
                  <View key={f.key} style={s.fieldWrap}>
                    <Text style={s.fieldLabel}>{f.label}</Text>
                    {f.hint ? <Text style={s.fieldHint}>{f.hint}</Text> : null}
                    <TextInput
                      style={[s.input, f.multiline && { minHeight: 100, textAlignVertical: 'top' }]}
                      value={getVal(f.key)}
                      onChangeText={v => setVal(f.key, v)}
                      placeholder={f.hint || f.label}
                      placeholderTextColor={C.textMute}
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry={false}
                      multiline={f.multiline}
                    />
                    {f.secret && settings[f.key] && !(f.key in localEdits) && (
                      <Text style={s.secretHint}>显示的是打码后的值，填新值覆盖即可</Text>
                    )}
                  </View>
                ))}
              </View>
            ))}

            <TouchableOpacity
              style={[s.bigSaveBtn, !hasChanges && { opacity: 0.4 }]}
              onPress={saveSettings} disabled={!hasChanges || saving}
            >
              <Text style={s.bigSaveText}>
                {saving ? '保存中…' : hasChanges ? `保存到后端（${Object.keys(localEdits).length} 项）` : '没有修改'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {/* 身份 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>身份</Text>
          <Text style={s.hint}>本机 ID（用于区分不同用户的数据）</Text>
          <View style={s.uidBox}>
            <Text style={s.uidText} selectable>{userId || '(生成中…)'}</Text>
          </View>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  section: {
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
    borderRadius: 12, padding: 16, marginBottom: 16,
  },
  sectionTitle: { color: C.text, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  hint: { color: C.textDim, fontSize: 12, marginBottom: 8, lineHeight: 18 },
  input: {
    color: C.text, backgroundColor: C.card2,
    borderColor: C.border, borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 4,
  },
  btnRow: { flexDirection: 'row', marginTop: 8 },
  testBtn: {
    flex: 1, borderColor: C.accent, borderWidth: 1, borderRadius: 8,
    paddingVertical: 10, alignItems: 'center', marginRight: 8,
  },
  testText: { color: C.accent2, fontSize: 14, fontWeight: '600' },
  saveUrlBtn: {
    flex: 1, backgroundColor: C.accent, borderRadius: 8,
    paddingVertical: 10, alignItems: 'center',
  },
  saveUrlText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  testResult: { color: C.textDim, fontSize: 12, marginTop: 8 },
  resetText: {
    color: C.textMute, fontSize: 12, textAlign: 'center', marginTop: 12,
    textDecorationLine: 'underline',
  },
  fieldWrap: { marginBottom: 14 },
  fieldLabel: { color: C.text, fontSize: 13, fontWeight: '600', marginBottom: 4 },
  fieldHint: { color: C.textMute, fontSize: 11, marginBottom: 4 },
  secretHint: { color: C.textMute, fontSize: 10, fontStyle: 'italic', marginTop: 2 },
  bigSaveBtn: {
    backgroundColor: C.accent, borderRadius: 24,
    paddingVertical: 16, alignItems: 'center', marginBottom: 16,
  },
  bigSaveText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  uidBox: {
    backgroundColor: C.card2, borderColor: C.border, borderWidth: 1,
    borderRadius: 8, padding: 12,
  },
  uidText: {
    color: C.accent2, fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  backBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  backText: { color: C.textDim, fontSize: 14 },
});
