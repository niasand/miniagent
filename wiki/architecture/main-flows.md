---
title: "主流程详解"
category: "architecture"
tags: ["architecture", "flows", "reconnect", "crash-recovery", "handoff"]
created: "2026-05-18"
updated: "2026-05-18"
sources: ["ARCHITECTURE.md"]
coverage: "high"
status: "active"
---

MiniAgent 的 6 条核心数据流：消息处理、UI 重连、崩溃恢复、上下文溢出、Agent 切换、定时任务。

## 消息处理流程

最核心的流程——消息从通道到 Agent 再回到通道的完整路径：

```
1. ChannelAdapter 接收输入
2. Command Router 创建 Task（事务内）
3. Sessions 模块解析或创建 Session
4. RuntimeSupervisor 创建 AgentRun
5. AgentRuntimeAdapter 启动 CLI Agent 进程
6. Runtime events 批量追加到 EventStore
7. Projectors 异步消费 events（按 global_seq）
8. Projectors 产出 messages、card 视图模型、Outbox 工作
9. Delivery workers 发送更新并追加 delivery events
```

关键点：步骤 6-9 是异步的。Supervisor 不负责渲染或投递，只写事件。

## UI 重连

Web UI 断线后无状态重连：

```
1. Client 发送 last seen global_seq
2. Server 查询 EventStore 中该 session 的新事件
3. Server 返回缺失事件 + 当前 projections
4. Live stream 从最新事件继续
```

不变量：无 live UI 状态仅依赖内存。所有可显示状态都可从 EventStore 重建。

## 运行时崩溃恢复

Agent 进程异常退出时的处理：

```
1. RuntimeSupervisor 检测到进程退出或心跳超时
2. Supervisor 追加 run_failed 或 run_finished
3. Session 状态根据策略转换为 failed / idle / compacting
4. Outbox 投递失败状态
5. 用户或系统可创建 retry Task → 新 AgentRun
```

## 上下文溢出处理

Agent 上下文窗口耗尽时的 compact 流程：

```
1. ContextBudget 达到 warning/critical 阈值，或 adapter 分类为 overflow
2. Context 模块从 EventStore 范围创建 ContextPack
3. Session 进入 compacting 状态
4. RuntimeSupervisor 根据 adapter 能力停止或重启 run
5. 下一次 run 接收 ContextPack + 近期消息，而非完整历史
```

`context_budgets` 追踪的是有效注入预算（当前 ContextPack + 近期 raw events），不是总 raw EventStore 历史。Raw 历史保持 append-only，compact 后仍可查询。

## Agent 切换（Handoff）

从一个 Agent 类型切换到另一个：

```
1. 用户请求 handoff 到另一 Agent 类型
2. Context 模块确保有 ready 的 ContextPack
3. Sessions 模块创建新 target Session
4. Target Session 记录 source_session_id 和 source_context_pack_id
5. Target AgentRun 以 ContextPack + 近期消息 + workspace + open tasks 启动
6. Source Session 保持可查询
```

## 定时任务

Scheduler 驱动的周期性任务：

```
1. Scheduler 发现到期的 schedule
2. 创建带 dedupe key 的 Task
3. 如果目标 Session 有活跃 run，按策略排队/跳过/失败
4. 接受的 task 走正常 runtime 流程
```

---

## 资源导航

| 类型 | 链接/路径 | 说明 |
|------|----------|------|
| 架构文档 | `ARCHITECTURE.md` §Main Flows | 原始设计文档 |
| 相关 Wiki | [overview](overview.md) | 系统架构概览 |
| 相关 Wiki | [runtime/overview](../runtime/overview.md) | Supervisor 和 Adapter 详解 |
