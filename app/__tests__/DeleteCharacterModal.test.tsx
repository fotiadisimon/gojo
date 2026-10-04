import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DeleteCharacterModal from '../components/DeleteCharacterModal';
import ChatList from '../app/(tabs)/chat';
import { setServerUrl, SERVER_URL, FIXED_USER_ID } from '../constants/theme';
import { deletionState, isBlocked, messageKey, writeMessages } from '../services/characterStorage';
import { deletePermanently } from '../services/characterDeletion';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (cb: any) => { require('react').useEffect(cb, []); },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({top:0,bottom:0,left:0,right:0}) }));
const press = async (element: any) => { await act(async()=>{fireEvent.press(element);await new Promise(r=>setImmediate(r));}); };
const capabilities={data:{protocol:'gojo-pub-character-delete-v1',server_id:'test-instance',admin_configured:true}};
let index=0;
const target=()=>({server:`https://ui-${++index}.test`,user:'u1',id:'Gojo',name:'同名角色',avatar_url:'data:image/png;base64,AA'});
beforeEach(async()=>{await AsyncStorage.clear();jest.clearAllMocks();(axios.get as jest.Mock).mockResolvedValue(capabilities);});

test('cancel confirmation never sends a delete',async()=>{
 const onClose=jest.fn();const t=target();const ui=await render(<DeleteCharacterModal target={t} onClose={onClose} onComplete={jest.fn()} />);
 await waitFor(()=>expect(ui.getByText(/实例：test-instance/)).toBeTruthy());
 await press(ui.getByTestId('delete-cancel'));expect(onClose).toHaveBeenCalled();expect(axios.post).not.toHaveBeenCalled();
});

test('exact case required and duplicate confirmation disabled while request is running',async()=>{
 const done=jest.fn();const t=target();let resolve!:any;
 (axios.post as jest.Mock).mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const ui=await render(<DeleteCharacterModal target={t} onClose={jest.fn()} onComplete={done}/>);
 await waitFor(()=>expect(ui.getByText(/实例：test-instance/)).toBeTruthy());
 await fireEvent.changeText(ui.getByTestId('delete-admin-key'),'secret');await fireEvent.changeText(ui.getByTestId('delete-confirm-id'),'gojo');
 await press(ui.getByTestId('delete-confirm'));expect(axios.post).not.toHaveBeenCalled();
 await fireEvent.changeText(ui.getByTestId('delete-confirm-id'),'Gojo');
 await press(ui.getByTestId('delete-confirm'));
 await waitFor(()=>expect(axios.post).toHaveBeenCalledTimes(1));
 await press(ui.getByTestId('delete-confirm'));expect(axios.post).toHaveBeenCalledTimes(1);expect(done).not.toHaveBeenCalled();
 await act(async()=>{resolve({data:{status:'deleted',character_id:'Gojo'}});await new Promise(r=>setImmediate(r));});
 await waitFor(()=>expect(done).toHaveBeenCalledTimes(1));
});

test('wrong credential offers safe cancellation, retains history and never reports deletion success',async()=>{
 const done=jest.fn(), close=jest.fn();const t=target(); await writeMessages(t,'history');
 (axios.post as jest.Mock).mockRejectedValue({response:{status:403,data:{detail:'永久删除需要服务器管理凭证'}}});
 (axios.get as jest.Mock).mockImplementation((url:string)=>Promise.resolve(url.endsWith('capabilities')?capabilities:{data:{status:'not_committed'}}));
 const ui=await render(<DeleteCharacterModal target={t} onClose={close} onComplete={done}/>);
 await waitFor(()=>expect(ui.getByText(/实例：test-instance/)).toBeTruthy());
 await fireEvent.changeText(ui.getByTestId('delete-admin-key'),'bad');await fireEvent.changeText(ui.getByTestId('delete-confirm-id'),'Gojo');await press(ui.getByTestId('delete-confirm'));
 await waitFor(()=>expect(ui.getByText(/管理凭证被拒绝/)).toBeTruthy());
 expect(done).not.toHaveBeenCalled();expect(ui.getByText('重试永久删除')).toBeTruthy();
 await press(ui.getByText('取消失败尝试并恢复聊天'));
 expect(close).toHaveBeenCalledTimes(1);expect(done).not.toHaveBeenCalled();
 expect(isBlocked(t)).toBe(false);expect(await deletionState(t)).toBeNull();
 expect(await AsyncStorage.getItem(messageKey(t))).toBe('history');
});

