import type { SqliteDatabase } from "../db/migrate.js";
import { AuditLogStore } from "../audit/audit-log-store.js";
import { DefaultAgentService } from "../agents/default-agent-service.js";
import { ContextBudgetService } from "../context/context-budget-service.js";
import { EventStore } from "../events/event-store.js";
import { HandoffService } from "../handoff/handoff-service.js";
import type { AgentType } from "../runtime/types.js";
import { WorkspacePolicy, WorkspacePolicyError } from "../security/workspace-policy.js";
import { SessionStore, type SessionRecord, type TaskRecord } from "../sessions/session-store.js";
import { nowIso } from "../../shared/time.js";
import type { JsonObject } from "../../shared/json.js";

export type TelegramInboundMessageInput = {
  messageId: string;
  chatId: string;
  userId?: string | null;
  text: string;
  sessionId?: string | null;
  workspacePath?: string | null;
  defaultAgentType?: AgentType;
  chatType: "private" | "group" | "supergroup";
  receivedAt?: string;
};

export type TelegramInboundResult =
  | {
      action: "message";
      session: SessionRecord;
      task: TaskRecord;
    }
  | {
      action: "agent_new";
      session: SessionRecord;
    }
  | {
      action: "agent_list";
      agents: AgentType[];
    }
  | {
      action: "agent_use";
      scopeType: "user" | "channel";
      scopeRef: string;
      agentType: AgentType;
    }
  | {
      action: "handoff";
      sourceSessionId: string;
      targetSessionId: string;
      taskId: string;
      contextPackId: string;
    }
  | {
      action: "context_compact";
      sessionId: string;
      contextPackId: string;
    }
  | {
      action: "context_status";
      sessionId: string;
      status: string;
      tokenEstimate: number;
    };

export type TelegramInboundOptions = {
  workspacePolicy?: WorkspacePolicy;
};

const AGENTS: AgentType[] = ["codex", "claude", "trae"];

export class TelegramInboundService {
  private readonly auditLogs: AuditLogStore;
  private readonly contextBudget: ContextBudgetService;
  private readonly defaultAgents: DefaultAgentService;
  private readonly events: EventStore;
  private readonly handoff: HandoffService;
  private readonly sessions: SessionStore;
  private readonly workspacePolicy: WorkspacePolicy;

  constructor(private readonly db: SqliteDatabase, events = new EventStore(db), options: TelegramInboundOptions = {}) {
    this.auditLogs = new AuditLogStore(db);
    this.contextBudget = new ContextBudgetService(db, events);
    this.defaultAgents = new DefaultAgentService(db);
    this.events = events;
    this.handoff = new HandoffService(db, events);
    this.sessions = new SessionStore(db, events);
    this.workspacePolicy = options.workspacePolicy ?? WorkspacePolicy.fromEnvironment([process.cwd()]);
  }

  receiveMessage(input: TelegramInboundMessageInput): TelegramInboundResult {
    const text = input.text.trim();
    if (!text) {
      throw new Error("Message text is required");
    }
    if (!input.messageId.trim()) {
      throw new Error("messageId is required");
    }
    if (!input.chatId.trim()) {
      throw new Error("chatId is required");
    }

    const command = parseCommand(text);
    if (command?.name === "agent" && command.args[0] === "list") {
      return { action: "agent_list", agents: AGENTS };
    }

    if (command?.name === "agent" && command.args[0] === "use") {
      const agentType = readAgentType(command.args[1]);
      const scopeType = input.userId ? "user" : "channel";
      const scopeRef = input.userId ?? input.chatId;
      this.defaultAgents.setDefault({
        scopeType,
        scopeRef,
        agentType,
      });
      this.auditRemoteCommand(input, "agent_use", { scopeType, scopeRef, agentType });
      return { action: "agent_use", scopeType, scopeRef, agentType };
    }

    if (command?.name === "agent" && command.args[0] === "new") {
      const workspacePath = this.requireAllowedWorkspace(
        input,
        command.args[2] ?? input.workspacePath ?? process.cwd(),
        "agent_new",
      );
      const agentType = command.args[1]
        ? readAgentType(command.args[1])
        : this.resolveDefaultAgent(input, workspacePath);
      const session = this.sessions.createSession({
        title: `Telegram ${displayAgent(agentType)}`,
        agentType,
        workspacePath,
        channelType: "telegram",
        channelRef: input.chatId,
      });
      this.auditRemoteCommand(input, "agent_new", { sessionId: session.id, agentType });
      return { action: "agent_new", session };
    }

    const session = this.resolveSession(input);
    if (command?.name === "agent" && command.args[0] === "handoff") {
      const targetAgentType = readAgentType(command.args[1]);
      const result = this.handoff.handoff({
        sourceSessionId: session.id,
        targetAgentType,
        actorType: "telegram_user",
        actorRef: input.userId ?? null,
      });
      this.auditRemoteCommand(input, "agent_handoff", {
        sourceSessionId: session.id,
        targetSessionId: result.targetSession.id,
        targetAgentType,
      });
      return {
        action: "handoff",
        sourceSessionId: session.id,
        targetSessionId: result.targetSession.id,
        taskId: result.task.id,
        contextPackId: result.contextPack.id,
      };
    }

    if (command?.name === "context" && command.args[0] === "compact") {
      const result = this.contextBudget.compactNow({
        sessionId: session.id,
        createdBy: "user",
        compactedAt: input.receivedAt ?? nowIso(),
      });
      this.auditRemoteCommand(input, "context_compact", {
        sessionId: session.id,
        contextPackId: result.contextPack?.id ?? null,
      });
      return {
        action: "context_compact",
        sessionId: session.id,
        contextPackId: result.contextPack?.id ?? "",
      };
    }

    if (command?.name === "context" && command.args[0] === "status") {
      const result = this.contextBudget.evaluate({ sessionId: session.id, autoCompact: false });
      return {
        action: "context_status",
        sessionId: session.id,
        status: result.budget.status,
        tokenEstimate: result.budget.tokenEstimate,
      };
    }

    const task = this.createMessageTask(input, session, text);
    return { action: "message", session, task };
  }

