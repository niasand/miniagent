---
title: "数据存储层概览"
category: "stores"
tags: ["stores", "event-store", "outbox", "session", "message", "sqlite", "migration"]
created: "2026-05-18"
updated: "2026-05-18"
sources: ["src/server/stores/", "src/server/db/"]
coverage: "high"
status: "active"
---

MiniAgent 使用 SQLite（WAL 模式）作为唯一数据存储，采用 Event Sourcing + Transactional Outbox 模式。`events` 表是真相来源，`messages` 是反规范化的读模型，`outbox` 保证外部投递的可靠性。

## 数据库层

源文件：`src/server/db/migrate.ts`

| 配置 | 值 |
|------|-----|
| 默认路径 | `data/miniagent.sqlite`（可通过 `MINIAGENT_DB_PATH` 覆盖） |
| journal_mode | WAL |
| synchronous | NORMAL |
| busy_timeout | 5000ms |
| foreign_keys | ON（运行时）/ OFF（migration 中） |

Migration 策略：按文件名排序执行 `.sql`，`schema_migrations` 表追踪已执行版本，每条 migration 在事务中运行。

## 数据库 Schema（15 张表）

### 核心表

| 表 | 用途 |
|----|------|
| `events` | Append-only 事件流（真相来源） |
| `messages` | 反规范化读模型（聊天消息视图） |
| `outbox` | 事务性投递队列 |
| `sessions` | 会话（长期存活） |
| `tasks` | 任务（一次触发源） |
| `agent_runs` | Agent 执行实例 |

### 配置表

| 表 | 用途 |
|----|------|
| `channel_configs` | 通道配置 KV 存储 |
| `agent_defaults` | 分级 Agent 配置 |
| `schedules` | Cron 和一次性定时任务 |

### 辅助表

| 表 | 用途 |
|----|------|
| `audit_logs` | 审计日志 |
| `permission_requests` | ACP 权限交互 |
| `context_budgets` | Token 预算追踪 |
| `context_packs` | 压缩上下文快照 |
| `memory_archives` | 长期记忆存储 |
| `operation_confirmations` | 危险操作二次确认 |

### Migration 历史

| 版本 | 内容 |
|------|------|
| `0001_initial.sql` | 创建完整 schema（14 张表） |
| `0002_extend_channel_types.sql` | sessions/audit_logs/outbox 加 wechat/wecom/dingtalk |
| `0003_extend_source_type.sql` | tasks 加 wechat/wecom/dingtalk |

## EventStore

源文件：`src/server/stores/event-store.ts`

`events` 表是系统核心——所有 Agent 输出、状态变更、投递结果都以 append-only 事件记录。

| 列 | 类型 | 说明 |
|----|------|------|
| `global_seq` | INTEGER PK AUTO | 单调递增全局序号，游标基础 |
| `id` | TEXT UNIQUE | `evt_` 前缀 |
| `session_id` | TEXT NOT NULL | Session 作用域 |
| `run_id` | TEXT nullable | Run 作用域 |
| `task_id` | TEXT nullable | Task 作用域 |
| `run_seq` | INTEGER nullable | Run 内序号（run_id 内唯一） |
| `type` | TEXT NOT NULL | 事件类型 |
| `payload_json` | TEXT | JSON 载荷（**写入前 redactJson() 脱敏**） |
| `schema_version` | INTEGER | Schema 版本 |
| `causation_id` | TEXT nullable | 因果追踪 |
| `correlation_id` | TEXT nullable | 关联追踪 |
| `created_at` | TEXT | ISO 时间戳 |

索引：`(session_id, global_seq)`、`(run_id, run_seq)` UNIQUE、`(type, global_seq)`

| 方法 | 功能 |
|------|------|
| `append(input)` | 单条插入，自动分配 runSeq |
| `appendBatch(inputs)` | 批量事务插入 |
| `listAfterGlobalSeq(opts)` | 游标重放（支持全局或按 session 过滤） |
| `listByRun(runId, type?)` | 按 run 查询事件 |

## MessageStore

源文件：`src/server/stores/message-store.ts`

反规范化读模型——每条消息通过 `source_event_id` 关联回产生它的 EventStore 事件。独立于 events 表，用于查询性能。

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | TEXT PK | `msg_` 前缀 |
| `session_id` | TEXT | Session 作用域 |
| `run_id` | TEXT nullable | 产出该消息的 run |
| `role` | TEXT | `user` / `assistant` / `system` / `tool` |
| `content` | TEXT | 消息内容 |
| `source_event_id` | TEXT NOT NULL | 追溯到源事件 |

| 方法 | 功能 |
|------|------|
| `insert(input)` | 插入消息 |
| `listBySession(sessionId)` | 按 session 查询（oldest first） |
| `getLatestBySession(sessionId)` | 最近 N 条 |

