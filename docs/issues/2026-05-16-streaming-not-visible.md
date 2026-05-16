# Issue: Streaming response not visible in web UI

**Date:** 2026-05-16
**Status:** Resolved

## Symptom

User sends a message in the web UI, but:
- No "..." typing animation appears
- No streaming text from SSE `text_delta` events
- Agent response only shows after full completion (via workspace polling)

## Root Causes (3 separate bugs)

### 1. ACP binary command was wrong

The runtime registry used `claude` as the ACP command, but `claude` CLI doesn't support ACP protocol. The correct binary is `claude-agent-acp` from `@agentclientprotocol/claude-agent-acp`.

**Fix:** `src/server/runtime/registry.ts` — resolve `claude-agent-acp` from node_modules instead of using bare `claude`.

### 2. Agent messages not persisted to MessageStore

The supervisor stored `text_delta` events in EventStore but never wrote the agent's final response to MessageStore. The frontend polls the workspace endpoint which reads from MessageStore, so agent responses were invisible.

**Fix:** `src/server/runtime/supervisor.ts` — added `persistAgentMessage()` in `handleExit()` to write agent response as an assistant message.

### 3. Stale agent messages cleared streaming state prematurely

The frontend's `messages` effect checked `messages.some(m => m.role === "agent")` to clear streaming state. Old agent messages from previous runs in the same session caused this check to be true immediately, clearing `isStreamingRef` before any `text_delta` events arrived.

Console log proof: `[SSE] text_delta received, isStreaming: false`

**Fix:** `src/client/App.tsx` — changed to check `messages[messages.length - 1]?.role === "agent"` (last message only), so stale messages don't interfere.

## Additional fixes in this session

- **Vite proxy SSE buffering:** Configured proxy to not buffer SSE events (`src/vite.config.ts`)
- **Web message session mismatch:** HTTP endpoint created new sessions instead of reusing existing ones (`src/server/http/app.ts`, `src/server/services/inbound.ts`)
- **UTC+8 timestamps:** Unified all timestamps to `+08:00` format for correct SQLite string comparison (`src/shared/time.ts`)
- **ContextBudgetStore test API:** Fixed `upsert()` call signature in tests (`tests/stores.test.ts`, `tests/services-delivery-workspace.test.ts`)
