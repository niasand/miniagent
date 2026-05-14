import type { SqliteDatabase } from "../db/migrate.js";
import type { MessageRole } from "../events/message-store.js";
import { parseJson } from "../../shared/json.js";
import type {
  WorkspaceAgentLabel,
  WorkspaceAgentType,
  WorkspaceContextBudget,
  WorkspaceMessage,
  WorkspaceRuntimeSummary,
  WorkspaceSessionStatus,
  WorkspaceSnapshot,
} from "../../shared/workspace.js";

type SessionRow = {
  id: string;
  title: string;
  agent_type: string;
  workspace_path: string;
  status: string;
  source_session_id: string | null;
  updated_at: string;
};

type MessageRow = {
  id: string;
  role: MessageRole;
  content: string;
  metadata_json: string;
  created_at: string;
};

type OutboxRow = {
  event_global_seq: number | null;
  channel_type: string;
  kind: string;
  status: string;
};

type EventRow = {
  global_seq: number;
  type: string;
  payload_json: string;
  run_id: string | null;
};

type ContextBudgetRow = {
  status: WorkspaceContextBudget["status"];
  token_estimate: number;
  budget_tokens: number;
  usage_ratio: number;
  warning_threshold: number;
  critical_threshold: number;
  overflow_threshold: number;
  current_context_pack_id: string | null;
  last_compacted_at: string | null;
};

type RuntimeRow = {
  id: string;
  agent_type: string;
  runtime_kind: "cli" | "acp";
  status: string;
  pid: number | null;
  started_at: string | null;
};

export type WorkspaceSnapshotOptions = {
  selectedSessionId?: string | null;
};

export function createWorkspaceSnapshot(db: SqliteDatabase, options: WorkspaceSnapshotOptions = {}): WorkspaceSnapshot {
  const sessions = readSessions(db);
  const selectedSessionId =
    sessions.find((session) => session.id === options.selectedSessionId)?.id ?? sessions[0]?.id ?? null;

  return {
    selectedSessionId,
    sessions,
    messages: selectedSessionId ? readMessages(db, selectedSessionId) : [],
    outboxRows: readOutboxRows(db),
    keyEvents: readKeyEvents(db),
    contextBudget: selectedSessionId ? readContextBudget(db, selectedSessionId) : defaultContextBudget(),
    runtime: selectedSessionId ? readRuntime(db, selectedSessionId) : defaultRuntime(),
  };
}

function readSessions(db: SqliteDatabase): WorkspaceSnapshot["sessions"] {
  const rows = db
    .prepare(
      `
      SELECT id, title, agent_type, workspace_path, status, source_session_id, updated_at
      FROM sessions
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 50
    `,
    )
    .all() as SessionRow[];

  return rows.map((row) => {
    const agentType = mapAgentType(row.agent_type);
    const agent = mapAgent(agentType);
    return {
      id: row.id,
      title: row.title,
      agentType,
      agent,
      initials: mapInitials(agentType),
      workspace: row.source_session_id ? `handoff from ${row.source_session_id}` : row.workspace_path,
      status: mapStatus(row.status),
      handoff: row.source_session_id ?? undefined,
    };
  });
}

function readMessages(db: SqliteDatabase, sessionId: string): WorkspaceMessage[] {
  const rows = db
    .prepare(
      `
      SELECT messages.id, messages.role, messages.content, messages.metadata_json, messages.created_at
      FROM messages
      JOIN events ON events.id = messages.source_event_id
      WHERE messages.session_id = ?
      ORDER BY events.global_seq ASC
      LIMIT 200
    `,
    )
    .all(sessionId) as MessageRow[];

  return rows.map((row) => {
    const metadata = parseJson(row.metadata_json);
    const badge =
      metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata.eventType : undefined;
    return {
      id: row.id,
      role: mapMessageRole(row.role),
      author: mapAuthor(row.role),
      time: formatTime(row.created_at),
      badge: typeof badge === "string" ? badge : undefined,
      markdown: row.content,
    };
  });
}

function readOutboxRows(db: SqliteDatabase): WorkspaceSnapshot["outboxRows"] {
  const rows = db
    .prepare(
      `
      SELECT event_global_seq, channel_type, kind, status
      FROM outbox
      ORDER BY created_at DESC
      LIMIT 8
    `,
    )
    .all() as OutboxRow[];

  return rows.map((row) => [
    row.event_global_seq?.toLocaleString("en-US") ?? "-",
    mapChannel(row.channel_type),
    `${row.kind} ${row.status}`,
  ]);
}

