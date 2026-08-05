# Gojo Simple

一个可自定义人设的 AI 聊天陪伴 App，从 [gojo_backend](https://github.com/unreval/gojo_backend) 精简改造而来。

**架构和完整版一致**：React Native + Expo 手机 App + FastAPI 后端。

## 相比完整版的改动

| 完整版 | Simple 版 |
|---|---|
| 五条悟 / 夏油杰 硬编码人设 | ✅ **模板化**：用户自己写 `CHARACTER_PROMPT` |
| 只支持 Claude | ✅ **Claude + DeepSeek** 双 provider，配置切换 |
| PostgreSQL | ✅ SQLite（开箱即用，无需装数据库） |
| Fish TTS 语音合成 | ❌ 删掉（专注文字聊天） |
| Groq 语音转文字 | ❌ 删掉 |
| 群聊功能 | ❌ 删掉 |
| 睡前故事模块 | ❌ 删掉 |
| 图片聊天 | ❌ 删掉 |
| 记忆系统（长期 / 短期 / 角色背景） | 保留最近 12 轮的上下文（简化版） |
| SERVER_URL 硬编码 `zeabur.app` | ✅ **App 内可配置**（首页 → ⚙️ 设置） |
| 记账用 AsyncStorage 本地存 | ✅ 走后端 API，多设备一致 |
| 无日记功能 | ✅ **新增**：日记模块 |

保留下来的：
- **11 种情绪分析**（平静/自信/嘲讽/开心/激动/温柔/认真/疑惑/调皮/悲伤/愤怒）
- 暗色蓝色主题
- Expo Router 5 tab 布局
- 完整的日程管理（分类过滤、DDL、完成状态）

## 目录结构

```
gojo_simple/
├── backend/               # FastAPI 后端
│   ├── gojo_server.py     #   入口（沿用完整版命名）
│   ├── config.py          #   配置读取（.env / config.json）
│   ├── db.py              #   SQLite 建表
│   ├── llm.py             #   双 provider 抽象
│   ├── prompt.py          #   Prompt 组装
│   ├── route_chat.py      #   /chat/*
│   ├── route_diary.py     #   /diary/*
│   ├── route_tasks.py     #   /tasks/*
│   ├── route_accounting.py#   /accounting/*
│   └── tests/             #   pytest 测试
├── app/                   # React Native / Expo 前端
│   ├── app/               #   Expo Router pages
│   │   ├── (tabs)/        #     5 个 tab
│   │   └── settings.tsx   #     设置页
│   ├── constants/theme.ts
│   ├── hooks/
│   └── components/
├── run.py                 # 后端启动器
├── requirements.txt
├── .env.example           # 配置模板 A
└── config.example.json    # 配置模板 B
```

## 快速开始

### 一、启动后端

```bash
# 1. 装依赖
pip install -r requirements.txt

# 2. 填 API key（二选一）
cp .env.example .env               # 简单场景
# 或者
cp config.example.json config.json # 多行 prompt 更好写

# 3. 启动
python run.py
```

看到 `Uvicorn running on http://0.0.0.0:8080` 就 OK。

访问 `http://localhost:8080/health` 应该返回 `{"status":"ok","provider":"claude"}`。

### 二、启动 App

```bash
cd app
npm install
npx expo start
```

用 Expo Go 扫码，或按 `a` 开 Android 模拟器 / `i` 开 iOS 模拟器。

**真机使用**：进 App 首页点右上角 ⚙️ 设置，把 `后端地址` 改成运行电脑的 LAN IP（比如 `http://192.168.1.100:8080`），点"测试连接"确认，再点"保存"。

## 配置参考

`.env` 或 `config.json` 支持这些字段：

| 字段 | 说明 | 默认值 |
|---|---|---|
| `LLM_PROVIDER` | `claude` 或 `deepseek` | `claude` |
| `ANTHROPIC_API_KEY` | Claude 的 key | 空 |
| `CLAUDE_MODEL` | Claude 模型 | `claude-sonnet-4-5-20250929` |
| `DEEPSEEK_API_KEY` | DeepSeek 的 key | 空 |
| `DEEPSEEK_MODEL` | DeepSeek 模型 | `deepseek-chat` |
| `CHARACTER_NAME` | 角色名（前端显示用） | `AI助手` |
| `CHARACTER_PROMPT` | ★ **角色人设**，任意长度 | 通用助手 |
| `CHARACTER_GREETING` | 首页展示的开场白 | 空 |
| `PORT` | 后端端口 | `8080` |

同时存在时：`config.json` 优先级高于 `.env` 高于系统环境变量。

## API 端点

| 端点 | 方法 | 说明 |
|---|---|---|
| `/health` | GET | 健康检查 |
| `/config` | GET | 前端拉取公开配置（不含密钥） |
| `/chat/text` | POST | 发消息 |
| `/chat/history` | GET / DELETE | 拉取 / 清空历史 |
| `/diary` | GET / POST | 日记列表 / 新建 |
| `/diary/{id}` | GET / PUT / DELETE | 日记详情 / 更新 / 删除 |
| `/tasks` | GET / POST | 日程列表 / 新建 |
| `/tasks/{id}` | PUT / DELETE | 更新 / 删除 |
| `/accounting` | GET / POST | 记账列表+总计 / 新建 |
| `/accounting/{id}` | DELETE | 删除记录 |
| `/accounting/stats` | GET | 分类统计 |

聊天请求 body 结构：

```json
{ "text": "你好呀", "user_id": "user_xxx" }
```

## 跑测试

```bash
python -m pytest backend/tests -v
```

覆盖：utils / LLM 分发 / 聊天路由（含错误处理与用户隔离）/ 日记 / 日程 / 记账，共 58 个用例。

## 部署提示

- **后端**：可 `uvicorn backend.gojo_server:app --host 0.0.0.0 --port 8080` 或用 gunicorn；也能像原版那样部署到 Zeabur / Railway / Render，只是把 SQLite 换成外部数据库前请自行加迁移逻辑。
- **App**：`cd app && npx eas build --platform android` 打 APK；iOS 需要 Apple 开发者账号。

## 许可证

MIT
