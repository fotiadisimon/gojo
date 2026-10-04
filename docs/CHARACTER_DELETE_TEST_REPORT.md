# 角色永久删除修复：实际验收记录

日期：2026-10-04（北京时间）。目标：unreval/gojo_pub。
基线：3d8ad861767f36186c817d76f0af52120ce73d4c。
独立分支：codex/character-hard-delete。

## 追加复核修复（基于 91fb03c）

本次保留现有永久删除实现，区分明确失败与结果未知，增加失败尝试的安全取消、持久化恢复和聊天写入代次保护。没有变更数据库清理清单、鉴权要求或生产数据。

| 本次实跑检查 | 结果 |
|---|---|
| 前端 `npm test -- --silent` | **3 suites / 33 tests passed，2.949 秒** |
| PostgreSQL 16.15 全套回归 | **32 passed，73.13 秒**；仍为隔离 QEMU 内真实 PostgreSQL，逐项创建/销毁随机测试库 |
| `npm run typecheck` | 退出 2；与 `91fb03c` 已记录输出相比，同样 10 个既有错误，新增 0、移除 0 |
| Python compileall / git diff --check | 成功 |
| Expo Android/Hermes export | 成功，4.69 MB bundle；不是 APK |
| EAS preview APK | 非交互构建退出 1：未登录 Expo，未提供 EXPO_TOKEN。未创建构建任务、未产生 APK、未安装真机 |

新增覆盖：错误管理凭证；首次明确 403/关联回滚 409 后原数据保留、取消与新聊天写入；实际聊天组件重新进入、发送消息、保存回复；旧聊天请求迟到返回不覆盖恢复后的聊天；未知请求后 403/409 及 `not_committed` 不解锁；未关联 409 不允许取消；服务层跨用户重复请求合并；正在请求时不能取消；取消存储失败与取消/重试竞争；重启后明确失败可取消、未知请求及旧版 pending 持续阻断；凭证不落盘。后端补测实际锁超时回执，以及业务删除中途三种已知异常的完整事务回滚；未知异常仍为 500，不伪造确定失败证据。

修改的业务文件：`app/services/characterStorage.ts`、`app/services/characterDeletion.ts`、`app/components/DeleteCharacterModal.tsx`、`app/app/(tabs)/chat.tsx`、`app/app/chat/[id].tsx`、`backend/route_character_deletion.py`。测试：两个现有前端测试文件、新增 `app/__tests__/ChatRecovery.test.tsx`、`tests/test_character_deletion.py`。运行说明、本报告和本次 `docs/validation/*followup*` 保存结果。

仍未通过/未执行：原有 10 项 TypeScript 问题未扩展修复；没有 APK 或真机文件系统/通知/播放验收。旧版 pending 无法证明原请求确定失败，升级后不能自动解除，必须继续原操作查询／重试。全程未操作生产数据库、未修改 gojo_backend、未合并 main、未部署。本次未重新运行 npm ci（依赖与锁文件未修改，使用上一轮已安装依赖）。

以下保留初次实现的历史验收记录；最新结果以上表为准。

## 已实跑结果

| 检查 | 实际结果 |
|---|---|
| PostgreSQL 16.15 集成/并发测试 | **27 passed，40.25 秒**。真实原生 PostgreSQL，运行于隔离 QEMU/Linux 测试虚拟机；Python 通过本机端口连接。不是 SQLite、mock 数据库或单连接替代。每项创建并销毁随机测试库 |
| 前端 Jest/React Native 测试 | **2 suites，15 tests passed**；长按、取消、精确 ID、重复点击、失败/超时、重试、本地清理、切换服务器与多用户、迟到写入、通知 |
| npm ci | 成功，锁文件可安装 |
| Python compileall / git diff --check | 成功 |
| TypeScript 全量类型检查 | **未通过**：基线已有 10 条错误，最终仍为相同 10 条；本轮新增错误 0。不是宣称全仓类型检查通过 |
| Expo Android / Hermes 导出 | 成功；导出 Android bundle 及资源，不是 APK |
| EAS preview APK | 已实际尝试非交互构建，因未登录 Expo、无 EXPO_TOKEN 而停止；没有构建任务/下载链接/新 APK |
| Android 真机安装与操作 | 未执行：没有新 APK，也没有连接用户手机 |

