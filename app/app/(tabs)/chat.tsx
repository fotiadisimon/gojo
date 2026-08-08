// 聊天 tab —— 角色列表
// 点角色 → 进单聊；点 ➕ → 新建角色；长按 → 编辑/删除
import axios from 'axios';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, ScrollView, StatusBar,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SERVER_URL, FIXED_USER_ID } from '../../constants/theme';

interface Character {
  id: string;
  name: string;
  name_en?: string;
  avatar_url?: string;
  voice_id?: string;
  greeting?: string;
}

const ACCENTS = ['#5BC4FF', '#A78BFA', '#F59E0B', '#E8A0BF', '#34D399', '#60a5fa'];

export default function ChatListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [chars, setChars] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = async () => {
    setErr('');
    try {
      const res = await axios.get(`${SERVER_URL}/characters`, { timeout: 10000 });
      setChars(res.data?.characters || []);
    } catch (e: any) {
      console.warn('[chat] load characters', e?.message);
      setErr(`连不上后端（${SERVER_URL}）`);
    }
  };

  useFocusEffect(useCallback(() => {
    (async () => { setLoading(true); await load(); setLoading(false); })();
  }, []));

  const del = (c: Character) => {
    Alert.alert('删除角色', `删除「${c.name}」？聊天记录和记忆都会保留，但进不去了。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        try {
          await axios.delete(`${SERVER_URL}/character/${c.id}`);
          await load();
        } catch (e: any) { Alert.alert('删除失败', e?.message); }
      }},
    ]);
  };

  const longPress = (c: Character) => {
    Alert.alert(c.name, undefined, [
      { text: '✏️ 编辑角色', onPress: () => router.push(`/character/${c.id}` as any) },
      { text: '🗑 删除', style: 'destructive', onPress: () => del(c) },
      { text: '取消', style: 'cancel' },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>消息</Text>
          <Text style={s.sub}>{chars.length} 个角色 · 长按可编辑</Text>
        </View>
        <TouchableOpacity
          style={s.addBtn}
          onPress={() => router.push('/character/new' as any)}
          activeOpacity={0.8}
        >
          <Text style={s.addBtnText}>➕ 新角色</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={C.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
          {err ? (
            <View style={s.errBox}>
              <Text style={s.errText}>⚠️ {err}</Text>
              <Text style={s.errHint}>去「⚙️ 设置」检查后端地址</Text>
            </View>
          ) : null}

          {!err && chars.length === 0 && (
            <View style={s.empty}>
              <Text style={s.emptyEmoji}>🕳️</Text>
              <Text style={s.emptyText}>还没有角色{'\n'}点右上角 ➕ 建一个吧</Text>
            </View>
          )}

          {chars.map((c, i) => {
            const accent = ACCENTS[i % ACCENTS.length];
            return (
              <TouchableOpacity
                key={c.id}
                style={s.row}
                activeOpacity={0.8}
                onPress={() => router.push(`/chat/${c.id}` as any)}
                onLongPress={() => longPress(c)}
                delayLongPress={400}
              >
                <View style={[s.avatar, { borderColor: accent, backgroundColor: accent + '22' }]}>
                  {c.avatar_url ? (
                    <Image source={{ uri: c.avatar_url }} style={s.avatarImg} />
                  ) : (
                    <Text style={[s.avatarText, { color: accent }]}>
                      {(c.name || '?').slice(0, 1)}
                    </Text>
                  )}
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.rowTitle} numberOfLines={1}>{c.name}</Text>
                  <Text style={s.rowSub} numberOfLines={1}>
                    {c.greeting || `@${c.id}`}
                  </Text>
                </View>
                <Text style={s.arrow}>›</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 20, paddingBottom: 12,
    borderBottomColor: C.border, borderBottomWidth: 1,
  },
  title: { color: C.text, fontSize: 28, fontWeight: '800' },
  sub: { color: C.textDim, fontSize: 12, marginTop: 4 },
  addBtn: {
    paddingHorizontal: 14, paddingVertical: 9,
    backgroundColor: C.accent, borderRadius: 20, marginTop: 4,
  },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errBox: {
    backgroundColor: C.expense + '22', borderColor: C.expense, borderWidth: 1,
    borderRadius: 12, padding: 14, marginBottom: 16,
  },
  errText: { color: C.expense, fontSize: 13, fontWeight: '600' },
  errHint: { color: C.textDim, fontSize: 11, marginTop: 6 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: C.textDim, fontSize: 14, textAlign: 'center', lineHeight: 22 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
    borderRadius: 16, padding: 14, marginBottom: 12,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { fontSize: 20, fontWeight: '800' },
  rowTitle: { color: C.text, fontSize: 16, fontWeight: '600' },
  rowSub: { color: C.textMute, fontSize: 12, marginTop: 3 },
  arrow: { color: C.textMute, fontSize: 22, marginLeft: 8 },
});