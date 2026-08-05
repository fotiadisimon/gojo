// 首页：四个功能瓦片 + 右上角设置入口 + 当前 provider 状态提示
import axios from 'axios';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StatusBar, StyleSheet,
  Text, TouchableOpacity, View
} from 'react-native';
import { C } from '../../constants/theme';
import { useServerConfig } from '../../hooks/useServerConfig';

interface ServerConfig {
  provider: string;
  character_name: string;
  character_greeting: string;
  has_claude_key: boolean;
  has_deepseek_key: boolean;
}

const TILES = [
  { route: '/chat',       icon: '💬', label: '聊天', sub: '和 AI 对话' },
  { route: '/diary',      icon: '📖', label: '日记', sub: '记录生活'   },
  { route: '/calendar',   icon: '📅', label: '日程', sub: '待办清单'   },
  { route: '/accounting', icon: '💰', label: '记账', sub: '收支管理'   },
] as const;

export default function HomeScreen() {
  const router = useRouter();
  const { serverUrl, loading: cfgLoading } = useServerConfig();
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (cfgLoading) return;
    setErr('');
    axios.get(`${serverUrl}/config`, { timeout: 5000 })
      .then(r => setConfig(r.data))
      .catch(e => setErr(`连不上后端 (${serverUrl})`));
  }, [serverUrl, cfgLoading]);

  const provider = config?.provider || '未知';
  const hasKey = provider === 'claude' ? config?.has_claude_key : config?.has_deepseek_key;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Gojo Simple</Text>
            <Text style={s.sub}>{config?.character_name ? `与 ${config.character_name} 相处的一天` : '一起过每一天'}</Text>
          </View>
          <TouchableOpacity style={s.settingBtn} onPress={() => router.push('/settings')}>
            <Text style={s.settingIcon}>⚙️</Text>
          </TouchableOpacity>
        </View>

        {/* Provider 状态卡 */}
        <View style={s.statusCard}>
          {cfgLoading || (!config && !err) ? (
            <ActivityIndicator color={C.accent} />
          ) : err ? (
            <>
              <Text style={s.statusBad}>⚠️ {err}</Text>
              <Text style={s.statusHint}>点右上角设置检查地址</Text>
            </>
          ) : (
            <>
              <Text style={s.statusRow}>
                <Text style={s.statusLabel}>Provider:</Text>{' '}
                <Text style={s.statusVal}>{provider}</Text>
              </Text>
              <Text style={s.statusRow}>
                <Text style={s.statusLabel}>API Key:</Text>{' '}
                <Text style={hasKey ? s.statusOk : s.statusBad}>
                  {hasKey ? '✓ 已配置' : '✗ 未设置'}
                </Text>
              </Text>
              {config?.character_greeting && (
                <Text style={s.greeting}>「{config.character_greeting}」</Text>
              )}
            </>
          )}
        </View>

        {/* 4 个瓦片 */}
        <View style={s.grid}>
          {TILES.map(t => (
            <TouchableOpacity key={t.route} style={s.tile}
              onPress={() => router.push(t.route as any)} activeOpacity={0.75}>
              <Text style={s.tileIcon}>{t.icon}</Text>
              <Text style={s.tileLabel}>{t.label}</Text>
              <Text style={s.tileSub}>{t.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 20, paddingTop: 60 },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 24 },
  title: { color: C.text, fontSize: 32, fontWeight: '800' },
  sub: { color: C.textDim, fontSize: 14, marginTop: 4 },
  settingBtn: { padding: 8 },
  settingIcon: { fontSize: 24 },
  statusCard: {
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
    borderRadius: 12, padding: 16, marginBottom: 24,
  },
  statusRow: { color: C.text, marginBottom: 6 },
  statusLabel: { color: C.textDim, fontSize: 13 },
  statusVal: { color: C.accent2, fontWeight: '700' },
  statusOk: { color: C.income, fontWeight: '700' },
  statusBad: { color: C.expense, fontWeight: '700' },
  statusHint: { color: C.textMute, fontSize: 12, marginTop: 6 },
  greeting: { color: C.textDim, marginTop: 8, fontStyle: 'italic', fontSize: 13 },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
  },
  tile: {
    width: '48%', backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
    borderRadius: 16, padding: 20, marginBottom: 14, alignItems: 'center',
  },
  tileIcon: { fontSize: 36, marginBottom: 8 },
  tileLabel: { color: C.text, fontSize: 18, fontWeight: '700' },
  tileSub: { color: C.textDim, fontSize: 12, marginTop: 4 },
});
