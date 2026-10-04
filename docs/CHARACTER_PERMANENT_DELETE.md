# 角色永久删除：实现与运行说明

仅适用于 `unreval/gojo_pub`。角色表没有 user_id，因此删除的范围是**本服务器所有用户与精确角色 ID 关联的数据**。接口需要服务端管理凭证。旧单数、复数 DELETE 接口返回 409 升级提示，不会在旧“保留聊天”提示下执行永久删除。

## 操作

新 APK：消息页长按角色 → 彻底删除 → 核对头像、名称、区分大小写的 ID、实际服务器地址 → 输入管理凭证与精确 ID → 确认永久删除。服务端成功后清理本机聊天、音频、未读、角色主动提醒状态及可归属的本地通知。取消确认不会删除数据。

进行中的操作禁用重复点击；服务层还合并同一服务器/角色的并发调用。网络结果未知时保留列表和数据，并暂停此角色本机写入；“查询／重试”使用原 operation_id。服务器已经删除而本机磁盘清理失败时，显示“服务器已删除，本机清理待重试”。操作记录只保存服务器、用户、角色 ID、操作 UUID、阶段和此前请求是否未知的标记，不保存管理凭证或角色正文。重启后仍能继续。

### 明确失败与结果未知

| 证据 | 本机状态与可用操作 |
|---|---|
| 首次 POST 返回 403，且没有此前未知请求 | `failed`；保留全部原数据，可“取消失败尝试并恢复聊天”，也可改凭证重试 |
| POST 返回 409，`detail.code=character_delete_rolled_back` 且操作 UUID、精确角色 ID 均匹配，没有此前未知请求 | `failed`；同上。后端仅在已退出并回滚事务的已知异常路径签发此回执 |
| 超时、断网、未关联的 409、错误或不匹配的成功回执 | `pending`；不能取消，只能查询／重试 |
| 此前存在未知请求，后来重试得到 403/明确回滚 409，或查询为 `not_committed` | 仍为 `pending`；后一次失败和当前没有回执，不能证明较早请求不会迟到提交 |
| 已有成功回执 | `server_deleted` → 本机清理 → `complete`；不可取消 |

每次请求发出前先持久化 `pending`。重启时所有 `pending`（包括旧版没有新标记的记录）都按结果未知处理，不根据后来的一次失败解除阻断。已经持久化的 `failed` 重启后仍可取消；能力查询断网也不影响这种本机取消。取消只移除失败操作记录，持久化移除成功后才解除阻断，不清聊天、音频或缓存。旧后端仅返回文本的 409 缺少明确回滚证据，继续保守处理。

聊天页在挂载时捕获写入代次。开始删除及安全取消都会使旧代次失效，因此重新进入聊天后可以发送和保存新消息，删除前未返回的旧请求仍不能落盘或覆盖新记录。

## 服务端配置和启动

1. 由部署管理员为 **gojo_pub 对应后端**设置环境变量 `CHARACTER_DELETE_ADMIN_KEY`，使用随机、至少 32 字符的密钥；不写入源码、APK、URL 或 settings 表。
2. 使用 HTTPS；App 每次操作输入凭证，仅在当次页面内存中使用。`GET /character-deletion/capabilities` 返回协议标记、持久服务器实例 UUID 和“是否已配置”，不返回密钥。**仓库名不能证明 App 当前连接的是哪套部署**，本次没有读取用户手机设置或访问生产后端。
3. 未来部署本分支时，先停止旧版 Web/后台 worker，再启动统一的新版本。不得让缺少来源上下文的旧 worker 与新版本混跑。应用启动在所有后台线程启动前安装数据库防护；安装失败则启动失败。数据库账号须能创建表、函数与触发器。
4. 当前工作只交付独立分支；没有执行这些生产步骤。

## 删除范围和保留范围

