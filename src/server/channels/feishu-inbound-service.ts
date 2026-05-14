import type { SqliteDatabase } from "../db/migrate.js";
import { AuditLogStore } from "../audit/audit-log-store.js";
import { ContextBudgetService } from "../context/context-budget-service.js";
import { EventStore } from "../events/event-store.js";
import { HandoffService } from "../handoff/handoff-service.js";
import type { AgentType } from "../runtime/types.js";
import { SessionStore, type SessionRecord, type TaskRecord } from "../sessions/session-store.js";
import { nowIso } from "../../shared/time.js";
import type { JsonObject } from "../../shared/json.js";

export type FeishuInboundMessageInput = {
  messageId: string;
  chatId: string;
  userId?: string | null;
  text: string;
  sessionId?: string | null;
  workspacePath?: string | null;
  defaultAgentType?: AgentType;
  receivedAt?: string;
};

export type FeishuInboundResult =
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

const AGENTS: AgentType[] = ["codex", "claude", "trae"];

export class FeishuInboundService {
  private readonly auditLogs: AuditLogStore;
  private readonly contextBudget: ContextBudgetService;
  private readonly events: EventStore;
  private readonly handoff: HandoffService;
  private readonly sessions: SessionStore;

  constructor(private readonly db: SqliteDatabase, events = new EventStore(db)) {
    this.auditLogs = new AuditLogStore(db);
    this.contextBudget = new ContextBudgetService(db, events);
    this.events = events;
    this.handoff = new HandoffService(db, events);
    this.sessions = new SessionStore(db, events);
  }

  receiveMessage(input: FeishuInboundMessageInput): FeishuInboundResult {
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

    if (command?.name === "agent" && command.args[0] === "new") {
      const agentType = readAgentType(command.args[1] ?? input.defaultAgentType ?? "codex");
      const workspacePath = command.args[2] ?? input.workspacePath ?? process.cwd();
      const session = this.sessions.createSession({
        title: `Feishu ${displayAgent(agentType)}`,
        agentType,
        workspacePath,
        channelType: "feishu",
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
        actorType: "feishu_user",
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

  private resolveSession(input: FeishuInboundMessageInput): SessionRecord {
    if (input.sessionId) {
      const session = this.sessions.getSession(input.sessionId);
      if (!session) {
        throw new Error(`Session not found: ${input.sessionId}`);
      }
      return session;
    }

    const existing = this.findLatestSessionByChat(input.chatId);
    if (existing) {
      return existing;
    }

    return this.sessions.createSession({
      title: "Feishu Codex",
      agentType: input.defaultAgentType ?? "codex",
      workspacePath: input.workspacePath ?? process.cwd(),
      channelType: "feishu",
      channelRef: input.chatId,
    });
  }

  private findLatestSessionByChat(chatId: string): SessionRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT id
        FROM sessions
        WHERE channel_type = 'feishu'
          AND channel_ref = ?
          AND status != 'archived'
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `,
      )
      .get(chatId) as { id: string } | undefined;

    return row ? this.sessions.getSession(row.id) : null;
  }

  private createMessageTask(input: FeishuInboundMessageInput, session: SessionRecord, text: string): TaskRecord {
    const dedupeKey = `feishu:${input.messageId}`;
    try {
      return this.sessions.createTask({
        sessionId: session.id,
        sourceType: "feishu",
        sourceRef: input.messageId,
        type: "message",
        input: {
          text,
          chatId: input.chatId,
          userId: input.userId ?? null,
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

  private auditRemoteCommand(input: FeishuInboundMessageInput, action: string, payload: JsonObject): void {
    this.auditLogs.insert({
      actorType: "feishu_user",
      actorRef: input.userId ?? null,
      action,
      resourceType: "feishu_message",
      resourceId: input.messageId,
      payload,
      createdAt: input.receivedAt ?? nowIso(),
    });
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
