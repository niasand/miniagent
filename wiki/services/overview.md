---
title: "业务服务层概览"
category: "services"
tags: ["services", "inbound", "workspace", "http", "api"]
created: "2026-05-18"
updated: "2026-05-18"
sources: ["src/server/services/", "src/server/http/app.ts"]
coverage: "high"
status: "active"
---

MiniAgent 服务层包含两个核心服务：InboundService 处理入站消息路由和命令解析，WorkspaceService 聚合读模型为前端提供原子化快照。HTTP 层按需实例化服务，几乎所有写操作都返回最新快照。

## InboundService

源文件：`src/server/services/inbound.ts`

入站消息处理管道——从通道消息到 Task 创建。

### 消息处理流程

```
Channel message arrives
  → receiveMessage(msg)
    → 空文本？→ ignored
    → 群消息未被 @？→ ignored
    → 斜杠命令？→ handleSlashCommand()
    → 普通消息 → handleUserMessage()
      → getOrCreateSession()（查找或创建 session）
      → workspacePolicy.assertAllowed()（安全检查）
      → SessionStore.createTask()（创建 task + event）
      → MessageStore.insert()（持久化 user message）
      → AuditLogStore.insert()（审计日志）
      → return { action: "message", session, taskId }
```

`receiveOnSession` 变体跳过 session 解析和安全检查，直接走步骤 3-5。

### 斜杠命令

| 命令 | 功能 |
|------|------|
| `/agent list` | 列出可用 Agent 类型 |
| `/agent use <type>` | 设置通道级默认 Agent |
| `/agent new [type]` | 创建新 Session |
| `/context status` | 显示上下文预算使用情况 |

### 消息去重

Tasks 使用 `dedupeKey = "${channelType}:${messageId}"` 防止重复处理（与 ChannelRegistry 的去重互补）。

### 错误处理

- Workspace policy 违规：`WorkspacePolicyError` → 调用方（app.ts）返回 403
- 无内部 try/catch——错误冒泡到 HTTP 层映射状态码

## WorkspaceService

源文件：`src/server/services/workspace.ts`

只读聚合层——从多个 Store 组装前端快照。

### Snapshot 组装流程

```
getSnapshot(selectedSessionId?)
  → SessionStore.listSessions() → 所有 session
  → 解析 selectedSessionId（fallback: 第一个 session）
  → MessageStore.getLatestBySession(sessionId, 200) → 最近 200 条消息
  → getLatestRun(sessionId) → raw SQL 查询 agent_runs
    → EventStore.listAfterGlobalSeq() → text_delta 事件
    → 汇总 tokenEstimate → tokensUsed
    → 计算 duration
  → ContextBudgetStore.get(sessionId) → 上下文预算
  → supervisor.getActiveRunBySession() → 活跃 run 状态
  → return WorkspaceSnapshot
```

### WorkspaceSnapshot 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `selectedSessionId` | `string` | 当前选中的 session |
| `sessions` | `WorkspaceSessionSummary[]` | 所有 session 列表 |
| `messages` | `WorkspaceMessage[]` | 最近 200 条消息（role 映射：assistant→agent） |
| `runStats` | `object` | 最近 run 的时长和 token 用量 |
| `contextBudget` | `WorkspaceContextBudget` | 预算健康度（healthy/warning/critical/overflow） |
| `runtime` | `WorkspaceRuntimeSummary` | 活跃 run 状态（status, pid, runId） |

### 错误处理

无显式错误处理——设计为只读聚合。缺失数据通过 null-coalescing 优雅降级。

## HTTP 路由

源文件：`src/server/http/app.ts`

服务按需实例化（非单例注入）：

```typescript
const inbound = new InboundService(db, "web", { workspacePolicy });
const workspaceService = new WorkspaceService(db, runtimeSupervisor);
```

### 核心 API

| 路由 | 方法 | 用途 |
|------|------|------|
| `GET /api/workspace` | GET | WorkspaceService.getSnapshot() |
| `GET /api/events/stream` | GET | SSE 实时事件流（500ms 轮询 EventStore） |
| `POST /api/sessions` | POST | 创建 session（workspace policy 验证） |
| `POST /api/sessions/:sessionId/messages` | POST | InboundService → RuntimeService.startNextQueuedTask() |
| `POST /api/sessions/:sessionId/handoffs` | POST | Agent 类型切换 |
| `POST /api/runs/:runId/stop` | POST | 停止运行中的 task |
| `GET /api/agents` | GET | 探测 Agent 可用性 |
| `GET /api/skills` | GET | 扫描 `.claude/skills/` 获取 skill 元数据 |
| `GET /api/channels` | GET | 列出通道配置 |
| `PUT /api/channels/:channelId/config` | PUT | 配置 + 自动启动通道 |
| `POST /api/webhooks/dingtalk` | POST | DingTalk webhook 入口 |
| `GET/POST /api/schedules/*` | — | 定时任务 CRUD |

**关键设计**：几乎所有写操作都返回 `workspaceService.getSnapshot()`，前端可以原子更新状态。

### 错误映射

| 错误 | HTTP 状态码 |
|------|------------|
| 缺少字段 / 无效参数 | 400 |
| `WorkspacePolicyError` | 403 |
| `"Session not found"` | 404 |
| `"active run"` / `"No queued task"` | 409 |
| 其他 | 500 |

---

## 资源导航

| 类型 | 链接/路径 | 说明 |
|------|----------|------|
| 代码 | `src/server/services/inbound.ts` | InboundService |
| 代码 | `src/server/services/workspace.ts` | WorkspaceService |
| 代码 | `src/server/http/app.ts` | HTTP 路由定义 |
| 相关 Wiki | [overview](../architecture/overview.md) | 系统架构概览 |
| 相关 Wiki | [stores/overview](../stores/overview.md) | 数据存储层 |
