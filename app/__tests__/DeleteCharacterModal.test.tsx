import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DeleteCharacterModal from '../components/DeleteCharacterModal';
import ChatList from '../app/(tabs)/chat';
import { setServerUrl, SERVER_URL, FIXED_USER_ID } from '../constants/theme';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
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

test('backend refusal remains visible and does not call completion',async()=>{
 const done=jest.fn();const t=target();
 (axios.post as jest.Mock).mockRejectedValue({response:{data:{detail:'永久删除需要服务器管理凭证'}}});
 (axios.get as jest.Mock).mockImplementation((url:string)=>Promise.resolve(url.endsWith('capabilities')?capabilities:{data:{status:'not_committed'}}));
 const ui=await render(<DeleteCharacterModal target={t} onClose={jest.fn()} onComplete={done}/>);
 await waitFor(()=>expect(ui.getByText(/实例：test-instance/)).toBeTruthy());
 await fireEvent.changeText(ui.getByTestId('delete-admin-key'),'bad');await fireEvent.changeText(ui.getByTestId('delete-confirm-id'),'Gojo');await press(ui.getByTestId('delete-confirm'));
 await waitFor(()=>expect(ui.getByText(/永久删除需要服务器管理凭证；/)).toBeTruthy());
 expect(done).not.toHaveBeenCalled();expect(ui.getByText('查询／重试同一删除操作')).toBeTruthy();
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
