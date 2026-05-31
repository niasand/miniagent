# MiniAgent

> Local control plane for CLI agents — run, manage, and bridge Codex CLI, Claude Code, and Trae CLI to Web UI and chat channels.

[中文文档](./README.zh-CN.md)

## What It Does

MiniAgent is **not** another AI agent. It's a **control plane** that orchestrates existing CLI agents (Codex CLI, Claude Code, Trae CLI) behind a unified interface:

- **Multi-session management** — run multiple agent instances in parallel, each with its own workspace and context.
- **Streaming output** — real-time markdown, tool calls, thinking process, and task status delivered to Web UI or chat channels.
- **Event-sourced persistence** — all agent output is appended to an append-only EventStore before delivery. Nothing is lost on crash or reconnect.
- **Chat channel bridge** — connect agents to Feishu, QQ, Telegram, WeChat, DingTalk, Discord, WeCom via pluggable channel adapters.
- **Context lifecycle** — automatic context budget monitoring, compaction via ContextPack, and cross-agent handoff.
- **Scheduled tasks** — one-shot and cron-triggered agent runs with deduplication and concurrency policies.

## Architecture

```
Web / Chat Channel
  → Command Router
  → Session / Run / Task State Machine
  → RuntimeSupervisor
  → AgentRuntimeAdapter
  → EventStore (append-only)
  → Projectors → Outbox
  → Delivery → Web / Chat Channel
```

**Key invariants:**

- Agent output is stored **before** it is displayed or delivered.
- `events.global_seq` is the single cursor for replay, reconnect, and recovery.
- Projectors and Outbox are asynchronous — the hot path stays thin.
- Retrying creates a new `AgentRun`; handoff creates a new `Session`.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full specification.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Tailwind CSS 4, Zustand, TanStack Query |
| Backend | Hono, better-sqlite3 (WAL), TypeScript |
| Agent Protocol | ACP (Agent Client Protocol) via stdio JSON-RPC |
| Build | Vite 8, TypeScript 6 |
| Testing | Vitest, Playwright |
| Runtime | Node.js ≥ 22 |

## Getting Started

### Prerequisites

- Node.js ≥ 22
- At least one supported CLI agent installed (Codex CLI, Claude Code, or Trae CLI)

### Install & Run

```bash
# Install dependencies
npm install

# Run database migrations (first time or after schema changes)
npm run db:migrate

# Start the API server (port 7273)
npm run dev:api

# Start the frontend dev server (port 7272)
npm run dev
```

Open http://127.0.0.1:7272 to access the Web console.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MINIAGENT_API_PORT` | `7273` | API server port |

## Project Structure

```
src/
├── client/                  # React frontend
│   ├── api/                 # API client hooks
│   ├── components/          # UI components
│   │   ├── ui/              # Primitives (Button, Badge, Tabs)
│   │   ├── app-shell.tsx    # Main app layout
│   │   ├── channel-card.tsx # Channel status cards
│   │   └── controls.tsx     # Session controls
│   └── App.tsx
├── server/
│   ├── channels/            # Chat channel adapters
│   │   ├── feishu.ts        # Feishu/Lark
│   │   ├── qq.ts            # QQ
│   │   ├── telegram.ts      # Telegram
│   │   ├── wechat.ts        # WeChat
│   │   ├── dingtalk.ts      # DingTalk
│   │   ├── discord.ts       # Discord
│   │   └── wecom.ts         # WeCom
│   ├── db/                  # SQLite migrations
│   ├── http/                # Hono HTTP server & routes
│   ├── runtime/
│   │   ├── acp/             # ACP protocol driver & JSON-RPC
│   │   ├── supervisor.ts    # Process lifecycle management
│   │   ├── permission-policy.ts
│   │   └── text-delta-batcher.ts
│   ├── security/            # Workspace policy & secret redaction
│   ├── services/            # Business logic
│   │   ├── context.ts       # Context budget & ContextPack
│   │   ├── delivery.ts      # Outbox delivery worker
│   │   ├── handoff.ts       # Cross-agent handoff
│   │   ├── inbound.ts       # Command routing
│   │   ├── knowledge.ts     # Knowledge management
│   │   ├── scheduler.ts     # Cron & one-shot tasks
│   │   └── workspace.ts     # Workspace management
│   └── stores/              # SQLite data access layer
│       ├── event-store.ts   # Append-only event log
│       ├── session-store.ts # Session & run state
│       ├── message-store.ts # Projected messages
│       ├── outbox-store.ts  # Delivery queue
│       └── ...
└── shared/                  # Shared types & utilities
```

## Supported Channels

| Channel | Adapter | Notes |
|---------|---------|-------|
| Web UI | ✅ Built-in | SSE streaming, no extra config |
| Feishu / Lark | ✅ WebSocket | App ID + Secret |
| QQ | ✅ WebSocket | App ID + Secret |
| Telegram | ✅ Long polling | Bot Token |
| WeChat | ✅ Long polling | QR code login |
| DingTalk | ✅ Webhook | Client ID + Secret |
| Discord | ✅ WebSocket | Bot Token |
| WeCom | ✅ Webhook | Bot ID + Secret |

Channel status is reflected in real-time: **Connected** (adapter running), **Configured** (credentials saved, not started), or **Available** (needs configuration).

## Development

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Browser (E2E) tests
npm run test:browser

# Type checking
npm run typecheck

# Build for production
npm run build
```

## License

Private — not open source.
