jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/', EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(async () => {}),
  readDirectoryAsync: jest.fn(async () => []),
  deleteAsync: jest.fn(async () => {}), copyAsync: jest.fn(async () => {}),
  writeAsStringAsync: jest.fn(async () => {}),
}));
jest.mock('expo-notifications', () => ({
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  getPresentedNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  dismissNotificationAsync: jest.fn(async () => {}),
}));
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'b2e34ba6-0919-44a1-8bc0-c3b8e5e843ce' }));
