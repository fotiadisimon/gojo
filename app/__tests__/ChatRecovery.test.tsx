import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import ChatRoom from '../app/chat/[id]';
import { FIXED_USER_ID, SERVER_URL, setServerUrl } from '../constants/theme';
import { cancelFailedDeletion, messageKey, writeMessages } from '../services/characterStorage';
import { deletePermanently } from '../services/characterDeletion';

const mockRouter = { replace: jest.fn(), back: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: 'Gojo' }),
  useFocusEffect: (cb: any) => { require('react').useEffect(cb, [cb]); },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-av', () => ({ Audio: { setAudioModeAsync: jest.fn(async () => {}) } }));
jest.mock('expo-clipboard', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-intent-launcher', () => ({}));
jest.mock('expo-video-thumbnails', () => ({}));
jest.mock('../components/PendingTransactionCard', () => () => null);
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  setNotificationChannelAsync: jest.fn(async () => {}),
  AndroidImportance: { HIGH: 4 },
}));

test('real chat screen resumes sending after refusal cancellation; old response stays fenced', async () => {
  await AsyncStorage.clear(); jest.clearAllMocks(); await setServerUrl('https://chat-recovery.test');
  const s = { server: SERVER_URL, user: FIXED_USER_ID, id: 'Gojo' };
  await writeMessages(s, JSON.stringify([{ id: 'saved', role: 'user', text: '保留的聊天', time: '10:00' }]));
  (axios.get as jest.Mock).mockImplementation((url: string) => Promise.resolve({ data:
    url.endsWith('/characters/Gojo') ? { id: 'Gojo', name: '恢复角色' } : { accounts: [], messages: [] },
  }));
  let resolveOld!: (value: unknown) => void;
  (axios.post as jest.Mock).mockImplementation((url: string) => {
    if (url.endsWith('permanent-deletion')) return Promise.reject({ response: { status: 403 } });
    return new Promise(resolve => { resolveOld = resolve; });
  });
  const old = render(<ChatRoom />);
  await waitFor(() => expect(old.getByText('保留的聊天')).toBeTruthy());
  fireEvent.changeText(old.getByPlaceholderText('说点什么...'), '删除前仍在等待的消息');
  fireEvent.press(old.getByText('发送'));
  await waitFor(() => expect(resolveOld).toBeDefined());
  await act(async () => { await expect(deletePermanently(s, 'wrong', 'op')).rejects.toThrow('未执行'); });
  expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/chat');
  old.unmount(); await cancelFailedDeletion(s);

  (axios.post as jest.Mock).mockResolvedValue({ data: { messages: [{ jp: '恢复后的新回复', zh: '', audio_b64: '' }] } });
  const resumed = render(<ChatRoom />);
  await waitFor(() => expect(resumed.getByText('保留的聊天')).toBeTruthy());
  fireEvent.changeText(resumed.getByPlaceholderText('说点什么...'), '恢复后继续聊天');
  fireEvent.press(resumed.getByText('发送'));
  await waitFor(() => expect(resumed.getByText('恢复后的新回复')).toBeTruthy());
  expect(axios.post).toHaveBeenCalledWith(`${s.server}/chat/text`, {
    text: '恢复后继续聊天', user_id: s.user, character_id: s.id,
  });
  await act(async () => {
    resolveOld({ data: { messages: [{ jp: '旧请求的迟到回复', zh: '', audio_b64: '' }] } });
    await new Promise(r => setImmediate(r));
  });
  await waitFor(async () => {
    const saved = (await AsyncStorage.getItem(messageKey(s)))!;
    expect(saved).toContain('保留的聊天'); expect(saved).toContain('恢复后的新回复');
    expect(saved).not.toContain('旧请求的迟到回复');
  });
  resumed.unmount();
});