## OutboxStore

源文件：`src/server/stores/outbox-store.ts`

实现 **Transactional Outbox 模式**——外部投递与事件写入在同一事务中，保证 at-least-once 投递。

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | TEXT PK | `out_` 前缀 |
| `idempotency_key` | TEXT UNIQUE | 幂等保证（ON CONFLICT DO NOTHING） |
| `status` | TEXT | `pending` → `sending` → `sent` / `failed` / `dead` |
| `attempts` | INTEGER | 重试次数 |
| `max_attempts` | INTEGER | 默认 5 次 |
| `next_attempt_at` | TEXT | 指数退避调度 |
| `locked_by` | TEXT | Worker 锁 |
| `lease_expires_at` | TEXT | 30s 租约 |
| `last_error` | TEXT | 截断到 500 字符 |

常量：`CLAIM_LEASE_MS = 30_000`、`BACKOFF_BASE_MS = 2_000`

| 方法 | 功能 |
|------|------|
| `enqueue(input)` | 插入（幂等：重复 key 静默忽略） |
| `claimDue(opts)` | Worker 抢占待处理项（可选按 channelType 过滤） |
| `markSent(id)` | 标记投递成功 |
| `markFailed(id, error)` | 增加重试，超限则 dead；否则指数退避调度下次 |

## SessionStore

源文件：`src/server/stores/session-store.ts`

最大的 store，管理 Session → Task → Run 三层状态机。

### Session 状态

`idle` → `running` → `idle` / `failed` / `compacting` → `archived`

### Task 状态

`scheduled` → `queued` → `running` → `succeeded` / `failed` / `cancelled` / `paused`

### Run 状态

`queued` → `running` → `succeeded` / `failed` / `cancelled` / `overflowed`

中间态：`waiting_permission`、`stopping`

### 关键方法

| 方法 | 功能 |
|------|------|
| `createSession(input)` | 创建 session（status=idle） |
| `createTask(input)` | **事务**：插入 task + 追加 `task_created` 事件 |
| `startRun(input)` | **复杂事务**：验证状态 → 插入 run → 追加 `run_started` 事件 → 更新 session/task 状态 |
| `finishRun(input)` | **复杂事务**：追加 `run_finished`/`run_failed` 事件 → 更新 run/task/session 状态 |
| `getNextQueuedTask(sessionId)` | FIFO 出队 |
| `getSessionIdsWithQueuedTasks(channelType?)` | 查找有排队任务且无活跃 run 的 session |

### SourceType（任务来源）

`web` | `feishu` | `qq` | `telegram` | `discord` | `wechat` | `wecom` | `dingtalk` | `cron` | `handoff` | `mcp` | `system`

### TaskType（任务类型）

`message` | `compact` | `handoff` | `schedule_run` | `stop` | `resume`

## ChannelConfigStore

源文件：`src/server/stores/channel-config-store.ts`

KV 存储，每个通道的配置（app_id、bot_token 等）。

| 方法 | 功能 |
|------|------|
| `get(channelId)` | 获取通道所有配置 |
| `set(channelId, config)` | 批量 upsert |
| `isConfigured(channelId)` | 检查必需配置是否完整 |
| `listChannels()` | 列出所有已知通道及配置状态 |

## 架构模式

| 模式 | 体现 |
|------|------|
| Event Sourcing | `events` 表是真相来源，`global_seq` 提供全序 |
| CQRS-lite | `messages` 是从 events 投影的读模型（`source_event_id` 关联） |
| Transactional Outbox | `outbox` 与事件同事务写入，Worker 抢占 + 租约 + 指数退避 |
| 无外键 | 所有表用 TEXT ID，无 FK 约束（SQLite ALTER TABLE 限制的权衡） |
| ID 前缀 | `evt_`、`msg_`、`ses_`、`tsk_`、`run_`、`out_`、`cnf_` |
| 安全 | EventStore 写入前 `redactJson()` 脱敏，Outbox 错误截断 500 字符 |

---

## 资源导航

| 类型 | 链接/路径 | 说明 |
|------|----------|------|
| 代码 | `src/server/db/migrate.ts` | 数据库初始化和 migration |
| 代码 | `src/server/stores/event-store.ts` | EventStore |
| 代码 | `src/server/stores/outbox-store.ts` | Outbox |
| 代码 | `src/server/stores/session-store.ts` | Session/Task/Run 管理 |
| 代码 | `src/server/stores/message-store.ts` | Message 读模型 |
| 代码 | `src/server/stores/channel-config-store.ts` | 通道配置 |
| 相关 Wiki | [overview](../architecture/overview.md) | 系统架构概览 |
| 相关 Wiki | [runtime/overview](../runtime/overview.md) | Agent 运行时 |