  private resolveSession(input: TelegramInboundMessageInput): SessionRecord {
    if (input.sessionId) {
      const session = this.sessions.getSession(input.sessionId);
      if (!session) {
        throw new Error(`Session not found: ${input.sessionId}`);
      }
      this.requireAllowedWorkspace(input, session.workspacePath, "session_use");
      return session;
    }

    const existing = this.findLatestSessionByChat(input.chatId);
    if (existing) {
      this.requireAllowedWorkspace(input, existing.workspacePath, "session_use");
      return existing;
    }

    const workspacePath = this.requireAllowedWorkspace(input, input.workspacePath ?? process.cwd(), "session_create");
    return this.sessions.createSession({
      title: "Telegram Codex",
      workspacePath,
      agentType: this.resolveDefaultAgent(input, workspacePath),
      channelType: "telegram",
      channelRef: input.chatId,
    });
  }

  private findLatestSessionByChat(chatId: string): SessionRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT id
        FROM sessions
        WHERE channel_type = 'telegram'
          AND channel_ref = ?
          AND status != 'archived'
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `,
      )
      .get(chatId) as { id: string } | undefined;

    return row ? this.sessions.getSession(row.id) : null;
  }

  private createMessageTask(input: TelegramInboundMessageInput, session: SessionRecord, text: string): TaskRecord {
    const dedupeKey = `telegram:${input.messageId}`;
    try {
      return this.sessions.createTask({
        sessionId: session.id,
        sourceType: "telegram",
        sourceRef: input.messageId,
        type: "message",
        input: {
          text,
          chatId: input.chatId,
          userId: input.userId ?? null,
          chatType: input.chatType,
        },
        dedupeKey,
        queuedAt: input.receivedAt ?? nowIso(),
      }).task;
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        const row = this.db.prepare("SELECT id FROM tasks WHERE dedupe_key = ?").get(dedupeKey) as
          | { id: string }
          | undefined;
        if (row) {
          const existing = this.sessions.getTask(row.id);
          if (existing) {
            return existing;
          }
        }
      }
      throw error;
    }
  }

  private auditRemoteCommand(input: TelegramInboundMessageInput, action: string, payload: JsonObject): void {
    this.auditLogs.insert({
      actorType: "telegram_user",
      actorRef: input.userId ?? null,
      action,
      resourceType: "telegram_message",
      resourceId: input.messageId,
      payload,
      createdAt: input.receivedAt ?? nowIso(),
    });
  }

  private requireAllowedWorkspace(input: TelegramInboundMessageInput, workspacePath: string, action: string): string {
    try {
      return this.workspacePolicy.assertAllowed(workspacePath);
    } catch (error) {
      if (error instanceof WorkspacePolicyError) {
        this.auditRemoteCommand(input, "workspace_denied", {
          action,
          workspacePath: error.workspacePath,
          normalizedPath: error.normalizedPath,
          reason: error.reason,
          allowlist: error.allowlist,
        });
      }
      throw error;
    }
  }

  private resolveDefaultAgent(input: TelegramInboundMessageInput, workspacePath: string): AgentType {
    return (
      input.defaultAgentType ??
      this.defaultAgents.resolve({
        userRef: input.userId ?? null,
        channelRef: input.chatId,
        workspacePath,
      }).agentType
    );
  }
}

function parseCommand(text: string): { name: string; args: string[] } | null {
  if (!text.startsWith("/")) {
    return null;
  }

  const parts = text.slice(1).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  return { name: parts[0], args: parts.slice(1) };
}

function readAgentType(value: unknown): AgentType {
  if (value === "codex" || value === "claude" || value === "trae") {
    return value;
  }
  throw new Error("agent type must be one of: codex, claude, trae");
}

function displayAgent(agentType: AgentType): string {
  if (agentType === "claude") {
    return "Claude";
  }
  if (agentType === "trae") {
    return "Trae";
  }
  return "Codex";
}
