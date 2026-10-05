import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import {
  audioDirectory,
  clearAudioDirectory,
  ensureAudioDirectory,
  initializeCharacterStorage,
  messageKey,
  migrateLegacy,
  writeAudioFile,
  writeMessages,
} from '../services/characterStorage';

const reportedScope = {
  server: 'https://gojotest.zeabur.app',
  user: 'user_u7a5zeu4a1b',
  id: 'satoru',
};
const root = 'file:///documents/chat_v2/';
const directories = new Set<string>();
const files = new Map<string, string>();

const getInfo = FileSystem.getInfoAsync as jest.Mock;
const makeDirectory = FileSystem.makeDirectoryAsync as jest.Mock;
const deleteFile = FileSystem.deleteAsync as jest.Mock;
const readDirectory = FileSystem.readDirectoryAsync as jest.Mock;
const writeString = FileSystem.writeAsStringAsync as jest.Mock;

function assertValidUri(uri: string) {
  expect(uri.startsWith(root) || uri.startsWith('file:///documents/chat_audio_')).toBe(true);
  for (const part of uri.split('/')) {
    if (/%(?![0-9A-Fa-f]{2})/.test(part)) throw new Error(`Invalid percent escape in ${uri}`);
  }
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  directories.clear();
  files.clear();
  getInfo.mockReset().mockImplementation(async (uri: string) => ({
    exists: directories.has(uri) || files.has(uri),
    isDirectory: directories.has(uri),
    uri,
  }));
  makeDirectory.mockReset().mockImplementation(async (uri: string) => {
    assertValidUri(uri);
    directories.add(uri);
  });
  deleteFile.mockReset().mockImplementation(async (uri: string) => {
    assertValidUri(uri);
    for (const path of directories) if (path.startsWith(uri)) directories.delete(path);
    for (const path of files.keys()) if (path.startsWith(uri)) files.delete(path);
  });
  readDirectory.mockReset().mockImplementation(async (uri: string) => {
    assertValidUri(uri);
    return [...files.keys()].filter(path => path.startsWith(uri)).map(path => path.slice(uri.length));
  });
  writeString.mockReset().mockImplementation(async (uri: string, base64: string) => {
    assertValidUri(uri);
    if (!directories.has(uri.slice(0, uri.lastIndexOf('/') + 1))) {
      throw new Error(`Parent directory is missing for ${uri}`);
    }
    files.set(uri, base64);
  });
});

afterEach(() => jest.restoreAllMocks());

test('the reported 85-character token keeps every percent escape in one directory segment', () => {
  const token = encodeURIComponent(JSON.stringify([
    reportedScope.server, reportedScope.user, reportedScope.id,
  ]));
  expect(token).toHaveLength(85);
  const directory = audioDirectory(reportedScope);
  expect(directory.startsWith(root)).toBe(true);
  expect(directory.endsWith('/files/')).toBe(true);
  const chunks = directory.slice(root.length, -'/files/'.length).split('/');
  expect(chunks.join('')).toBe(token);
  expect(chunks.every(chunk => chunk.length <= 80 && !/%(?![0-9A-Fa-f]{2})/.test(chunk))).toBe(true);
  expect(chunks).toEqual([token.slice(0, 79), token.slice(79)]);
});

test('a short token keeps its existing directory', () => {
  const scope = { server: 'https://a.test', user: 'u', id: 'g' };
  const token = encodeURIComponent(JSON.stringify([scope.server, scope.user, scope.id]));
  expect(token.length).toBeLessThanOrEqual(80);
  expect(audioDirectory(scope)).toBe(`${root}${token}/files/`);
});

test('a long token with a safe old boundary keeps its existing audio path', () => {
  const scope = { ...reportedScope, id: 'longcharacter' };
  const token = encodeURIComponent(JSON.stringify([scope.server, scope.user, scope.id]));
  expect(token.length).toBeGreaterThan(80);
  expect(token[79]).not.toBe('%');
  expect(token[78]).not.toBe('%');
  expect(audioDirectory(scope)).toBe(`${root}${token.slice(0, 80)}/${token.slice(80)}/files/`);
});

test('first audio write creates its parent before writing the generated MP3 name', async () => {
  const id = '1791212834034_0';
  const expected = `${audioDirectory(reportedScope)}${id}.mp3`;
  expect(await writeAudioFile(reportedScope, id, 'YXVkaW8=')).toBe(expected);
  expect(makeDirectory).toHaveBeenCalledWith(audioDirectory(reportedScope), { intermediates: true });
  expect(files.get(expected)).toBe('YXVkaW8=');
  expect(writeString).toHaveBeenCalledWith(expected, 'YXVkaW8=', {
    encoding: FileSystem.EncodingType.Base64,
  });
});

