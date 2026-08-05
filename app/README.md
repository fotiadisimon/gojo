# Gojo Simple - App

React Native + Expo Router 前端。

## 启动

```bash
npm install
npx expo start
```

在弹出的 dev server 面板里：
- 按 `a` → Android 模拟器
- 按 `i` → iOS 模拟器（macOS 上）
- 按 `w` → 浏览器
- 用 Expo Go App 扫二维码 → 真机

## 配置后端地址

App 启动后，进首页 → 右上角 ⚙️ → **后端地址** 那栏：

| 场景 | 填的地址 |
|---|---|
| Android 模拟器 + 后端跑在本机 | `http://10.0.2.2:8080`（默认） |
| iOS 模拟器 + 后端跑在本机 | `http://localhost:8080`（默认） |
| Expo Go 真机 + 后端跑在电脑 | `http://<电脑局域网 IP>:8080` |
| 用了公网部署 | `https://your-domain.com` |

点"测试连接"确认，再点"保存"。地址保存在本机 AsyncStorage，下次启动 App 自动记住。

## 目录

```
app/
├── (tabs)/
│   ├── _layout.tsx     # tab 布局
│   ├── index.tsx       # 首页
│   ├── chat.tsx        # 聊天
│   ├── diary.tsx       # 日记（新）
│   ├── calendar.tsx    # 日程
│   └── accounting.tsx  # 记账
├── settings.tsx        # 设置（改后端地址）
└── _layout.tsx         # 根 stack
```

其他目录：
- `constants/theme.ts` — 颜色、11 种情绪配色、分类常量
- `hooks/useServerConfig.ts` — SERVER_URL / USER_ID 的读写 hook
- `components/EmotionTag.tsx` — 情绪 pill 组件

## 打 APK

```bash
npx eas login
npx eas build --platform android --profile preview
```

Expo 会在云端构建，构建完给你一个下载链接。

真机安装后第一次打开，**必须**先进设置页填后端地址，否则 App 连不上。
