import type { SqliteDatabase } from "../db/migrate.js";
import { SessionStore, type SessionRecord, type SourceType } from "../stores/session-store.js";
import { EventStore } from "../stores/event-store.js";
import { MessageStore } from "../stores/message-store.js";
import { OutboxStore, type OutboxChannel, type OutboxKind } from "../stores/outbox-store.js";
import { AuditLogStore, type AuditActorType } from "../stores/audit-log-store.js";
import { AgentDefaultStore } from "../stores/agent-default-store.js";
import { ContextBudgetStore } from "../stores/context-budget-store.js";
import { WorkspacePolicy } from "../security/workspace-policy.js";
import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { stringifyJson, type JsonValue } from "../../shared/json.js";

export type InboundMessage = {
  messageId: string;
  chatId: string;
  userId: string;
  text: string;
  chatType: "private" | "group";
  isMentioned?: boolean;
};

export type InboundResult = {
  action: "message" | "command" | "ignored";
  session: SessionRecord;
  taskId?: string;
};

const SLASH_COMMANDS = ["/agent", "/context"] as const;

export class InboundService {
  private sessions: SessionStore;
  private events: EventStore;
  private messages: MessageStore;
  private outbox: OutboxStore;
  private auditLogs: AuditLogStore;
  private agentDefaults: AgentDefaultStore;
  private contextBudgets: ContextBudgetStore;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly channelType: string,
    private readonly options: { workspacePolicy: WorkspacePolicy },
  ) {
    this.events = new EventStore(db);
    this.sessions = new SessionStore(db, this.events);
    this.messages = new MessageStore(db);
    this.outbox = new OutboxStore(db);
    this.auditLogs = new AuditLogStore(db);
    this.agentDefaults = new AgentDefaultStore(db);
    this.contextBudgets = new ContextBudgetStore(db);
  }

  receiveMessage(msg: InboundMessage): InboundResult {
    const trimmed = msg.text.trim();
    if (!trimmed) return { action: "ignored", session: this.getOrCreateSession(msg) };

    // Group mention gating: skip group messages that don't mention the bot
    if (msg.chatType === "group" && msg.isMentioned === false) {
      return { action: "ignored", session: this.getOrCreateSession(msg) };
    }

    // Check slash commands
    const slashCmd = SLASH_COMMANDS.find((cmd) => trimmed.toLowerCase().startsWith(cmd));
    if (slashCmd) {
      return this.handleSlashCommand(msg, trimmed);
    }

    return this.handleUserMessage(msg, trimmed);
  }

  receiveOnSession(
    session: SessionRecord,
    msg: { messageId: string; userId: string; text: string },
  ): InboundResult {
    const trimmed = msg.text.trim();
    if (!trimmed) return { action: "ignored", session };

    const sourceType = this.channelType as SourceType;
    const dedupeKey = `${this.channelType}:${msg.messageId}`;
    const actorType = `${this.channelType}_user` as AuditActorType;

    const { task, event } = this.sessions.createTask({
      sessionId: session.id,
      sourceType,
      sourceRef: msg.userId,
      type: "message",
      input: { text: trimmed, userId: msg.userId },
      dedupeKey,
    });

    this.messages.insert({
      sessionId: session.id,
      role: "user",
      content: trimmed,
      metadata: { userId: msg.userId, sourceType, messageId: msg.messageId },
      sourceEventId: event.id,
    });
    this.persistInitialSessionName(session.id);

    this.auditLogs.insert({
      actorType,
      actorRef: msg.userId,
      action: "message_received",
      resourceType: "task",
      resourceId: task.id,
      payload: { text: trimmed.slice(0, 200), channelType: this.channelType },
    });

    return { action: "message", session, taskId: task.id };
  }

  private handleUserMessage(msg: InboundMessage, text: string): InboundResult {
    const session = this.getOrCreateSession(msg);
    this.options.workspacePolicy.assertAllowed(session.workspacePath);

    const sourceType = this.channelType as SourceType;
    const dedupeKey = `${this.channelType}:${msg.messageId}`;
    const actorType = `${this.channelType}_user` as AuditActorType;

    const { task, event } = this.sessions.createTask({
      sessionId: session.id,
      sourceType,
      sourceRef: msg.userId,
      type: "message",
      input: { text, userId: msg.userId, chatId: msg.chatId },
      dedupeKey,
    });

    // Write message directly (no projector)
    this.messages.insert({
      sessionId: session.id,
      role: "user",
      content: text,
      metadata: { userId: msg.userId, sourceType, messageId: msg.messageId },
      sourceEventId: event.id,
    });
    this.persistInitialSessionName(session.id);

    // Enqueue outbox for non-web channels (web uses SSE directly)
    if (this.channelType !== "web") {
      // Will be enqueued after run finishes by delivery service
    }

    this.auditLogs.insert({
      actorType,
      actorRef: msg.userId,
      action: "message_received",
      resourceType: "task",
      resourceId: task.id,
      payload: { text: text.slice(0, 200), channelType: this.channelType },
    });

    return { action: "message", session, taskId: task.id };
  }

  private handleSlashCommand(msg: InboundMessage, text: string): InboundResult {
    const session = this.getOrCreateSession(msg);
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const actorType = `${this.channelType}_user` as AuditActorType;

    if (cmd === "/agent") {
      const sub = parts[1]?.toLowerCase();
      if (sub === "list") {
        // Respond with agent list via outbox
        this.enqueueTextReply(session, "Available agents: claude, codex, trae\nUse /agent use <type> to switch.");
        return { action: "command", session };
      }
      if (sub === "use" && parts[2]) {
        const agentType = parts[2].toLowerCase();
        this.agentDefaults.set({
          scopeType: "channel",
          scopeRef: `${this.channelType}:${msg.chatId}`,
          agentType,
        });
        this.auditLogs.insert({ actorType, actorRef: msg.userId, action: "agent_switched", resourceType: "session", resourceId: session.id, payload: { agentType } });
        this.enqueueTextReply(session, `Default agent set to ${agentType} for this channel.`);
        return { action: "command", session };
      }
      if (sub === "new") {
        const agentType = parts[2]?.toLowerCase();
        const newSession = this.sessions.createSession({
          title: agentType ? `New ${agentType} session` : "New session",
          agentType: agentType ?? session.agentType,
          workspacePath: session.workspacePath,
          channelType: this.channelType as any,
          channelRef: msg.chatId,
        });
        this.enqueueTextReply(newSession, `New session created: ${newSession.id}`);
        return { action: "command", session: newSession };
      }
      this.enqueueTextReply(session, "Usage:\n/agent list — show agents\n/agent use <type> — set default\n/agent new [type] — new session");
      return { action: "command", session };
    }

    if (cmd === "/context") {
      const sub = parts[1]?.toLowerCase();
      if (sub === "status") {
        const budget = this.contextBudgets.get(session.id);
        if (budget) {
          const pct = Math.round(budget.usageRatio * 100);
          this.enqueueTextReply(session, `Context: ${pct}% used (${budget.status})\nEstimate: ~${budget.tokenEstimate.toLocaleString()} / ${budget.budgetTokens.toLocaleString()} tokens`);
        } else {
          this.enqueueTextReply(session, "Context: healthy (no budget data yet)");
        }
        return { action: "command", session };
      }
      this.enqueueTextReply(session, "Usage:\n/context status — show context budget");
      return { action: "command", session };
    }

    return { action: "ignored", session };
  }

  private getOrCreateSession(msg: InboundMessage): SessionRecord {
    const existing = this.sessions.findSessionByChannel(this.channelType, msg.chatId);
    if (existing) return existing;

    // Resolve default agent
    const defaultAgent = this.agentDefaults.resolve({
      userRef: msg.userId,
      channelRef: `${this.channelType}:${msg.chatId}`,
    });

    return this.sessions.createSession({
      title: `Chat ${msg.chatId}`,
      agentType: defaultAgent?.agentType ?? "claude",
      workspacePath: process.cwd(),
      channelType: this.channelType as any,
      channelRef: msg.chatId,
    });
  }

  private enqueueTextReply(session: SessionRecord, text: string): void {
    const channelType = this.channelType as OutboxChannel;
    const kind = channelType === "web" ? "web_event" as OutboxKind : `${channelType}_markdown` as OutboxKind;
    this.outbox.enqueue({
      sessionId: session.id,
      channelType,
      targetRef: session.channelRef ?? "",
      kind,
      viewModel: { text },
      idempotencyKey: `reply:${session.id}:${Date.now()}`,
    });
  }

  private persistInitialSessionName(sessionId: string): void {
    const firstUserMessage = this.messages.getFirstUserBySession(sessionId);
    if (!firstUserMessage) return;
    this.sessions.setSessionNameIfEmpty(sessionId, summarizeSessionName(firstUserMessage.content));
  }
}

function summarizeSessionName(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= 160) return normalized;
  return `${normalized.slice(0, 157)}...`;
}
