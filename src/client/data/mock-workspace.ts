import type { WorkspaceMessage, WorkspaceSnapshot, WorkspaceSessionSummary } from "../../shared/workspace.js";

export const sessions: WorkspaceSessionSummary[] = [
  {
    id: "session-prd",
    title: "MiniAgent PRD hardening",
    agentType: "codex",
    agent: "Codex",
    initials: "CX",
    workspace: "/Documents/MiniAgent",
    status: "running",
  },
  {
    id: "session-feishu",
    title: "Feishu card renderer",
    agentType: "claude",
    agent: "Claude",
    initials: "CL",
    workspace: "handoff from Codex",
    status: "compact",
    handoff: "Codex",
  },
  {
    id: "session-trae",
    title: "Runtime adapter smoke test",
    agentType: "trae",
    agent: "Trae",
    initials: "TR",
    workspace: "queued by cron",
    status: "queued",
  },
  {
    id: "session-sqlite",
    title: "SQLite migration draft",
    agentType: "codex",
    agent: "Codex",
    initials: "CX",
    workspace: "/Documents/MiniAgent",
    status: "idle",
  },
  {
    id: "session-replay",
    title: "EventStore replay review",
    agentType: "claude",
    agent: "Claude",
    initials: "CL",
    workspace: "archived",
    status: "archived",
  },
];

export const messages: WorkspaceMessage[] = [
  {
    id: "m1",
    role: "user",
    author: "You",
    time: "09:41",
    markdown: "Review the PRD again and strengthen the architecture before implementation.",
  },
  {
    id: "m2",
    role: "agent",
    author: "Codex CLI",
    badge: "streaming",
    markdown:
      "The hot path should stay thin. RuntimeSupervisor now appends batched runtime events only; Projectors create read models and Outbox work asynchronously.\n\n```text\ntext_delta batch: 126ms - 1.7 KB\nevent: runtime_output_appended\ncursor: global_seq=18442\n```",
  },
  {
    id: "m3",
    role: "tool",
    author: "Tool trace",
    badge: "success",
    markdown: "`git diff --check` completed. No whitespace errors.",
  },
];

export const outboxRows: WorkspaceSnapshot["outboxRows"] = [
  ["18,440", "Feishu", "card_update pending"],
  ["18,441", "Web", "event sent"],
  ["18,442", "Feishu", "lease acquired"],
];

export const keyEvents: WorkspaceSnapshot["keyEvents"] = [
  ["18,439", "run_started", "CodexRuntimeAdapter"],
  ["18,440", "text_delta", "batch 1.7 KB"],
  ["18,441", "delivery_queued", "web_event"],
  ["18,442", "run_heartbeat", "healthy"],
];

export const fallbackWorkspace: WorkspaceSnapshot = {
  selectedSessionId: "session-prd",
  sessions,
  messages,
  outboxRows,
  keyEvents,
};
