# ADR 0001: ACP Runtime Boundary

## Status

Accepted.

## Context

MiniAgent originally connected Codex CLI, Claude Code, and Trae CLI through per-agent adapters that launched a subprocess and parsed stdout/stderr. That path is useful as a compatibility fallback, but it does not provide a durable protocol for permissions, structured tool calls, file context, resume, cancellation, or replayable streaming events.

ACP standardizes the client-to-agent boundary as JSON-RPC over stdio. The protocol has first-class session lifecycle methods, streaming session updates, permission requests, file-system capabilities, resume, and cancellation.

## Decision

MiniAgent will treat ACP as the canonical runtime protocol. The runtime layer is split into:

- `RuntimeSupervisor`: owns MiniAgent run lifecycle, EventStore writes, batching, and status transitions.
- `RuntimeSessionDriver`: owns protocol-specific interaction with an agent.
- `AcpRuntimeDriver`: implements ACP JSON-RPC over stdio.
- `LegacyCliRuntimeDriver`: wraps existing CLI adapters so Codex, Claude, and Trae keep working while ACP coverage is rolled out.

The EventStore remains the system of record. Runtime drivers emit `RuntimeEventDraft` objects only; projectors and outbox delivery stay asynchronous and protocol-agnostic.

## Consequences

- Existing CLI adapters remain supported behind the same registry.
- ACP session IDs, checkpoint IDs, protocol state, and cancel state are persisted on `agent_runs`.
- Permission prompts are modeled as durable `permission_requests`, not transient stdout text.
- UI, Feishu, and MCP control surfaces should respond to MiniAgent events and APIs, not ACP messages directly.

## Rollout

1. Land fake ACP contract tests for streaming, permission response, resume, file context links, and cancellation.
2. Add ACP profiles behind `runtime_kind = 'acp'`.
3. Migrate one real agent to ACP.
4. Keep `runtime_kind = 'cli'` as fallback until all target agents have ACP parity.
