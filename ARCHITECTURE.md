# MiniAgent Architecture

## 1. Architecture Goal

MiniAgent is a local control plane for CLI agents. It must survive Agent process crashes, UI reconnects, Feishu delivery failures, context overflow, cron retries, and handoff between Agent types.

The core architecture is:

```text
Web / Feishu
  -> Command Router
  -> Session / Run / Task State Machine
  -> RuntimeSupervisor
  -> AgentRuntimeAdapter
  -> EventStore
  -> Projectors
  -> Outbox
  -> Delivery
  -> Web / Feishu
```

The important rule: runtime output is stored before it is displayed or delivered.

## 2. Architectural Principles

- EventStore first: all Agent output, state changes, delivery results, compact events, and handoff events are append-only events.
- Outbox for side effects: Web pushes and Feishu card updates are queued, retried, and idempotent.
- Supervisor over adapters: RuntimeSupervisor owns process lifecycle; adapters only translate CLI-specific behavior.
- Session, Run, and Task stay separate: a Session is long-lived, an AgentRun is one process execution, and a Task is one trigger source.
- Renderer and Delivery stay separate: Renderer creates view models; Delivery talks to external platforms.
- ContextPack is the only portable context unit for compact, resume, and handoff.
- Security is local but explicit: workspace allowlists, audit logs, secret redaction, and dangerous-operation confirmation are architecture concerns.

## 3. Core Modules

### Command Router

Normalizes incoming Web actions, Feishu commands, scheduler triggers, and MCP calls into `Task` records.

Responsibilities:

- Parse `/agent`, `/context`, scheduler, and message commands.
- Apply default Agent resolution: `user -> channel -> workspace -> system`.
- Create idempotent tasks using a `dedupe_key`.
- Reject commands that violate workspace or security policy.

### Sessions

Owns `Session`, `AgentRun`, and `Task` state machines.

Responsibilities:

- Enforce one active `AgentRun` per Session in MVP.
- Create new target Sessions for handoff.
- Keep retries as new runs instead of mutating old runs.
- Emit state transition events.

### Runtime

Owns Agent process execution.

Responsibilities:

- RuntimeSupervisor manages process start, stdin writes, stdout/stderr reads, heartbeat, timeout, cancellation, stop, exit code, and cleanup.
- AgentRuntimeAdapter provides `probe`, `capabilities`, `createLaunchSpec`, `encodeInput`, `decodeOutput`, and `classifyError`.
- Supervisor appends decoded RuntimeEvents into EventStore.

Adapters for MVP:

- `CodexRuntimeAdapter`
- `ClaudeRuntimeAdapter`
- `TraeRuntimeAdapter`

### Events

Owns EventStore, Outbox, Projectors, and replay.

Responsibilities:

- Store append-only events.
- Maintain projector offsets.
- Enqueue delivery work in Outbox.
- Rebuild projections after restart or bug fixes.
- Let Web reconnect by fetching missing events.

### Rendering

Creates channel-neutral view models.

Responsibilities:

- Convert EventStore data into conversation views, status panels, Feishu card models, and compact summaries.
- Avoid direct calls to Feishu, WebSocket, or external APIs.

### Delivery

Owns external side effects.

Responsibilities:

- Read Outbox records.
- Deliver Web events through SSE or WebSocket.
- Update Feishu cards with throttling, splitting, retry, and idempotency.
- Append delivery success/failure events.

### Context

Owns context budget and ContextPack lifecycle.

Responsibilities:

- Estimate context usage when an Agent does not expose token counts.
- Transition context status through `healthy`, `warning`, `critical`, and `overflow`.
- Generate ContextPack from EventStore ranges.
- Restart or handoff using ContextPack plus recent raw messages.

### Scheduler

Owns cron and one-shot task creation.

Responsibilities:

- Create tasks at scheduled time.
- Respect Session concurrency policy.
- Record skipped, queued, failed, and completed scheduled runs.

### Security

Owns local safety boundaries.

Responsibilities:

- Enforce workspace allowlist.
- Redact secrets from logs, events, cards, and screenshots.
- Audit remote commands from Feishu.
- Require confirmation for dangerous operations.

## 4. Main Flows

### Web Or Feishu Message

