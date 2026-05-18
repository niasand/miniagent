---
title: "MiniAgent 系统架构概览"
category: "architecture"
tags: ["architecture", "event-sourcing", "outbox", "overview"]
created: "2026-05-18"
updated: "2026-05-18"
sources: ["ARCHITECTURE.md"]
coverage: "high"
status: "active"
---

MiniAgent 是本地多 Agent 控制面，管理 CLI Agent 的生命周期、会话、消息投递和上下文。核心原则是 EventStore-first：所有输出先存储，再投递。

## 概述

MiniAgent 接收来自 Web UI 和消息通道（Feishu、WeChat、Discord 等）的指令，路由到 Session/Run/Task 状态机，由 RuntimeSupervisor 启动 Agent 进程，产出事件写入 EventStore，经 Projector 生成读模型，通过 Outbox 投递回各通道。

## 核心架构

```
Web / Feishu / WeChat / ...
  → Command Router（解析指令、创建 Task）
  → Sessions（Session / Run / Task 状态机）
  → RuntimeSupervisor（进程生命周期）
  → AgentRuntimeAdapter（Codex / Claude / Trae）
  → EventStore（append-only 事件流）
  → Projectors（异步生成读模型 + Outbox 工作）
  → Outbox（幂等投递）
  → Delivery（Web SSE / Feishu Card / ...）
```

## 架构原则

| 原则 | 说明 |
|------|------|
| EventStore first | 所有 Agent 输出、状态变更、投递结果都是 append-only 事件 |
| Replay by cursor | `events.global_seq` 是 Projectors、Web 重连、恢复的游标 |
| Outbox for side effects | Web 推送和 Feishu 卡片更新走队列，重试幂等 |
| Supervisor over adapters | RuntimeSupervisor 拥有进程生命周期；adapters 只翻译 CLI 行为 |
| Hot path stays thin | Supervisor 只追加批量 runtime events；Projectors 异步工作 |
| Session / Run / Task 分离 | Session 长期存活，AgentRun 是一次进程执行，Task 是一次触发源 |
| Renderer ≠ Delivery | Renderer 创建视图模型；Delivery 与外部平台通信 |
| ContextPack 是唯一可移植上下文 | compact、resume、handoff 都用 ContextPack |
| Security is local but explicit | workspace 白名单、审计日志、密钥脱敏、危险操作确认 |

## 核心模块职责

| 模块 | 职责 | 源文件 |
|------|------|--------|
| Command Router | 解析指令、默认 Agent 解析、幂等 Task 创建 | `src/server/http/app.ts` |
| Sessions | Session/Run/Task 状态机、并发控制 | `src/server/stores/session-store.ts` |
| Runtime | 进程启停、stdin/stdout、心跳超时、事件批量写入 | `src/server/runtime/supervisor.ts` |
| Events | EventStore、Outbox、Projectors、重放 | `src/server/stores/event-store.ts` |
| Context | 上下文预算、ContextPack 生成、compact/handoff | ARCHITECTURE.md §Context |
| Security | workspace 白名单、密钥脱敏、审计日志 | `src/server/security/` |
| Channels | 7 个消息平台的 adapter | `src/server/channels/` |

## 关键不变量

- 非 archived Session 有且仅有一个固定 Agent 类型
- MVP 每个 Session 最多一个活跃 AgentRun
- 重试创建新 AgentRun，不修改旧的
- Handoff 创建新 Session
- Agent 输出先写入 EventStore 再投递
- `events.global_seq` 单调递增，永不重用
- Outbox 投递幂等
- Projected messages 可从 EventStore 重建
- Delivery 失败不修改源事件

## 数据所有权

| 模块 | 拥有 |
|------|------|
| EventStore | 历史事实 |
| Sessions | 当前状态和活跃 run 指针 |
| Outbox | 待投递工作 |
| Projectors | 可重建的读模型 |
| Context | ContextPack 生成和上下文状态 |
| Runtime | 仅在 run 活跃期间拥有进程生命周期 |
| Security | 策略决策和审计日志 |

---

## 资源导航

| 类型 | 链接/路径 | 说明 |
|------|----------|------|
| 架构文档 | `ARCHITECTURE.md` | 完整架构设计文档 |
| 相关 Wiki | [main-flows](main-flows.md) | 主流程详解 |
| 相关 Wiki | [channels/overview](../channels/overview.md) | 消息通道系统 |
| 相关 Wiki | [runtime/overview](../runtime/overview.md) | Agent 运行时 |
| 相关 Wiki | [stores/overview](../stores/overview.md) | 数据存储层 |
