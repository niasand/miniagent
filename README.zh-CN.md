# MiniAgent

> CLI Agent 的本地控制面 —— 运行、管理并将 Codex CLI、Claude Code、Trae CLI 桥接到 Web UI 和聊天渠道。

[English](./README.md)

## 它是什么

MiniAgent **不是**又一个 AI Agent。它是一个**控制面**，在统一接口背后编排现有的 CLI Agent（Codex CLI、Claude Code、Trae CLI）：

- **多会话管理** — 并行运行多个 Agent 实例，各自拥有独立的工作区和上下文。
- **流式输出** — 实时将 Markdown、工具调用、思考过程和任务状态推送到 Web UI 或聊天渠道。
- **事件溯源持久化** — 所有 Agent 输出在投递前先追加写入 append-only EventStore。崩溃或重连不丢数据。
- **聊天渠道桥接** — 通过可插拔的 Channel Adapter 将 Agent 连接到飞书、QQ、Telegram、微信、钉钉、Discord、企业微信。
- **上下文生命周期** — 自动监控上下文预算，通过 ContextPack 压缩，支持跨 Agent 移交。
- **定时任务** — 支持一次性任务和 cron 触发的 Agent 运行，带去重和并发策略。

## 架构

```
Web / 聊天渠道
  → Command Router
  → Session / Run / Task 状态机
  → RuntimeSupervisor
  → AgentRuntimeAdapter
  → EventStore（append-only）
  → Projectors → Outbox
  → Delivery → Web / 聊天渠道
```

**关键不变量：**

- Agent 输出在**展示或投递之前**先持久化。
- `events.global_seq` 是回放、重连和恢复的唯一游标。
- Projectors 和 Outbox 异步执行 —— 热路径保持轻量。
- 重试创建新的 `AgentRun`；移交创建新的 `Session`。

完整架构规范见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19、Tailwind CSS 4、Zustand、TanStack Query |
| 后端 | Hono、better-sqlite3 (WAL)、TypeScript |
| Agent 协议 | ACP（Agent Client Protocol），通过 stdio JSON-RPC |
| 构建 | Vite 8、TypeScript 6 |
| 测试 | Vitest、Playwright |
| 运行时 | Node.js ≥ 22 |

## 快速开始

### 前置条件

- Node.js ≥ 22
- 至少安装一个受支持的 CLI Agent（Codex CLI、Claude Code 或 Trae CLI）

### 安装与运行

```bash
# 安装依赖
npm install

# 运行数据库迁移（首次或 schema 变更后）
npm run db:migrate

# 启动 API 服务（端口 7273）
npm run dev:api

# 启动前端开发服务器（端口 7272）
npm run dev
```

打开 http://127.0.0.1:7272 访问 Web 控制台。

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MINIAGENT_API_PORT` | `7273` | API 服务端口 |

## 项目结构

```
src/
├── client/                  # React 前端
│   ├── api/                 # API 客户端 hooks
│   ├── components/          # UI 组件
│   │   ├── ui/              # 基础组件（Button、Badge、Tabs）
│   │   ├── app-shell.tsx    # 主布局
│   │   ├── channel-card.tsx # 渠道状态卡片
│   │   └── controls.tsx     # 会话控制
│   └── App.tsx
├── server/
│   ├── channels/            # 聊天渠道适配器
│   │   ├── feishu.ts        # 飞书
│   │   ├── qq.ts            # QQ
│   │   ├── telegram.ts      # Telegram
│   │   ├── wechat.ts        # 微信
│   │   ├── dingtalk.ts      # 钉钉
│   │   ├── discord.ts       # Discord
│   │   └── wecom.ts         # 企业微信
│   ├── db/                  # SQLite 迁移
│   ├── http/                # Hono HTTP 服务与路由
│   ├── runtime/
│   │   ├── acp/             # ACP 协议驱动 & JSON-RPC
│   │   ├── supervisor.ts    # 进程生命周期管理
│   │   ├── permission-policy.ts
│   │   └── text-delta-batcher.ts
│   ├── security/            # 工作区策略 & 密钥脱敏
│   ├── services/            # 业务逻辑
│   │   ├── context.ts       # 上下文预算 & ContextPack
│   │   ├── delivery.ts      # Outbox 投递工作器
│   │   ├── handoff.ts       # 跨 Agent 移交
│   │   ├── inbound.ts       # 命令路由
│   │   ├── knowledge.ts     # 知识管理
│   │   ├── scheduler.ts     # Cron & 一次性任务
│   │   └── workspace.ts     # 工作区管理
│   └── stores/              # SQLite 数据访问层
│       ├── event-store.ts   # Append-only 事件日志
│       ├── session-store.ts # 会话 & 运行状态
│       ├── message-store.ts # 投影消息
│       ├── outbox-store.ts  # 投递队列
│       └── ...
└── shared/                  # 共享类型与工具函数
```

## 支持的渠道

| 渠道 | 状态 |
|------|------|
| Web UI | ✅ MVP |
| 飞书 / Lark | ✅ MVP |
| QQ | 🔌 适配器就绪 |
| Telegram | 🔌 适配器就绪 |
| 微信 | 🔌 适配器就绪 |
| 钉钉 | 🔌 适配器就绪 |
| Discord | 🔌 适配器就绪 |
| 企业微信 | 🔌 适配器就绪 |

## 开发

```bash
# 运行测试
npm test

# 监听模式
npm run test:watch

# 浏览器 E2E 测试
npm run test:browser

# 类型检查
npm run typecheck

# 生产构建
npm run build
```

## 许可证

私有项目 — 未开源。
