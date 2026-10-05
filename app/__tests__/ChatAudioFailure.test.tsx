import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import axios from 'axios';
import ChatRoom from '../app/chat/[id]';
import { FIXED_USER_ID, SERVER_URL, setServerUrl } from '../constants/theme';
import { messageKey } from '../services/characterStorage';

const mockRouter = { replace: jest.fn(), back: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: 'satoru' }),
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

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  await setServerUrl('https://audio-failure.test');
  (axios.get as jest.Mock).mockImplementation((url: string) => Promise.resolve({ data:
    url.endsWith('/characters/satoru') ? { id: 'satoru', name: '悟' } : { accounts: [], messages: [] },
  }));
});

afterEach(() => jest.restoreAllMocks());

test('audio cache write failure keeps the text reply and does not show a connection error', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  (FileSystem.writeAsStringAsync as jest.Mock).mockRejectedValueOnce(new Error("Location isn't writable"));
  (axios.post as jest.Mock).mockResolvedValue({ data: {
    messages: [{ jp: '音频失败后的文字回复', zh: '', audio_b64: 'a'.repeat(120) }],
  } });

  const chat = render(<ChatRoom />);
  await act(async () => { await new Promise<void>(resolve => setImmediate(resolve)); });
  await waitFor(() => expect(chat.getByPlaceholderText('说点什么...')).toBeTruthy());
  fireEvent.changeText(chat.getByPlaceholderText('说点什么...'), '你好');
  fireEvent.press(chat.getByText('发送'));

  await waitFor(() => expect(chat.getByText('音频失败后的文字回复')).toBeTruthy());
  expect(FileSystem.writeAsStringAsync).toHaveBeenCalledTimes(1);
  expect(warning).toHaveBeenCalledWith('saveAudioFile', expect.any(Error));
  expect(alert.mock.calls.some(([title]) => title === '连接失败')).toBe(false);
  const scope = { server: SERVER_URL, user: FIXED_USER_ID, id: 'satoru' };
  await waitFor(async () => expect(await AsyncStorage.getItem(messageKey(scope))).toContain('音频失败后的文字回复'));
  chat.unmount();
});

test('an emoji-only reply without TTS appears without an audio write', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (axios.post as jest.Mock).mockResolvedValue({ data: {
    messages: [{ jp: '🙂', zh: '', audio_b64: '' }],
  } });

  const chat = render(<ChatRoom />);
  await act(async () => { await new Promise<void>(resolve => setImmediate(resolve)); });
  await waitFor(() => expect(chat.getByPlaceholderText('说点什么...')).toBeTruthy());
  fireEvent.changeText(chat.getByPlaceholderText('说点什么...'), '表情');
  fireEvent.press(chat.getByText('发送'));

  await waitFor(() => expect(chat.getByText('🙂')).toBeTruthy());
  expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  expect(alert.mock.calls.some(([title]) => title === '连接失败')).toBe(false);
  chat.unmount();
});
