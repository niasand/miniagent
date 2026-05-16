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

### 4. Last-message check still hit by stale agent messages (second pass)

Fix #3 was insufficient. The `messages` effect still cleared `isStreamingRef` prematurely because:

1. User sends message → `isStreamingRef = true`
2. Workspace poll refetches → old run's agent message is still the last message
3. Effect fires: `last?.role === "agent"` → `isStreamingRef = false`
4. SSE `text_delta` arrives → `isStreaming: false` → no streaming text accumulated

Console log proof (same symptom): `[SSE] text_delta received, isStreaming: false`

**Fix:** `src/client/App.tsx` — three changes:

- Added `activeRunIdRef` to track the current run ID from SSE `run_started` events. The `text_delta` handler now gates on `activeRunIdRef.current` (truthy = active run) instead of `isStreamingRef`.
- Added `streamStartCountRef` to capture `messages.length` at send time. The `messages` effect only clears streaming when `messages.length > streamStartCountRef.current` (genuinely new message) AND the last message is from the agent.
- Added SSE `run_completed` handler to clear `activeRunIdRef` when the active run finishes.

### 5. Typing dots disappear between mutation settle and first text_delta

`sendMessage.isPending` becomes `false` when the mutation completes, but the first `text_delta` event hasn't arrived yet. The typing indicator condition `(sendMessage.isPending || streamingText)` evaluates to `false` during this gap, hiding the "..." dots.

**Fix:** `src/client/App.tsx` — added `isStreaming` as a React state variable (not just a ref) so it drives re-renders. The typing indicator condition becomes `(sendMessage.isPending || isStreaming || streamingText)`. `isStreaming` is set to `true` on send and cleared when the agent message appears.

### 6. Session lost on page refresh

`sessionId` was stored only in React component state (`useState`), which is cleared on page refresh. The user lost all conversation context after refreshing.

**Fix:** `src/client/App.tsx` — initialize `sessionId` from `localStorage.getItem("sessionId")` and persist with `localStorage.setItem()` on session creation.

## Additional fixes in this session

- **Vite proxy SSE buffering:** Configured proxy to not buffer SSE events (`src/vite.config.ts`)
- **Web message session mismatch:** HTTP endpoint created new sessions instead of reusing existing ones (`src/server/http/app.ts`, `src/server/services/inbound.ts`)
- **UTC+8 timestamps:** Unified all timestamps to `+08:00` format for correct SQLite string comparison (`src/shared/time.ts`)
- **ContextBudgetStore test API:** Fixed `upsert()` call signature in tests (`tests/stores.test.ts`, `tests/services-delivery-workspace.test.ts`)
