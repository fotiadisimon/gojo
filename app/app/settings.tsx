// 设置页 —— 这是把 App 打包给别人也能用的关键：
//   1. 让用户填自己的后端 SERVER_URL
//   2. 显示当前 provider / API key 状态
//   3. 显示 USER_ID（长按可复制看看）
import axios from 'axios';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import { C, DEFAULT_SERVER_URL } from '../constants/theme';
import { useServerConfig } from '../hooks/useServerConfig';

interface Cfg {
  provider: string;
  claude_model: string;
  deepseek_model: string;
  character_name: string;
  character_greeting: string;
  has_claude_key: boolean;
  has_deepseek_key: boolean;
  emotions: string[];
}

export default function SettingsScreen() {
  const router = useRouter();
  const { serverUrl, userId, setServerUrl } = useServerConfig();
  const [input, setInput] = useState(serverUrl);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');

  useEffect(() => { setInput(serverUrl); }, [serverUrl]);

  useEffect(() => {
    axios.get(`${serverUrl}/config`, { timeout: 5000 })
      .then(r => setCfg(r.data))
      .catch(() => setCfg(null));
  }, [serverUrl]);

  const testConnection = async (url: string) => {
    setTesting(true);
    setTestResult('');
    try {
      const r = await axios.get(`${url.replace(/\/$/, '')}/health`, { timeout: 6000 });
      setTestResult(`✅ 连接正常（provider: ${r.data.provider}）`);
      return true;
    } catch (e: any) {
      setTestResult(`❌ ${e?.message || '连接失败'}`);
      return false;
    } finally {
      setTesting(false);
    }
  };

  const saveUrl = async () => {
    const v = input.trim();
    if (!v) { Alert.alert('提示', '地址不能为空'); return; }
    if (!/^https?:\/\//.test(v)) {
      Alert.alert('提示', '地址必须以 http:// 或 https:// 开头');
      return;
    }
    await setServerUrl(v);
    // 刷新一下 config
    try {
      const r = await axios.get(`${v.replace(/\/$/, '')}/config`, { timeout: 5000 });
      setCfg(r.data);
    } catch {}
    Alert.alert('已保存', '后端地址已更新');
  };

  const resetDefault = () => {
    Alert.alert('恢复默认', `恢复为 ${DEFAULT_SERVER_URL}？`, [
      { text: '取消', style: 'cancel' },
      { text: '确定', onPress: async () => {
        await setServerUrl(DEFAULT_SERVER_URL);
        setInput(DEFAULT_SERVER_URL);
      }},
    ]);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.content}>

        {/* 后端地址配置 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>后端地址</Text>
          <Text style={s.hint}>
            如果在真机上跑，这里要填运行后端那台电脑的 IP，比如 http://192.168.1.100:8080
          </Text>
          <TextInput
            style={s.input}
            value={input}
            onChangeText={setInput}
            placeholder="http://your-server:8080"
            placeholderTextColor={C.textMute}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={s.btnRow}>
            <TouchableOpacity style={s.testBtn} onPress={() => testConnection(input)}>
              <Text style={s.testText}>{testing ? '测试中…' : '测试连接'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.saveBtn} onPress={saveUrl}>
              <Text style={s.saveText}>保存</Text>
            </TouchableOpacity>
          </View>
          {testResult ? <Text style={s.testResult}>{testResult}</Text> : null}
          <TouchableOpacity onPress={resetDefault}>
            <Text style={s.resetText}>恢复默认 ({DEFAULT_SERVER_URL})</Text>
          </TouchableOpacity>
        </View>

        {/* 当前后端状态 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>当前后端</Text>
          {!cfg ? (
            <View style={{ paddingVertical: 12 }}>
              <ActivityIndicator color={C.accent} />
              <Text style={[s.hint, { textAlign: 'center', marginTop: 8 }]}>
                连不上，请检查地址
              </Text>
            </View>
          ) : (
            <View>
              <InfoRow label="角色" value={cfg.character_name} />
              <InfoRow label="Provider" value={cfg.provider} />
              <InfoRow label="Claude Model" value={cfg.claude_model} />
              <InfoRow label="DeepSeek Model" value={cfg.deepseek_model} />
              <InfoRow label="Claude Key"
                value={cfg.has_claude_key ? '✓ 已配置' : '✗ 未设置'}
                valueColor={cfg.has_claude_key ? C.income : C.expense}
              />
              <InfoRow label="DeepSeek Key"
                value={cfg.has_deepseek_key ? '✓ 已配置' : '✗ 未设置'}
                valueColor={cfg.has_deepseek_key ? C.income : C.expense}
              />
              <InfoRow label="情绪种类" value={`${cfg.emotions.length} 种`} />
            </View>
          )}
        </View>

        {/* 用户 ID */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>身份</Text>
          <Text style={s.hint}>本机 ID（用于区分不同用户的数据）</Text>
          <View style={s.uidBox}>
            <Text style={s.uidText} selectable>{userId || '(生成中…)'}</Text>
          </View>
        </View>

        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>返回</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function InfoRow({ label, value, valueColor }: {
  label: string; value: string; valueColor?: string
}) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={[s.infoVal, valueColor && { color: valueColor }]}>{value || '-'}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  section: {
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
    borderRadius: 12, padding: 16, marginBottom: 16,
  },
  sectionTitle: { color: C.text, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  hint: { color: C.textDim, fontSize: 12, marginBottom: 10, lineHeight: 18 },
  input: {
    color: C.text, backgroundColor: C.card2,
    borderColor: C.border, borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 10,
  },
  btnRow: { flexDirection: 'row' },
  testBtn: {
    flex: 1, borderColor: C.accent, borderWidth: 1, borderRadius: 8,
    paddingVertical: 10, alignItems: 'center', marginRight: 8,
  },
  testText: { color: C.accent2, fontSize: 14, fontWeight: '600' },
  saveBtn: {
    flex: 1, backgroundColor: C.accent, borderRadius: 8,
    paddingVertical: 10, alignItems: 'center',
  },
  saveText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  testResult: { color: C.textDim, fontSize: 12, marginTop: 10 },
  resetText: {
    color: C.textMute, fontSize: 12, textAlign: 'center', marginTop: 12,
    textDecorationLine: 'underline',
  },
  infoRow: {
    flexDirection: 'row', paddingVertical: 6,
    borderBottomColor: C.border, borderBottomWidth: 1,
  },
  infoLabel: { color: C.textDim, fontSize: 13, width: 120 },
  infoVal: { color: C.text, fontSize: 13, flex: 1, fontWeight: '600' },
  uidBox: {
    backgroundColor: C.card2, borderColor: C.border, borderWidth: 1,
    borderRadius: 8, padding: 12,
  },
  uidText: { color: C.accent2, fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  backBtn: {
    paddingVertical: 14, alignItems: 'center', marginTop: 10,
  },
  backText: { color: C.textDim, fontSize: 14 },
});
