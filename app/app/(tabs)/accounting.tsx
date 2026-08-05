// 记账页 —— 从原版的 AsyncStorage 本地存改成走后端
// 保留：结余卡、收入/支出统计、分类占比、新建/删除
import axios from 'axios';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput,
  TouchableOpacity, View
} from 'react-native';
import { ACCOUNTING_CATEGORIES, C, todayStr } from '../../constants/theme';
import { useServerConfig } from '../../hooks/useServerConfig';

interface Record {
  id: number;
  type: 'in' | 'out';
  category: string;
  description: string;
  amount: number;
  date: string;
}

interface Data {
  records: Record[];
  total_in: number;
  total_out: number;
  balance: number;
}

export default function AccountingScreen() {
  const { serverUrl, userId, loading: cfgLoading } = useServerConfig();
  const [data, setData] = useState<Data>({ records: [], total_in: 0, total_out: 0, balance: 0 });
  const [loading, setLoading] = useState(true);

  const [showAdd, setShowAdd] = useState(false);
  const [fType, setFType] = useState<'in' | 'out'>('out');
  const [fCat, setFCat] = useState('餐饮');
  const [fDesc, setFDesc] = useState('');
  const [fAmt, setFAmt] = useState('');

  const load = async () => {
    if (!userId) return;
    try {
      const r = await axios.get(`${serverUrl}/accounting`, { params: { user_id: userId } });
      setData(r.data);
    } catch (e: any) { console.warn('load accounting', e?.message); }
  };

  useFocusEffect(useCallback(() => {
    if (cfgLoading) return;
    (async () => { setLoading(true); await load(); setLoading(false); })();
  }, [serverUrl, userId, cfgLoading]));

  const save = async () => {
    const amt = parseFloat(fAmt);
    if (!fDesc.trim()) { Alert.alert('提示', '请输入描述'); return; }
    if (isNaN(amt) || amt <= 0) { Alert.alert('提示', '金额必须大于 0'); return; }
    try {
      await axios.post(`${serverUrl}/accounting`, {
        user_id: userId, type: fType, category: fCat,
        description: fDesc.trim(), amount: amt, date: todayStr(),
      });
      setShowAdd(false);
      setFType('out'); setFCat('餐饮'); setFDesc(''); setFAmt('');
      await load();
    } catch (e: any) {
      Alert.alert('保存失败', e?.response?.data?.error || e?.message);
    }
  };

  const del = (r: Record) => {
    Alert.alert('删除', `确认删除这条记录？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        try {
          await axios.delete(`${serverUrl}/accounting/${r.id}`, { params: { user_id: userId } });
          await load();
        } catch (e: any) { Alert.alert('删除失败', e?.message); }
      }},
    ]);
  };

  // 分类统计（支出）
  const catStats: Record<string, number> = {} as any;
  data.records.filter(r => r.type === 'out').forEach(r => {
    catStats[r.category] = (catStats[r.category] || 0) + r.amount;
  });
  const catList = Object.entries(catStats).sort((a, b) => b[1] - a[1]);

  if (loading) return (
    <View style={s.center}><ActivityIndicator color={C.accent} /></View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.pageTitle}>💰 记账</Text>

        {/* 结余 */}
        <View style={s.balanceCard}>
          <Text style={s.balanceLabel}>结余</Text>
          <Text style={[s.balanceAmt, { color: data.balance >= 0 ? C.income : C.expense }]}>
            {data.balance >= 0 ? '¥' : '-¥'}{Math.abs(data.balance).toFixed(2)}
          </Text>
          <View style={s.balanceRow}>
            <View style={s.balanceItem}>
              <Text style={s.balanceItemLabel}>收入</Text>
              <Text style={[s.balanceItemAmt, { color: C.income }]}>¥{data.total_in.toFixed(2)}</Text>
            </View>
            <View style={s.balanceItem}>
              <Text style={s.balanceItemLabel}>支出</Text>
              <Text style={[s.balanceItemAmt, { color: C.expense }]}>¥{data.total_out.toFixed(2)}</Text>
            </View>
          </View>
        </View>

        {/* 分类占比 */}
        {catList.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>支出分类</Text>
            {catList.map(([cat, amt]) => {
              const pct = data.total_out > 0 ? (amt / data.total_out) * 100 : 0;
              return (
                <View key={cat} style={s.catRow}>
                  <View style={{ flex: 1 }}>
                    <View style={s.catHead}>
                      <Text style={s.catName}>{cat}</Text>
                      <Text style={s.catAmt}>¥{amt.toFixed(2)}</Text>
                    </View>
                    <View style={s.catBarBg}>
                      <View style={[s.catBar, { width: `${pct}%` }]} />
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* 记录列表 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>明细 ({data.records.length})</Text>
          {data.records.length === 0 && (
            <Text style={s.emptyText}>还没有记录</Text>
          )}
          {data.records.map(r => (
            <TouchableOpacity key={r.id} style={s.recordRow} onLongPress={() => del(r)}>
              <View style={{ flex: 1 }}>
                <Text style={s.recordDesc}>{r.description || r.category}</Text>
                <Text style={s.recordMeta}>{r.category} · {r.date}</Text>
              </View>
              <Text style={[s.recordAmt, { color: r.type === 'in' ? C.income : C.expense }]}>
                {r.type === 'in' ? '+' : '-'}¥{r.amount.toFixed(2)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <TouchableOpacity style={s.fab} onPress={() => setShowAdd(true)} activeOpacity={0.85}>
        <Text style={s.fabText}>＋</Text>
      </TouchableOpacity>

      <Modal visible={showAdd} transparent animationType="slide">
        <KeyboardAvoidingView style={s.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowAdd(false)} />
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>记一笔</Text>
              <TouchableOpacity onPress={() => setShowAdd(false)}>
                <Text style={s.cancelText}>取消</Text>
              </TouchableOpacity>
            </View>

            {/* 收/支切换 */}
            <View style={s.typeRow}>
              <TouchableOpacity
                style={[s.typeBtn, fType === 'out' && s.typeBtnActive]}
                onPress={() => setFType('out')}>
                <Text style={[s.typeText, fType === 'out' && { color: '#fff' }]}>支出</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.typeBtn, fType === 'in' && { backgroundColor: C.income, borderColor: C.income }]}
                onPress={() => setFType('in')}>
                <Text style={[s.typeText, fType === 'in' && { color: '#fff' }]}>收入</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={s.input}
              value={fDesc} onChangeText={setFDesc}
              placeholder="花了什么？" placeholderTextColor={C.textMute}
            />
            <TextInput
              style={s.input}
              value={fAmt} onChangeText={setFAmt}
              placeholder="金额" placeholderTextColor={C.textMute}
              keyboardType="decimal-pad"
            />

            <Text style={s.rowLabel}>分类</Text>
            <View style={s.catGrid}>
              {ACCOUNTING_CATEGORIES.map(cat => {
                const active = fCat === cat;
                return (
                  <TouchableOpacity key={cat}
                    style={[s.catChip, active && s.catChipActive]}
                    onPress={() => setFCat(cat)}>
                    <Text style={[s.catChipText, active && { color: '#fff', fontWeight: '700' }]}>{cat}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

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
  content: { padding: 20, paddingTop: 50, paddingBottom: 100 },
  pageTitle: { color: C.text, fontSize: 26, fontWeight: '800', marginBottom: 20 },
  balanceCard: {
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
    borderRadius: 16, padding: 20, marginBottom: 20,
  },
  balanceLabel: { color: C.textDim, fontSize: 13 },
  balanceAmt: { fontSize: 34, fontWeight: '800', marginTop: 6, marginBottom: 12 },
  balanceRow: { flexDirection: 'row', borderTopColor: C.border, borderTopWidth: 1, paddingTop: 12 },
  balanceItem: { flex: 1, alignItems: 'center' },
  balanceItemLabel: { color: C.textMute, fontSize: 12 },
  balanceItemAmt: { fontSize: 16, fontWeight: '700', marginTop: 4 },
  section: { marginBottom: 24 },
  sectionTitle: { color: C.text, fontSize: 16, fontWeight: '700', marginBottom: 12 },
  emptyText: { color: C.textMute, textAlign: 'center', paddingVertical: 20 },
  catRow: { marginBottom: 12 },
  catHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  catName: { color: C.text, fontSize: 13, flex: 1 },
  catAmt: { color: C.text, fontSize: 13, fontWeight: '600' },
  catBarBg: { height: 6, backgroundColor: C.card2, borderRadius: 3, overflow: 'hidden' },
  catBar: { height: '100%', backgroundColor: C.accent },
  recordRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomColor: C.border, borderBottomWidth: 1,
  },
  recordDesc: { color: C.text, fontSize: 14 },
  recordMeta: { color: C.textMute, fontSize: 11, marginTop: 2 },
  recordAmt: { fontSize: 15, fontWeight: '700' },
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
  typeRow: { flexDirection: 'row', marginBottom: 12 },
  typeBtn: {
    flex: 1, borderColor: C.border, borderWidth: 1, borderRadius: 8,
    paddingVertical: 10, alignItems: 'center', marginRight: 8,
  },
  typeBtnActive: { backgroundColor: C.expense, borderColor: C.expense },
  typeText: { color: C.textDim, fontSize: 14, fontWeight: '600' },
  input: {
    color: C.text, backgroundColor: C.card2,
    borderColor: C.border, borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 12,
  },
  rowLabel: { color: C.textDim, fontSize: 13, marginBottom: 8 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },
  catChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderColor: C.border, borderWidth: 1, marginRight: 8, marginBottom: 8,
    backgroundColor: C.card2,
  },
  catChipActive: { backgroundColor: C.accent, borderColor: C.accent },
  catChipText: { color: C.textDim, fontSize: 12 },
  saveBtn: {
    backgroundColor: C.accent, borderRadius: 24,
    paddingVertical: 14, alignItems: 'center',
  },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