1. ChannelAdapter receives input.
2. Command Router creates a Task in a transaction.
3. Sessions module resolves or creates a Session.
4. RuntimeSupervisor creates an AgentRun.
5. AgentRuntimeAdapter launches the chosen CLI Agent.
6. Runtime events are appended to EventStore.
7. Projectors produce messages and card view models.
8. Outbox queues Web and Feishu delivery work.
9. Delivery workers send updates and append delivery events.

### UI Reconnect

1. Client sends last seen event ID or seq.
2. Server queries EventStore.
3. Server returns missed events and current projections.
4. Live stream resumes from the latest event.

No live UI state should depend only on memory.

### Runtime Crash

1. RuntimeSupervisor detects process exit or heartbeat timeout.
2. Supervisor appends `run_failed` or `run_finished`.
3. Session state transitions to `failed`, `idle`, or `compacting` based on policy.
4. Outbox delivers failure status.
5. User or system may create a retry Task, producing a new AgentRun.

### Context Overflow

1. ContextBudget reaches warning or critical threshold, or adapter classifies overflow.
2. Context module creates a ContextPack from the covered EventStore range.
3. Session enters `compacting`.
4. RuntimeSupervisor stops or restarts the run according to adapter capability.
5. Next run receives ContextPack plus recent messages, not full history.

### Handoff

1. User requests handoff to another Agent type.
2. Context module ensures a ready ContextPack exists.
3. Sessions module creates a new target Session.
4. Target Session records `source_session_id` and `source_context_pack_id`.
5. Target AgentRun starts with ContextPack, recent messages, workspace, and open tasks.
6. Source Session remains queryable.

### Scheduled Task

1. Scheduler finds due schedule.
2. Scheduler creates a Task with a dedupe key.
3. If target Session has active run, policy queues, skips, or fails the task.
4. Accepted task follows the normal runtime flow.

## 5. Data Ownership

- EventStore owns historical facts.
- Sessions own current state and active run pointer.
- Outbox owns pending delivery work.
- Projectors own rebuildable read models.
- Context owns ContextPack generation and context status.
- Runtime owns process lifecycle only while a run is active.
- Security owns policy decisions and audit logs.

## 6. Invariants

- A non-archived Session has one fixed Agent type.
- MVP permits one active AgentRun per Session.
- Retrying a run creates a new AgentRun.
- Handoff creates a new Session.
- Agent output is appended to EventStore before delivery.
- Outbox delivery is idempotent.
- Projected messages are rebuildable from EventStore.
- Compact never deletes raw events or messages.
- Delivery failures do not modify source events.
- Remote commands are audited.
- Secrets are redacted before persistence or display.

## 7. Testing Strategy

Start with tests around interfaces, not real CLIs.

- State machine tests for Session, AgentRun, Task, and Outbox transitions.
- Fake AgentRuntimeAdapter tests for stdout/stderr parsing, crash, overflow, permission prompt, and cancel.
- EventStore tests for append order, run seq uniqueness, replay, and projector offsets.
- Outbox tests for idempotency key, retry, lease timeout, and dead-letter state.
- ContextPack tests for source event range, schema version, and restart payload.
- Security tests for workspace allowlist and secret redaction.
- Integration test: fake Feishu input -> fake Agent output -> EventStore -> Outbox -> delivery success.

Real Codex CLI, Claude Code, and Trae CLI tests should be adapter smoke tests behind an opt-in environment flag.

## 8. Implementation Order

1. Shared enums and schema validation.
2. SQLite migrations for EventStore, Outbox, Session, AgentRun, Task, ContextPack, and AuditLog.
3. State machine module with unit tests.
4. EventStore append/query and projector cursor.
5. Outbox enqueue/worker/retry/idempotency.
6. RuntimeSupervisor with fake adapter.
7. Codex, Claude, and Trae adapters.
8. ContextBudget and ContextPack generation.
9. Web UI event replay and live stream.
10. Feishu adapter and card delivery.

## 9. Open Decisions

- Whether Web live updates use SSE or WebSocket for MVP.
- Whether Agent profiles are stored only in SQLite or loaded from config plus cached probe results.
- Whether cron tasks queue or skip when a Session is already running.
- Exact redaction rules for secrets inside Agent output.
- Retention policy for EventStore, ContextPack, and AuditLog.
