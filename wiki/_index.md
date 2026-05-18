# MiniAgent 知识库

> MiniAgent — 本地多 Agent 控制面，管理 CLI Agent 的生命周期、会话、消息投递和上下文管理。

## 分类索引

### [architecture](architecture/_index.md) — 系统架构

<!-- 文档列表（由 /add_wiki 自动维护） -->
- [系统架构概览](architecture/overview.md) — EventStore-first 的本地多 Agent 控制面
- [主流程详解](architecture/main-flows.md) — 6 条核心数据流

### [channels](channels/_index.md) — 消息通道集成

<!-- 文档列表（由 /add_wiki 自动维护） -->
- [消息通道系统概览](channels/overview.md) — 7 个平台 + Adapter 接口 + Registry

### [runtime](runtime/_index.md) — Agent 运行时

<!-- 文档列表（由 /add_wiki 自动维护） -->
- [Agent 运行时系统概览](runtime/overview.md) — Supervisor + ACP + 状态机

### [services](services/_index.md) — 业务服务层

<!-- 文档列表（由 /add_wiki 自动维护） -->
- [业务服务层概览](services/overview.md) — InboundService + WorkspaceService + HTTP API

### [stores](stores/_index.md) — 数据存储层

<!-- 文档列表（由 /add_wiki 自动维护） -->
- [数据存储层概览](stores/overview.md) — EventStore + Outbox + 15 张表

### [development](development/_index.md) — 开发与运维

<!-- 文档列表（由 /add_wiki 自动维护） -->
- [已知问题与踩坑记录](development/known-issues.md) — React/WeChat/launchd 历史问题
- [安全模块](development/security.md) — 密钥脱敏 + 工作区访问控制

### [qa](qa/_index.md) — QA 与问题追踪

<!-- 文档列表（由 /add_wiki 自动维护） -->
- [Bug 与问题追踪](qa/issue.md) — ISSUE-001 ~ ISSUE-005 历史问题
