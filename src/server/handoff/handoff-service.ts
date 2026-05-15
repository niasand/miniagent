import type { SqliteDatabase } from "../db/migrate.js";
import { AuditLogStore, type AuditActorType } from "../audit/audit-log-store.js";
import { ContextPackService } from "../context/context-pack-service.js";
import { ContextPackStore, type ContextPackRecord } from "../context/context-pack-store.js";
import { EventStore, type StoredEvent } from "../events/event-store.js";
import { SessionStore, type SessionRecord, type TaskRecord } from "../sessions/session-store.js";
import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import type { AgentType } from "../runtime/types.js";

export type HandoffInput = {
  sourceSessionId: string;
  targetAgentType: AgentType;
  actorType: AuditActorType;
  actorRef?: string | null;
  targetTitle?: string;
  createdAt?: string;
};

export type HandoffResult = {
  sourceSession: SessionRecord;
  targetSession: SessionRecord;
  task: TaskRecord;
  contextPack: ContextPackRecord;
  requestedEvent: StoredEvent;
  createdEvent: StoredEvent;
};

export class HandoffService {
  private readonly auditLogs: AuditLogStore;
  private readonly contextPackService: ContextPackService;
  private readonly contextPacks: ContextPackStore;
  private readonly events: EventStore;
  private readonly sessions: SessionStore;

  constructor(private readonly db: SqliteDatabase, events = new EventStore(db)) {
    this.auditLogs = new AuditLogStore(db);
    this.contextPackService = new ContextPackService(db, events);
    this.contextPacks = new ContextPackStore(db);
    this.events = events;
    this.sessions = new SessionStore(db, events);
  }

  handoff(input: HandoffInput): HandoffResult {
    const runHandoff = this.db.transaction((request: HandoffInput) => {
      const timestamp = request.createdAt ?? nowIso();
      const sourceSession = this.requireSession(request.sourceSessionId);
      if (sourceSession.agentType === request.targetAgentType) {
        throw new Error("Handoff target agent must differ from source session agent");
      }

      const requestedEvent = this.events.append({
        sessionId: sourceSession.id,
        type: "handoff_requested",
        payload: {
          sourceSessionId: sourceSession.id,
          sourceAgentType: sourceSession.agentType,
          targetAgentType: request.targetAgentType,
          actorType: request.actorType,
          actorRef: request.actorRef ?? null,
        },
        createdAt: timestamp,
      });

      const contextPack =
        this.contextPacks.getLatestReady(sourceSession.id) ??
        this.contextPackService.createFromEvents({
          sessionId: sourceSession.id,
          createdBy: request.actorType === "agent" ? "agent" : "system",
          strategy: "miniagent_summary",
          createdAt: timestamp,
        }).contextPack;

      const targetSession = this.sessions.createSession({
        id: createId("ses"),
        title: request.targetTitle ?? sourceSession.title,
        agentType: request.targetAgentType,
        workspacePath: sourceSession.workspacePath,
        channelType: sourceSession.channelType === "web" || sourceSession.channelType === "feishu" ? sourceSession.channelType : null,
        channelRef: sourceSession.channelRef,
        defaultParams: sourceSession.defaultParams,
        sourceSessionId: sourceSession.id,
        sourceContextPackId: contextPack.id,
      });

      const { task } = this.sessions.createTask({
        id: createId("tsk"),
        sessionId: targetSession.id,
        sourceType: "handoff",
        sourceRef: requestedEvent.id,
        type: "handoff",
        targetAgentType: request.targetAgentType,
        input: {
          sourceSessionId: sourceSession.id,
          sourceContextPackId: contextPack.id,
          targetAgentType: request.targetAgentType,
        },
      });

      const createdEvent = this.events.append({
        sessionId: sourceSession.id,
        type: "handoff_created",
        causationId: requestedEvent.id,
        payload: {
          sourceSessionId: sourceSession.id,
          targetSessionId: targetSession.id,
          targetTaskId: task.id,
          sourceContextPackId: contextPack.id,
          targetAgentType: request.targetAgentType,
        },
        createdAt: timestamp,
      });

      this.auditLogs.insert({
        actorType: request.actorType,
        actorRef: request.actorRef ?? null,
        action: "handoff",
        resourceType: "session",
        resourceId: sourceSession.id,
        payload: {
          targetSessionId: targetSession.id,
          targetTaskId: task.id,
          sourceContextPackId: contextPack.id,
          targetAgentType: request.targetAgentType,
        },
        createdAt: timestamp,
      });

      return {
        sourceSession,
        targetSession,
        task,
        contextPack,
        requestedEvent,
        createdEvent,
      };
    });

    return runHandoff(input);
  }

  private requireSession(id: string): SessionRecord {
    const session = this.sessions.getSession(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }
    return session;
  }
}
