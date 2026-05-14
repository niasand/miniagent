import { AuditLogStore, type AuditActorType } from "../audit/audit-log-store.js";
import type { SqliteDatabase } from "../db/migrate.js";
import { EventStore, type StoredEvent } from "../events/event-store.js";
import { SessionStore, type SessionRecord, type TaskRecord } from "../sessions/session-store.js";
import { nowIso } from "../../shared/time.js";
import { ContextBudgetService } from "./context-budget-service.js";
import { ContextPackStore, type ContextPackRecord } from "./context-pack-store.js";

export type RestartFromContextInput = {
  sessionId: string;
  actorType: AuditActorType;
  actorRef?: string | null;
  requestedAt?: string;
};

export type RestartFromContextResult = {
  session: SessionRecord;
  contextPack: ContextPackRecord;
  task: TaskRecord;
  event: StoredEvent;
};

export class ContextRestartService {
  private readonly auditLogs: AuditLogStore;
  private readonly budgets: ContextBudgetService;
  private readonly contextPacks: ContextPackStore;
  private readonly events: EventStore;
  private readonly sessions: SessionStore;

  constructor(private readonly db: SqliteDatabase, events = new EventStore(db)) {
    this.auditLogs = new AuditLogStore(db);
    this.budgets = new ContextBudgetService(db, events);
    this.contextPacks = new ContextPackStore(db);
    this.events = events;
    this.sessions = new SessionStore(db, events);
  }

  restart(input: RestartFromContextInput): RestartFromContextResult {
    const runRestart = this.db.transaction((request: RestartFromContextInput) => {
      const requestedAt = request.requestedAt ?? nowIso();
      const session = this.requireSession(request.sessionId);
      if (session.activeRunId) {
        throw new Error(`Session already has an active run: ${session.id}`);
      }

      const contextPack =
        this.contextPacks.getLatestReady(session.id) ??
        this.budgets.compactNow({
          sessionId: session.id,
          createdBy: request.actorType === "agent" ? "agent" : "system",
          compactedAt: requestedAt,
        }).contextPack;
      if (!contextPack) {
        throw new Error(`No ContextPack available for session: ${session.id}`);
      }

      const { task } = this.sessions.createTask({
        sessionId: session.id,
        sourceType: "system",
        type: "resume",
        targetAgentType: session.agentType,
        input: {
          contextPackId: contextPack.id,
          sourceEventStartId: contextPack.sourceEventStartId,
          sourceEventEndId: contextPack.sourceEventEndId,
          summary: contextPack.summary,
          recentMessages: contextPack.recentMessages,
          openTasks: contextPack.openTasks,
        },
        queuedAt: requestedAt,
      });

      const event = this.events.append({
        sessionId: session.id,
        taskId: task.id,
        type: "context_restart_requested",
        payload: {
          contextPackId: contextPack.id,
          taskId: task.id,
          actorType: request.actorType,
          actorRef: request.actorRef ?? null,
        },
        createdAt: requestedAt,
      });

      this.auditLogs.insert({
        actorType: request.actorType,
        actorRef: request.actorRef ?? null,
        action: "context_restart",
        resourceType: "session",
        resourceId: session.id,
        payload: {
          contextPackId: contextPack.id,
          taskId: task.id,
        },
        createdAt: requestedAt,
      });

      return { session, contextPack, task, event };
    });

    return runRestart(input);
  }

  private requireSession(sessionId: string): SessionRecord {
    const session = this.sessions.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
  }
}
