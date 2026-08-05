# 部署指南

## 一、推上 GitHub

### 1. 装 Git（如果没装）
Windows：https://git-scm.com/download/win
Mac：`brew install git` 或系统自带
Linux：`sudo apt install git`

### 2. 在 GitHub 建仓库
登录 GitHub → 右上角 ➕ → New repository → 起个名字（比如 `gojo-simple`）→ **Private 或 Public 看你**（有 API key 建议 Private）→ **不要**勾选 "Initialize with README"（我们本地已有）→ Create。

### 3. 本地初始化 + 推上去
在 `gojo_simple/` 根目录打开命令行：

```bash
# 1. 初始化仓库
git init
git branch -M main

# 2. 首次前先确认 .gitignore 生效（会自动忽略 .env、config.json、data.db）
git status
# 检查列表里绝对不能有 .env、config.json、data.db —— 有的话说明泄露了

# 3. 提交
git add .
git commit -m "初始化 Gojo Simple"

# 4. 关联远程仓库（换成你自己的 URL）
git remote add origin https://github.com/你的用户名/gojo-simple.git

# 5. 推
git push -u origin main
```

第一次推会弹窗要 GitHub 账号密码。**密码要用 Personal Access Token**（不是登录密码）：
- GitHub → 右上角头像 → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token → 勾 `repo` 权限 → Generate → 复制那串 `ghp_xxxx`
- 弹窗时用户名填 GitHub 用户名，密码粘贴这串 token

### 之后每次改代码

```bash
git add .
git commit -m "改了 xxx"
git push
```

---

## 二、部署后端到 Zeabur

### 1. 准备
- GitHub 仓库已经推上去（见上面）
- 有 Zeabur 账号（https://zeabur.com/，用 GitHub 登录方便）

### 2. 创建服务
Zeabur Dashboard → 你的项目 → 添加服务 → **Git** → 选你的 `gojo-simple` 仓库。

Zeabur 会自动检测到根目录的 `zbpack.json` 或 `Procfile`，用 Python 环境构建。

### 3. 配环境变量
选中刚创建的服务 → 环境变量（Variables）→ 一条条加：

| Key | Value |
|---|---|
| `LLM_PROVIDER` | `claude` 或 `deepseek` |
| `ANTHROPIC_API_KEY` | 你的 Claude key |
| `CLAUDE_MODEL` | `claude-sonnet-4-5-20250929` |
| `DEEPSEEK_API_KEY` | 可选 |
| `FISH_KEY` | Fish Audio 的 key（要用 TTS 才需要）|
| `FISH_VOICE_ID` | Fish 的默认音色 id |
| `CHARACTER_NAME` | 默认角色名字 |
| `CHARACTER_PROMPT` | 默认角色人设（多行也没关系） |
| `CHARACTER_GREETING` | 默认开场白 |
| `PORT` | Zeabur 会自动注入，可以不填 |

**关键：数据持久化**

SQLite 数据库文件 `data.db` 默认存在容器里，容器重启会丢。所以：

- **服务里 → 存储（Volumes）→ 添加卷 → 挂载到 `/data`**（大小选 1GB 够用了）
- 环境变量再加一条：`DB_PATH` = `/data/gojo.db`

这样重启不丢数据。

### 4. 生成域名
服务 → 网络 → 添加域名 → Zeabur 会给你一个免费的 `xxx.zeabur.app` 域名。

访问 `https://xxx.zeabur.app/health`，应该返回 `{"status":"ok","provider":"claude"}`。

### 5. App 里接上
打开 App → 首页 ⚙️ → 后端地址填 `https://xxx.zeabur.app`（不要末尾斜杠）→ 测试连接 → 保存。

---

## 三、日常开发（本机调试）

### 本地跑后端

```bash
# 项目根目录
cp config.example.json config.json   # 或 cp .env.example .env
# 编辑填 API key
python run.py
```

### 本地跑 App

```bash
cd app
npm install
npx expo start
```

按 `a` 开 Android 模拟器、按 `i` 开 iOS 模拟器、扫二维码用 Expo Go 真机预览。

**Android 模拟器 → 本机后端**：默认已配好用 `10.0.2.2:8080`
**iOS 模拟器 → 本机后端**：默认用 `localhost:8080`
**真机 → 本机后端**：进 App 设置页把地址改成你电脑的局域网 IP（`192.168.x.x`），电脑和手机得在同一 WiFi

### 本地 + Zeabur 同时用

在 App 设置页填 Zeabur 的地址 `https://xxx.zeabur.app`，就能用云端后端；改回 `http://10.0.2.2:8080` 就切回本地。**地址保存在手机的 AsyncStorage，重启不丢。**

---

## 四、打 APK 装真机

```bash
cd app
npx eas login                                 # 首次登录 Expo 账号
npx eas build --platform android --profile preview
```

Expo 会在云端构建，构建完给你一个下载链接的 APK。装到手机上后进设置页填后端地址就能用了。

想打 iOS 需要 Apple Developer 账号（$99/年），命令 `--platform ios`。

---

## 五、常见坑

**Zeabur 部署失败提示"找不到 anthropic"？**
`requirements.txt` 没上传？检查根目录有没有这个文件，`git status` 确认已提交推上去了。

**Zeabur 上 App 连不上？**
浏览器打开 `https://xxx.zeabur.app/health` 试试；能开就是 App 那边地址填错了或者末尾多了斜杠。

**改了 .env，跑没生效？**
后端启动时才读一次，改完要重启。Zeabur 上改环境变量后手动 Restart 服务。

**推上 GitHub 前发现 .env 已经被 commit 了怎么办？**
```bash
git rm --cached .env
git commit -m "remove env"
git push
```
但历史里仍然有！GitHub 上的历史泄露的 key **必须立刻去 Anthropic / Fish 后台把那个 key revoke，重新生成一个**。

**打 APK 时报错 expo-image-picker 版本不对？**
`cd app && npx expo install --fix` 会自动修正版本号。