完整测试结果、JUnit XML、前后类型检查输出及 APK 尝试输出放在 `docs/validation/`。

## 数据库覆盖

双用户、同名不同 ID、大小写不同 ID、角色全部业务表、日记评论间接关联、其他角色的 linked_fact_id 解引用、shared 用户事实、个人账本/课程/待办/日记/配置/生理期/设备 token 保留。

真实多连接验收包括：已有写入先完成后被清理、删除先取得锁后迟到写入被拒、预检表锁与等待写入不死锁、锁超时后原操作重试、并发三次删除同一回执、事务中途异常完整回滚、已运行群任务的迟到 shared 投影拒绝、后台各业务写入路径、推送与删除顺序、迟到向量回填、多进程缓存及角色名失效、删除最后角色后初始化/seed/迁移不复活。

未知表、额外列、未知外键、禁用触发器、不可辨认旧群任务和无父日记的孤立评论会中止删除，不会返回虚假的“彻底成功”。已知 legacy gojo_memory 路径也已实跑。

## 尚未验收与运行前提

- 没有操作生产数据库、没有部署、没有合并 main，也没有修改 unreval/gojo_backend。
- 需要未来在 gojo_pub 对应后端配置至少 32 字符的 CHARACTER_DELETE_ADMIN_KEY，并安装新 APK；当前用户手机实际后端地址没有读取，不能假定属于此仓库。
- 全量 TypeScript 的 10 条原有问题分布在日历/聊天 NotificationBehavior、设置页推断和模板主题文件；未扩展本轮修复范围去重写它们。
- 真机文件系统、系统通知和物理设备播放行为尚未验收；前端测试为带模拟平台适配器的组件/行为测试。
- 无归属的旧本地通知/系统闹钟、已被外部平台接收的推送、外部资源 URL 不按名称猜测清除。
- 升级时须停止旧版 worker，避免旧代码缺少来源上下文；新版本所有后台入口、数据库触发器和多进程并发已覆盖。本轮未执行生产升级。

仓库中的实现说明：`docs/CHARACTER_PERMANENT_DELETE.md`。

## 实际修改/新增文件

- `app/__tests__/DeleteCharacterModal.test.tsx`
- `app/__tests__/characterDeletion.test.ts`
- `app/__tests__/setup.ts`
- `app/app/(tabs)/chat.tsx`
- `app/app/_layout.tsx`
- `app/app/character/[id].tsx`
- `app/app/chat/[id].tsx`
- `app/components/DeleteCharacterModal.tsx`
- `app/eas.json`
- `app/jest.config.js`
- `app/package-lock.json`
- `app/package.json`
- `app/services/characterDeletion.ts`
- `app/services/characterStorage.ts`
- `backend/character_delete_guards.sql`
- `backend/character_delete_schema.json`
- `backend/character_deletion.py`
- `backend/character_lifecycle.py`
- `backend/characters.py`
- `backend/db.py`
- `backend/diary_engine.py`
- `backend/diary_scheduler.py`
- `backend/gojo_server.py`
- `backend/memory_search.py`
- `backend/proactive_scheduler.py`
- `backend/push_notify.py`
- `backend/relationship_engine.py`
- `backend/route_character.py`
- `backend/route_character_deletion.py`
- `backend/route_chat.py`
- `backend/route_image.py`
- `backend/route_memory.py`
- `backend/schedule_engine.py`
- `backend/user_memory.py`
- `docs/CHARACTER_DELETE_TEST_REPORT.md`
- `docs/CHARACTER_PERMANENT_DELETE.md`
- `docs/validation/apk-attempt.txt`
- `docs/validation/frontend-results.txt`
- `docs/validation/postgres-results.txt`
- `docs/validation/postgres-results.xml`
- `docs/validation/typecheck-baseline.txt`
- `docs/validation/typecheck-comparison.json`
- `docs/validation/typecheck-current.txt`
- `tests/conftest.py`
- `tests/requirements.txt`
- `tests/test_character_deletion.py`
- `docs/validation/android-export.txt`
