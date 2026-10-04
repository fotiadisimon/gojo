import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import axios from 'axios';
import * as Crypto from 'expo-crypto';
import { C } from '../constants/theme';
import { deletePermanently } from '../services/characterDeletion';
import { cancelFailedDeletion, deletionState, Scope } from '../services/characterStorage';

export type DeleteTarget = Scope & { name?: string; avatar_url?: string };
export default function DeleteCharacterModal({ target, onClose, onComplete }: {
  target: DeleteTarget; onClose: () => void; onComplete: () => void;
}) {
  const [key, setKey] = useState('');
  const [confirmedId, setConfirmedId] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(false);
  const [localOnly, setLocalOnly] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const [serverIdentity, setServerIdentity] = useState('');
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const state = await deletionState(target);
        if (mounted) {
          setRetry(!!state); setCanCancel(state?.phase === 'failed');
          if (state) setConfirmedId(target.id);
        }
        if (state?.phase === 'server_deleted') {
          if (mounted) { setRetry(true); setLocalOnly(true); setConfirmedId(target.id); setReady(true); }
          return;
        }
        const { data } = await axios.get(`${target.server}/character-deletion/capabilities`, { timeout: 10000 });
        if (data.protocol !== 'gojo-pub-character-delete-v1') throw new Error('此后端不支持本版永久删除');
        if (!data.admin_configured) throw new Error('服务器需先配置 CHARACTER_DELETE_ADMIN_KEY');
        if (mounted) {
          setReady(true); setServerIdentity(data.server_id); setRetry(!!state);
          if (state) setConfirmedId(target.id);
        }
      } catch (e: any) { if (mounted) setError(e?.message || '无法核对后端能力'); }
    })();
    return () => { mounted = false; };
  }, [target]);

  const confirm = async () => {
    if (busyRef.current || !ready || confirmedId !== target.id || (!key && !localOnly)) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      await deletePermanently(target, key, Crypto.randomUUID());
      setKey(''); onComplete();
    } catch (e: any) {
      setError(e?.message || '删除失败，请重试'); setRetry(true);
      try {
        const state = await deletionState(target);
        setCanCancel(state?.phase === 'failed');
        if (state?.phase === 'server_deleted') setLocalOnly(true);
      } catch { setCanCancel(false); }
    } finally { busyRef.current = false; setBusy(false); }
  };
  const cancel = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      if (canCancel) await cancelFailedDeletion(target);
      setKey(''); onClose();
    } catch (e: any) { setError(e?.message || '取消失败，请重试'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return (
    <Modal transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: '#000b', padding: 20 }}>
        <ScrollView contentContainerStyle={{ backgroundColor: C.card, padding: 20, borderRadius: 16 }}>
          <Text style={{ color: C.expense, fontSize: 21, fontWeight: 'bold' }}>永久删除角色</Text>
          {target.avatar_url ? <Image source={{ uri: target.avatar_url }} style={{ width: 64, height: 64, borderRadius: 32, marginVertical: 12 }} /> : null}
          <Text style={{ color: C.text, fontSize: 18, marginTop: 12 }}>{target.name || '待完成删除的角色'}</Text>
          <Text selectable style={{ color: C.text }}>精确 ID：{target.id}</Text>
          <Text selectable style={{ color: C.textDim, marginVertical: 10 }}>后端：{target.server}{'\n'}实例：{serverIdentity || '核对中'}</Text>
          <Text style={{ color: C.text, lineHeight: 23 }}>
            将永久清除此服务器上所有用户与该 ID 关联的聊天、角色记忆、日记及评论、关系、日程与后台任务，并清理本机聊天和语音。无法恢复。{'\n\n'}
            保留其他角色、共享用户资料、个人日记、账本、课程、待办和设备配置。已经发送的外部通知无法撤回。
          </Text>
          {!localOnly && <>
            <TextInput testID="delete-admin-key" secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="服务器永久删除管理凭证（本次使用，不保存）" placeholderTextColor={C.textMute}
              value={key} onChangeText={setKey} editable={!busy} style={{ color: C.text, borderColor: C.border, borderWidth: 1, padding: 12, marginTop: 16 }} />
            <TextInput testID="delete-confirm-id" autoCapitalize="none" autoCorrect={false} placeholder={`输入精确 ID：${target.id}`} placeholderTextColor={C.textMute}
              value={confirmedId} onChangeText={setConfirmedId} editable={!busy} style={{ color: C.text, borderColor: C.border, borderWidth: 1, padding: 12, marginTop: 10 }} />
          </>}
          {canCancel ? <Text style={{ color: C.textDim, marginTop: 12 }}>本次删除已明确失败，原数据保留。可取消失败尝试并恢复聊天。</Text> : null}
          {error ? <Text accessibilityRole="alert" style={{ color: C.expense, marginTop: 12 }}>{error}</Text> : null}
          {busy ? <ActivityIndicator style={{ marginTop: 16 }} /> : null}
          <TouchableOpacity testID="delete-confirm" accessibilityRole="button" disabled={busy || !ready || confirmedId !== target.id || (!key && !localOnly)} onPress={confirm}
            style={{ opacity: busy || !ready || confirmedId !== target.id || (!key && !localOnly) ? 0.4 : 1, backgroundColor: C.expense, padding: 14, borderRadius: 8, marginTop: 16 }}>
            <Text style={{ color: '#fff', textAlign: 'center' }}>{localOnly ? '重试本机清理' : canCancel ? '重试永久删除' : retry ? '查询／重试同一删除操作' : '确认永久删除'}</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="delete-cancel" disabled={busy} onPress={cancel} style={{ padding: 14 }}>
            <Text style={{ color: C.textDim, textAlign: 'center' }}>{canCancel ? '取消失败尝试并恢复聊天' : retry ? '稍后继续' : '取消'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}