test('reopened definite failure can be cancelled even if capabilities is offline',async()=>{
 const t=target(); (axios.post as jest.Mock).mockRejectedValueOnce({response:{status:403}});
 await expect(deletePermanently(t,'bad','op')).rejects.toThrow('未执行');
 (axios.get as jest.Mock).mockRejectedValueOnce(new Error('offline'));
 const close=jest.fn();const ui=render(<DeleteCharacterModal target={t} onClose={close} onComplete={jest.fn()}/>);
 await waitFor(()=>expect(ui.getByText('取消失败尝试并恢复聊天')).toBeTruthy());
 await press(ui.getByTestId('delete-cancel'));
 expect(close).toHaveBeenCalled();expect(isBlocked(t)).toBe(false);
});

test('unknown attempt followed by 403 offers only resume-later, never cancellation',async()=>{
 const t=target(); (axios.post as jest.Mock).mockRejectedValueOnce(new Error('timeout'));
 (axios.get as jest.Mock).mockRejectedValueOnce(new Error('timeout'));
 await expect(deletePermanently(t,'key','original')).rejects.toThrow('结果未知');
 (axios.get as jest.Mock).mockImplementation((url:string)=>Promise.resolve(url.endsWith('capabilities')?capabilities:{data:{status:'not_committed'}}));
 (axios.post as jest.Mock).mockRejectedValueOnce({response:{status:403}});
 const close=jest.fn();const ui=render(<DeleteCharacterModal target={t} onClose={close} onComplete={jest.fn()}/>);
 await waitFor(()=>expect(ui.getByText(/实例：test-instance/)).toBeTruthy());
 fireEvent.changeText(ui.getByTestId('delete-admin-key'),'bad');await press(ui.getByTestId('delete-confirm'));
 await waitFor(()=>expect(ui.getByText(/删除结果未知/)).toBeTruthy());
 expect(ui.queryByText('取消失败尝试并恢复聊天')).toBeNull();
 await press(ui.getByText('稍后继续'));
 expect(close).toHaveBeenCalled();expect(isBlocked(t)).toBe(true);expect((await deletionState(t))?.phase).toBe('pending');
});

test('cancelling rejected deletion refreshes the list and re-enables chat navigation',async()=>{
 await setServerUrl('https://list-recovery.test'); const t={server:SERVER_URL,user:FIXED_USER_ID,id:'Gojo'};
 (axios.post as jest.Mock).mockRejectedValueOnce({response:{status:403}});
 await expect(deletePermanently(t,'bad','op')).rejects.toThrow('未执行');
 (axios.get as jest.Mock).mockImplementation((url:string)=>Promise.resolve(url.endsWith('/characters')?{data:{characters:[{id:t.id,name:'恢复角色'}]}}:capabilities));
 const ui=render(<ChatList/>);
 await waitFor(()=>expect(ui.getByText('恢复角色')).toBeTruthy());
 await press(ui.getByText('恢复角色'));
 await waitFor(()=>expect(ui.getByText('取消失败尝试并恢复聊天')).toBeTruthy());
 await press(ui.getByText('取消失败尝试并恢复聊天'));
 await waitFor(()=>expect(ui.queryByText(/删除未执行或已回滚/)).toBeNull());
 await press(ui.getByText('恢复角色'));
 expect(mockPush).toHaveBeenCalledWith('/chat/Gojo');
});

test('long press opens edit/permanent-delete menu then the explicit confirmation',async()=>{
 await setServerUrl('https://list.test');const alert=jest.spyOn(Alert,'alert').mockImplementation(()=>{});
 (axios.get as jest.Mock).mockImplementation((url:string)=>Promise.resolve(url.endsWith('/characters')?{data:{characters:[{id:'Gojo',name:'同名角色'}]}}:capabilities));
 const ui=await render(<ChatList/>);await waitFor(()=>expect(ui.getByText('同名角色')).toBeTruthy());
 await fireEvent(ui.getByText('同名角色'),'longPress');expect(alert).toHaveBeenCalled();
 const buttons=alert.mock.calls[0][2]!;expect(buttons.map(b=>b.text)).toContain('🗑 彻底删除');
 await act(async()=>{buttons.find(b=>b.text==='🗑 彻底删除')!.onPress!();});
 await waitFor(()=>expect(ui.getByText('永久删除角色')).toBeTruthy());expect(axios.post).not.toHaveBeenCalled();alert.mockRestore();
});