| 类别 | 行为 |
|---|---|
| characters、character_memory、short_memory、long_memory、bond_memory | 精确角色 ID 删除；行内向量同步删除 |
| char_schedule、char_diary、diary_visit、diary_book | 删除角色日程、日记、访问记录和角色日记本；保留 owner=user |
| char_diary_comment | 先通过 diary_id 查角色日记，再清评论 |
| proactive_promise、proactive_msg | 清除承诺和待发/已存主动消息载荷 |
| 7 张 rel_* 表 | 清除角色关系状态、来源记录、边界、修复和互动统计 |
| memory_jobs | 删除完整任务行及正文、错误载荷；含该角色的已知格式群任务整体移除，其他群任务保留 |
| 其他角色指向被删 long_memory 的 linked_fact_id | 只解除引用，不删其他角色正文 |
| legacy gojo_memory | 存在且结构匹配时，仅删除 exact ID=gojo 所拥有的旧表数据；表保留 |
| shared 用户事实 | 保留；没有可靠旧来源时不按人名推断归属 |
| 用户个人资料、日记、统计、settings、账本、课程、待办、生理期和 push_token | 保留 |
| character_tombstones | 仅保留 ID、操作 UUID、删除时间和按表计数，防止 seed/迁移/旧 ID 重建复活 |

`character_delete_schema.json` 是经过本仓库建表、迁移源码核对的清单。未知表、额外列、未知外键/触发器、缺少写入防护及无法识别的旧群任务会阻止删除、回滚事务。不会跳过异常后宣称“全部删除”。扩展 schema 时须先审查归属和引用，再更新清单与测试。

## 并发与迟到结果

PostgreSQL 事务级共享/独占 advisory lock 协调所有进程；业务写入通过 BEFORE STATEMENT 触发器先取共享锁，删除先取独占锁，再按固定顺序取兼容的表锁。角色行触发器校验删除标记及间接引用。使用 READ COMMITTED；不依赖单进程 Python 锁。

`character_work` 在私聊、群任务、日记、日程、主动消息及关系线程入口记录来源角色，`get_conn()` 把来源传入 PostgreSQL。即使目标行是 shared 或另一角色，删除后的来源任务仍不能写回。等待 LLM 期间不持有数据库锁。

推送在实际发送期间持有共享锁：删除完成后不能开始新推送；已被外部推送平台接收的通知无法撤回。删除锁等待默认 5 秒，超时事务回滚，允许同一操作重试。向量缓存和角色名缓存读前核对数据库删除纪元；另一进程删除也能使旧缓存失效。向量 UPDATE 影响 0 行时不会把删除 ID 塞回缓存。

## 本机旧数据边界

新聊天、未读、主动提醒和音频按服务器 URL、用户 ID、精确角色 ID 隔离。永久删除会按精确服务器/角色组合清理本机所有已缓存用户的该角色数据，并跨用户拦截迟到写回。首次升级为无归属旧键记录一次当时的服务器/用户；之后切换服务器不会认领或清除旧服务器数据。旧版若已经在多服务器间混用同一个未分区键，其历史归属不能可靠重建，这种信息损失不能凭角色名恢复。

旧 `gojo_proactive_state` 源码是 taskId_date → flags，只有 exact ID=gojo 写入，因此仅该角色所属旧数据可清理。不会 AsyncStorage.clear()。个人待办通知保留；无角色归属的历史通知、系统闹钟、远端平台已经接受的推送不按标题猜测删除。后端头像存于角色行，外部 URL 指向的资源不删除。用户相册媒体和个人记录保留。

本机所有角色磁盘写入与删除使用同一串行队列；先同步设置删除标记，再等待已开始的写入结束，再清理。页面卸载后的旧回复也经过此入口，不能重新落盘。页面内存、草稿、播放与后续主动轮询同时失效。

## 测试命令

准备独立可销毁的 PostgreSQL 16 实例，然后：

```bash
pip install -r requirements.txt -r tests/requirements.txt
TEST_POSTGRES_ADMIN_DSN='host=127.0.0.1 port=55432 user=postgres dbname=postgres' python -m pytest tests -q
cd app
npm ci
npm test
npm run typecheck
npx expo export --platform android
npx eas-cli@latest build -p android --profile preview --non-interactive
```

测试只接受显式的回环测试 DSN，自己创建随机 `gojo_delete_test_*` 数据库，并在结束后销毁；**不回退读取生产 DATABASE_URL**。测试未导入/启动生产 server，未启动后台调度，未调用付费模型。

`preview.android.buildType=apk` 已明确设置。Hermes 导出不等于 APK 构建、安装或真机验收；旧 APK 不能靠更新后端获得新的永久删除交互。