function readKeyEvents(db: SqliteDatabase): WorkspaceSnapshot["keyEvents"] {
  const rows = db
    .prepare(
      `
      SELECT global_seq, type, payload_json, run_id
      FROM events
      ORDER BY global_seq DESC
      LIMIT 8
    `,
    )
    .all() as EventRow[];

  return rows.reverse().map((row) => [
    row.global_seq.toLocaleString("en-US"),
    row.type,
    describeEvent(row),
  ]);
}

function readContextBudget(db: SqliteDatabase, sessionId: string): WorkspaceContextBudget {
  const row = db.prepare("SELECT * FROM context_budgets WHERE session_id = ?").get(sessionId) as
    | ContextBudgetRow
    | undefined;

  if (!row) {
    return defaultContextBudget();
  }

  return {
    status: row.status,
    tokenEstimate: row.token_estimate,
    budgetTokens: row.budget_tokens,
    usagePercent: Math.round(row.usage_ratio * 100),
    warningPercent: Math.round(row.warning_threshold * 100),
    criticalPercent: Math.round(row.critical_threshold * 100),
    overflowPercent: Math.round(row.overflow_threshold * 100),
    currentContextPackId: row.current_context_pack_id,
    lastCompactedAt: row.last_compacted_at,
  };
}

function defaultContextBudget(): WorkspaceContextBudget {
  return {
    status: "healthy",
    tokenEstimate: 0,
    budgetTokens: 100_000,
    usagePercent: 0,
    warningPercent: 70,
    criticalPercent: 85,
    overflowPercent: 95,
    currentContextPackId: null,
    lastCompactedAt: null,
  };
}

function readRuntime(db: SqliteDatabase, sessionId: string): WorkspaceRuntimeSummary {
  const row = db
    .prepare(
      `
      SELECT id, agent_type, runtime_kind, status, pid, started_at
      FROM agent_runs
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
    )
    .get(sessionId) as RuntimeRow | undefined;

  if (!row) {
    return defaultRuntime();
  }

  return {
    activeRunId: isActiveRunStatus(row.status) ? row.id : null,
    status: row.status,
    pid: row.pid,
    agentType: mapAgentType(row.agent_type),
    runtimeKind: row.runtime_kind,
    startedAt: row.started_at,
  };
}

function defaultRuntime(): WorkspaceRuntimeSummary {
  return {
    activeRunId: null,
    status: "idle",
    pid: null,
    agentType: null,
    runtimeKind: null,
    startedAt: null,
  };
}

function isActiveRunStatus(status: string): boolean {
  return ["queued", "starting", "running", "waiting_permission", "compacting", "stopping"].includes(status);
}

function describeEvent(row: EventRow): string {
  const payload = parseJson(row.payload_json);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    if (typeof payload.agentType === "string") {
      return payload.agentType;
    }
    if (typeof payload.status === "string") {
      return payload.status;
    }
    if (typeof payload.text === "string") {
      return `${payload.text.length} chars`;
    }
  }

  return row.run_id ?? "system";
}

function mapAgentType(agentType: string): WorkspaceAgentType {
  if (agentType === "claude" || agentType === "trae") {
    return agentType;
  }
  return "codex";
}

function mapAgent(agentType: WorkspaceAgentType): WorkspaceAgentLabel {
  if (agentType === "claude") {
    return "Claude";
  }
  if (agentType === "trae") {
    return "Trae";
  }
  return "Codex";
}

function mapInitials(agentType: WorkspaceAgentType): string {
  if (agentType === "claude") {
    return "CL";
  }
  if (agentType === "trae") {
    return "TR";
  }
  return "CX";
}

function mapStatus(status: string): WorkspaceSessionStatus {
  if (status === "compacting") {
    return "compact";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "running" || status === "archived") {
    return status;
  }
  return "idle";
}

function mapMessageRole(role: MessageRole): WorkspaceMessage["role"] {
  if (role === "assistant") {
    return "agent";
  }
  return role;
}

function mapAuthor(role: MessageRole): string {
  if (role === "assistant") {
    return "Agent";
  }
  if (role === "tool") {
    return "Tool trace";
  }
  if (role === "system") {
    return "MiniAgent";
  }
  return "You";
}

function mapChannel(channelType: string): string {
  if (channelType === "feishu") {
    return "Feishu";
  }
  return "Web";
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