test('a directory removed outside the chat is recreated before the next write', async () => {
  const directory = audioDirectory(reportedScope);
  await writeAudioFile(reportedScope, 'first', 'MQ==');
  await FileSystem.deleteAsync(directory, { idempotent: true });
  expect(directories.has(directory)).toBe(false);
  expect(await writeAudioFile(reportedScope, 'second', 'Mg==')).toBe(`${directory}second.mp3`);
  expect(directories.has(directory)).toBe(true);
  expect(makeDirectory).toHaveBeenCalledTimes(2);
});

test('legacy MP3 migration copies into the corrected directory before deleting the old one', async () => {
  const oldDirectory = 'file:///documents/chat_audio_satoru/';
  directories.add(oldDirectory);
  files.set(`${oldDirectory}old.mp3`, 'b2xk');
  await initializeCharacterStorage(reportedScope.server, reportedScope.user);
  await migrateLegacy(reportedScope);
  expect(FileSystem.copyAsync).toHaveBeenCalledWith({
    from: `${oldDirectory}old.mp3`,
    to: `${audioDirectory(reportedScope)}old.mp3`,
  });
  expect(deleteFile).toHaveBeenCalledWith(oldDirectory, { idempotent: true });
});

test('clearing a chat removes its audio and later generation recreates only that scope', async () => {
  const other = { ...reportedScope, user: 'another-user' };
  const own = audioDirectory(reportedScope);
  const otherDirectory = audioDirectory(other);
  await Promise.all([
    writeAudioFile(reportedScope, 'old', 'b2xk'),
    writeAudioFile(other, 'keep', 'a2VlcA=='),
  ]);
  await clearAudioDirectory(reportedScope);
  expect(directories.has(own)).toBe(false);
  expect(files.has(`${own}old.mp3`)).toBe(false);
  expect(files.get(`${otherDirectory}keep.mp3`)).toBe('a2VlcA==');
  expect(await writeAudioFile(reportedScope, 'new', 'bmV3')).toBe(`${own}new.mp3`);
  expect(files.get(`${own}new.mp3`)).toBe('bmV3');
  expect(files.get(`${otherDirectory}keep.mp3`)).toBe('a2VlcA==');
});

test('concurrent users, roles, and servers get separate audio directories', async () => {
  const scopes = [
    reportedScope,
    { ...reportedScope, user: 'user-2' },
    { ...reportedScope, id: 'another-role' },
    { ...reportedScope, server: 'https://other.test' },
  ];
  const paths = await Promise.all(scopes.map((scope, i) => writeAudioFile(scope, 'same-id', `audio-${i}`)));
  expect(new Set(paths).size).toBe(scopes.length);
  paths.forEach((path, i) => {
    expect(path).toBe(`${audioDirectory(scopes[i])}same-id.mp3`);
    expect(files.get(path!)).toBe(`audio-${i}`);
  });
  expect(files.size).toBe(scopes.length);
});

test('directory creation failure returns null and retains the text reply', async () => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await writeMessages(reportedScope, '[{"text":"reply"}]');
  makeDirectory.mockRejectedValueOnce(new Error('disk unavailable'));
  await expect(writeAudioFile(reportedScope, 'reply', 'YXVkaW8=')).resolves.toBeNull();
  expect(warning).toHaveBeenCalledWith('saveAudioFile', expect.any(Error));
  expect(writeString).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(messageKey(reportedScope))).toBe('[{"text":"reply"}]');
});

test('audio write failure returns null and a later attempt can use the directory', async () => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await ensureAudioDirectory(reportedScope);
  writeString.mockRejectedValueOnce(new Error("Location isn't writable"));
  await expect(writeAudioFile(reportedScope, 'reply', 'YXVkaW8=')).resolves.toBeNull();
  expect(warning).toHaveBeenCalledWith('saveAudioFile', expect.any(Error));
  expect(await writeAudioFile(reportedScope, 'reply', 'YXVkaW8=')).toBe(`${audioDirectory(reportedScope)}reply.mp3`);
  expect(files.get(`${audioDirectory(reportedScope)}reply.mp3`)).toBe('YXVkaW8=');
});
