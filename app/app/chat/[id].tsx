// 单聊页 —— 跟某个角色对话
// 从聊天 tab 的角色列表点进来。route: /chat/[id]
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import axios from 'axios';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform,
  ScrollView, StatusBar, StyleSheet, Text, TextInput,
  TouchableOpacity, View
} from 'react-native';
import EmotionTag from '../../components/EmotionTag';
import { C, nowTime } from '../../constants/theme';
import { useServerConfig } from '../../hooks/useServerConfig';

interface Character {
  id: string;
  name: string;
  greeting: string;
  voice_id: string;
  avatar_emoji: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  emotion?: string;
  time: string;
  imageUri?: string;      // 用户发过来的本地图片路径（不上传服务端持久化）
  audioB64?: string;      // 助手消息的语音（合成后缓存）
}

interface HistoryRow {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  emotion: string | null;
  created_at: string;
}

export default function CharacterChatScreen() {
  const router = useRouter();
  const { id: charId } = useLocalSearchParams<{ id: string }>();
  const { serverUrl, userId, loading: cfgLoading } = useServerConfig();

  const [character, setCharacter] = useState<Character | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingInit, setLoadingInit] = useState(true);
  const [pendingImage, setPendingImage] = useState<{ base64: string; mediaType: string; uri: string } | null>(null);
  const [ttsAvailable, setTtsAvailable] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    if (cfgLoading || !userId || !charId) return;
    (async () => {
      setLoadingInit(true);
      try {
        const [charRes, histRes, cfgRes] = await Promise.all([
          axios.get(`${serverUrl}/characters/${charId}`, { timeout: 8000 }),
          axios.get(`${serverUrl}/chat/history`, {
            params: { user_id: userId, character_id: charId }, timeout: 8000,
          }),
          axios.get(`${serverUrl}/config`, { timeout: 5000 }),
        ]);
        setCharacter(charRes.data);
        const rows: HistoryRow[] = histRes.data?.history || [];
        setMessages(rows.map(r => ({
          id: `h_${r.id}`,
          role: r.role,
          content: r.content,
          emotion: r.emotion || undefined,
          time: r.created_at?.slice(11, 16) || '',
        })));
        // TTS 是否可用：Fish key 配了 + 角色有 voice_id
        const cfg = cfgRes.data;
        setTtsAvailable(cfg?.has_fish_key && !!charRes.data?.voice_id);
      } catch (e: any) {
        Alert.alert('加载失败', e?.message || '请检查后端连接');
      } finally { setLoadingInit(false); }
    })();
    return () => { soundRef.current?.unloadAsync().catch(() => {}); };
  }, [serverUrl, userId, charId, cfgLoading]);

  const pickImage = async (fromCamera: boolean) => {
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('权限', '需要授权才能使用'); return; }
      const res = fromCamera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6, base64: true })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6, base64: true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      if (!a.base64) { Alert.alert('错误', '无法获取图片数据'); return; }
      setPendingImage({ base64: a.base64, mediaType: a.mimeType || 'image/jpeg', uri: a.uri });
    } catch (e: any) { Alert.alert('选图失败', e?.message); }
  };

  const openImagePicker = () => {
    Alert.alert('发图', '', [
      { text: '📷 拍照', onPress: () => pickImage(true) },
      { text: '🖼️ 相册', onPress: () => pickImage(false) },
      { text: '取消', style: 'cancel' },
    ]);
  };

  const playAudio = async (b64: string) => {
    try {
      if (soundRef.current) { await soundRef.current.unloadAsync(); soundRef.current = null; }
      const { sound } = await Audio.Sound.createAsync(
        { uri: 'data:audio/mp3;base64,' + b64 },
        { shouldPlay: true, volume: 1.0 },
      );
      soundRef.current = sound;
    } catch (e: any) { console.warn('audio play', e?.message); }
  };

  const requestTts = async (msg: Message) => {
    if (!ttsAvailable || !character?.voice_id) return;
    try {
      const r = await axios.post(`${serverUrl}/tts`, {
        text: msg.content,
        emotion: msg.emotion || '平静',
        voice_id: character.voice_id,
      }, { timeout: 30000 });
      const b64 = r.data?.audio_b64;
      if (b64) {
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, audioB64: b64 } : m));
        await playAudio(b64);
      }
    } catch (e: any) { console.warn('tts', e?.response?.data?.error || e?.message); }
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && !pendingImage) || sending) return;
    setInput('');
    const imgToSend = pendingImage;
    setPendingImage(null);

    const userMsg: Message = {
      id: `u_${Date.now()}`, role: 'user',
      content: text || (imgToSend ? '[图片]' : ''),
      time: nowTime(),
      imageUri: imgToSend?.uri,
    };
    setMessages(prev => [...prev, userMsg]);
    setSending(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);

    try {
      let res;
      if (imgToSend) {
        res = await axios.post(`${serverUrl}/chat/image`, {
          user_id: userId, character_id: charId,
          image_base64: imgToSend.base64, media_type: imgToSend.mediaType,
          text,
        }, { timeout: 90000 });
      } else {
        res = await axios.post(`${serverUrl}/chat/text`, {
          text, user_id: userId, character_id: charId,
        }, { timeout: 60000 });
      }
      const reply: Message = {
        id: `a_${Date.now()}`, role: 'assistant',
        content: res.data?.content || '',
        emotion: res.data?.emotion || undefined,
        time: nowTime(),
      };
      setMessages(prev => [...prev, reply]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);

      // 如果开了自动 TTS，就合成 + 播放
      if (ttsEnabled && ttsAvailable) requestTts(reply);
    } catch (e: any) {
      Alert.alert('发送失败', e?.response?.data?.error || e?.message);
    } finally { setSending(false); }
  };

  const clearHistory = () => {
    Alert.alert('清空历史', '确定清除这个角色的所有聊天历史？', [
      { text: '取消', style: 'cancel' },
      { text: '清空', style: 'destructive', onPress: async () => {
        try {
          await axios.delete(`${serverUrl}/chat/history`, {
            params: { user_id: userId, character_id: charId },
          });
          setMessages([]);
        } catch (e: any) { Alert.alert('失败', e?.message); }
      }},
    ]);
  };

  if (loadingInit) return (
    <View style={s.center}><ActivityIndicator color={C.accent} /></View>
  );
  if (!character) return (
    <View style={s.center}>
      <Text style={{ color: C.text }}>角色不存在</Text>
      <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
        <Text style={{ color: C.accent2 }}>返回</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={C.card} />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹</Text>
        </TouchableOpacity>
        <View style={s.headerAvatar}>
          <Text style={s.headerAvatarText}>{character.avatar_emoji || '🤖'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.headerName} numberOfLines={1}>{character.name}</Text>
          <Text style={s.headerSub} numberOfLines={1}>@{character.id}</Text>
        </View>
        {ttsAvailable && (
          <TouchableOpacity
            style={[s.ttsBtn, ttsEnabled && s.ttsBtnActive]}
            onPress={() => setTtsEnabled(v => !v)}
          >
            <Text style={s.ttsBtnText}>🔊</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={clearHistory} style={s.clearBtn}>
          <Text style={s.clearText}>清空</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={s.chatArea}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>{character.avatar_emoji || '💬'}</Text>
            <Text style={s.emptyText}>
              {character.greeting || `跟 ${character.name} 说点什么吧`}
            </Text>
          </View>
        )}
        {messages.map(msg => (
          <View key={msg.id} style={[
            s.bubble,
            msg.role === 'user' ? s.userBubble : s.assistantBubble,
          ]}>
            {msg.imageUri && (
              <Image source={{ uri: msg.imageUri }} style={s.msgImage} resizeMode="cover" />
            )}
            {msg.content ? (
              <Text style={msg.role === 'user' ? s.userText : s.assistantText}>{msg.content}</Text>
            ) : null}
            {msg.role === 'assistant' && (
              <View style={s.assistantMeta}>
                {msg.emotion && <EmotionTag emotion={msg.emotion} />}
                {ttsAvailable && (
                  <TouchableOpacity onPress={() => msg.audioB64 ? playAudio(msg.audioB64) : requestTts(msg)}>
                    <Text style={s.playBtn}>{msg.audioB64 ? '🔁' : '🔊'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        ))}
        {sending && (
          <View style={[s.bubble, s.assistantBubble]}>
            <ActivityIndicator color={C.textDim} size="small" />
          </View>
        )}
      </ScrollView>

      {pendingImage && (
        <View style={s.pendingImageBar}>
          <Image source={{ uri: pendingImage.uri }} style={s.pendingImage} />
          <Text style={s.pendingText}>准备发送这张图</Text>
          <TouchableOpacity onPress={() => setPendingImage(null)}>
            <Text style={s.pendingRemove}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.inputBar}>
          <TouchableOpacity style={s.imgBtn} onPress={openImagePicker}>
            <Text style={s.imgBtnText}>📷</Text>
          </TouchableOpacity>
          <TextInput
            style={s.input}
            value={input} onChangeText={setInput}
            placeholder={pendingImage ? '给图片写个说明…' : '有什么想说的…'}
            placeholderTextColor={C.textMute}
            multiline maxLength={500}
            editable={!sending}
          />
          <TouchableOpacity
            style={[s.sendBtn, (!input.trim() && !pendingImage) || sending ? s.sendBtnDisabled : null]}
            onPress={send} disabled={(!input.trim() && !pendingImage) || sending}
          >
            <Text style={s.sendText}>发送</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingTop: 50, paddingBottom: 10,
    backgroundColor: C.card, borderBottomColor: C.border, borderBottomWidth: 1,
  },
  backBtn: { paddingHorizontal: 8 },
  backText: { color: C.accent2, fontSize: 32, marginTop: -4 },
  headerAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.card2,
    alignItems: 'center', justifyContent: 'center', marginHorizontal: 8,
  },
  headerAvatarText: { fontSize: 18 },
  headerName: { color: C.text, fontSize: 16, fontWeight: '700' },
  headerSub: { color: C.textMute, fontSize: 11 },
  ttsBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderColor: C.border, borderWidth: 1, borderRadius: 8, marginRight: 6,
  },
  ttsBtnActive: { backgroundColor: C.accent + '33', borderColor: C.accent },
  ttsBtnText: { fontSize: 14 },
  clearBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderColor: C.border, borderWidth: 1, borderRadius: 8,
  },
  clearText: { color: C.textDim, fontSize: 12 },
  chatArea: { padding: 16, paddingBottom: 24 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: C.textDim, fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
  bubble: {
    maxWidth: '82%', padding: 12, borderRadius: 16, marginBottom: 10,
  },
  userBubble: {
    alignSelf: 'flex-end', backgroundColor: C.userBubble,
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: 'flex-start', backgroundColor: C.card2,
    borderBottomLeftRadius: 4,
  },
  userText: { color: '#fff', fontSize: 15 },
  assistantText: { color: C.text, fontSize: 15 },
  assistantMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  playBtn: { fontSize: 14, marginLeft: 8, color: C.textDim },
  msgImage: {
    width: 200, height: 150, borderRadius: 8, marginBottom: 6, backgroundColor: C.card,
  },
  pendingImageBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: C.card2, borderTopColor: C.border, borderTopWidth: 1,
  },
  pendingImage: { width: 40, height: 40, borderRadius: 6, marginRight: 10 },
  pendingText: { color: C.textDim, fontSize: 12, flex: 1 },
  pendingRemove: { color: C.danger, fontSize: 18, paddingHorizontal: 8 },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    padding: 8, backgroundColor: C.card,
    borderTopColor: C.border, borderTopWidth: 1,
  },
  imgBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: C.card2,
    alignItems: 'center', justifyContent: 'center', marginRight: 8,
  },
  imgBtnText: { fontSize: 20 },
  input: {
    flex: 1, minHeight: 40, maxHeight: 120,
    color: C.text, backgroundColor: C.card2,
    borderColor: C.border, borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8, fontSize: 15, marginRight: 8,
  },
  sendBtn: {
    paddingHorizontal: 16, height: 40, backgroundColor: C.accent,
    borderRadius: 20, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendText: { color: '#fff', fontWeight: '700' },
});
