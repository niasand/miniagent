---
title: "Agent 运行时系统概览"
category: "runtime"
tags: ["runtime", "supervisor", "acp", "adapter", "session-driver", "state-machine"]
created: "2026-05-18"
updated: "2026-05-18"
sources: ["src/server/runtime/"]
coverage: "high"
status: "active"
---

MiniAgent 运行时通过 ACP（Agent Client Protocol）JSON-RPC 管理 Agent 进程的完整生命周期：启动、输入注入、文本流批处理、权限交互、上下文溢出检测、优雅退出和强制终止。

## 核心架构

```
RuntimeService（编排层）
  └── RuntimeSupervisor（进程生命周期）
        ├── RuntimeAdapterRegistry → AcpRuntimeDriver
        │     ├── AcpJsonRpcConnection（JSON-RPC 2.0 over stdio）
        │     └── AcpClientFileSystem（沙箱文件读取）
        ├── TextDeltaBatcher（文本流合并）
        ├── SessionStore（run CRUD + task 队列）
        ├── EventStore（事件追加）
        ├── MessageStore（消息持久化）
        ├── PermissionRequestStore（权限流）
        └── OutboxStore（通道投递）
```

## 状态机

### Run 生命周期

```
queued → running → succeeded
               \→ failed
               \→ cancelled
               \→ overflowed
               → waiting_permission → running
               → stopping → (kill timer 5s) → SIGTERM
```

### 状态映射

| Run 终态 | Task 状态 | Session 状态 |
|----------|----------|-------------|
| `succeeded` / `cancelled` | `succeeded` / `cancelled` | `idle` |
| `failed` | `failed` | `failed` |
| `overflowed` | `failed` | `compacting` |

## 核心模块

### RuntimeSupervisor

源文件：`src/server/runtime/supervisor.ts`

| 方法 | 功能 |
|------|------|
| `startTask(input)` | 加载 session/task → 解析 driver → 生成 runId → 创建 launchSpec → spawn 进程 → 注册到 activeRuns |
| `sendInput(runId, input)` | 向活跃 run 注入任务输入 |
| `respondPermission(runId, input)` | 解决待处理的权限提示 |
| `stop(runId)` | 优雅停止：发送 cancel → 启动 5s kill timer → 超时则 SIGTERM |
| `flush(runId)` | 强制刷新 TextDeltaBatcher |

**`startTask` 流程**：
1. 从 SessionStore 加载 session + task
2. AdapterRegistry 解析 driver
3. 生成 runId，构建 RuntimeLaunchContext
4. 处理 resume（注入 externalSessionId）
5. driver.createLaunchSpec() → SessionStore.startRun()
6. ProcessFactory.spawn() → driver.start() → 注册回调
7. 错误时：classifyError → finishRun 映射状态

### RuntimeAdapterRegistry

源文件：`src/server/runtime/registry.ts`

- 当前仅注册 `claude:acp` driver
- `listAgents()`：探测所有注册 driver 的健康状态
- `defaultRuntimeKind()`：固定返回 `"acp"`

### TextDeltaBatcher

源文件：`src/server/runtime/text-delta-batcher.ts`

- 合并小 `text_delta` 事件，减少 EventStore 写入次数
- 自动在 UTF-8 字节达到 `maxBytes`（默认 4096）时刷新
- 追踪 `firstReceivedAt` / `lastReceivedAt` 用于时序分析

## ACP 协议实现

### AcpRuntimeDriver

源文件：`src/server/runtime/acp/driver.ts`

实现 `RuntimeSessionDriver` 接口：

| 方法 | 功能 |
|------|------|
| `probe()` | 检查命令是否可执行（`command -v` + 2s 超时） |
| `createLaunchSpec()` | 构建 spawn 规范（`protocolVersion: 1`） |
| `classifyError()` | 启发式字符串匹配分类错误 |
| `start()` | 创建 AcpRunHandle → JSON-RPC initialize + session/new |

**错误分类规则**：

| 关键词 | 分类 | 可重试 |
|--------|------|--------|
| `auth/keyring/secret/token/unauthorized` | `authentication_failed` | No |
| `permission` | `permission_wait` | Yes |
| `context + overflow/limit` | `context_overflow` | Yes |
| `cancel` | `user_cancelled` | No |
| 其他 | `process_crash` | Yes |

### AcpRunHandle 内部状态机

```
constructor → bootstrap() [initialize + session/new or session/resume]
  → ready

sendInput() → queues behind promptInFlight chain
  → sendPrompt() → session/prompt
    → stopReason == "end_turn" → finish(0) + SIGTERM
    → stopReason == "cancelled" → finish(cancelled)
    → other → finish(1)
```

- 维护最后 8KB stderr 用于丰富退出信息
- 支持 `fs/read_text_file`（沙箱文件读取）和 `session/request_permission`（权限交互）

### AcpJsonRpcConnection

源文件：`src/server/runtime/acp/json-rpc.ts`

- JSON-RPC 2.0 over stdio（行分隔）
- 待处理请求追踪（Map<JsonRpcId, PendingRequest>，默认 30s 超时）
- 进程退出时 `rejectAll()` 拒绝所有待处理请求
- 非法 JSON 行 emit `runtime_event` with `invalid_jsonrpc_line`，不崩溃

### AcpClientFileSystem

源文件：`src/server/runtime/acp/client-file-system.ts`

- 实现沙箱文件读取：`WorkspacePolicy.assertAllowed(path)` 阻止越权
- `maxBytes` 限制（默认 256KB），超限则要求分页
- 内容经 `redactString()` 脱敏后返回

## 一次 Task Run 的完整数据流

```
Task queued in SessionStore
  → RuntimeService.startNextQueuedTask()
    → WorkspacePolicy 安全检查
    → Supervisor.startTask()
      → AdapterRegistry.get() → AcpRuntimeDriver
      → Driver.createLaunchSpec()
      → ProcessFactory.spawn() → ChildRuntimeProcess
      → Driver.start() → AcpRunHandle
        → AcpJsonRpcConnection (initialize + session/new)
        → 回调: emit → handleDrafts → EventStore.append()
        → 退出: handleExit() → finishRun + persistAgentMessage + enqueueRunReply
```

---

## 资源导航

| 类型 | 链接/路径 | 说明 |
|------|----------|------|
| 代码 | `src/server/runtime/types.ts` | 核心类型和接口定义 |
| 代码 | `src/server/runtime/supervisor.ts` | 进程生命周期管理 |
| 代码 | `src/server/runtime/service.ts` | 编排层 |
| 代码 | `src/server/runtime/registry.ts` | 适配器注册表 |
| 代码 | `src/server/runtime/acp/driver.ts` | ACP 协议驱动 |
| 代码 | `src/server/runtime/acp/json-rpc.ts` | JSON-RPC 连接 |
| 相关 Wiki | [overview](../architecture/overview.md) | 系统架构概览 |
| 相关 Wiki | [stores/overview](../stores/overview.md) | 数据存储层 |
