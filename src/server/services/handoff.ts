import type { SqliteDatabase } from "../db/migrate.js";
import { SessionStore } from "../stores/session-store.js";
import { EventStore } from "../stores/event-store.js";
import { ContextPackStore } from "../stores/context-pack-store.js";
import type { AgentType } from "../runtime/types.js";

export class HandoffService {
  private sessions: SessionStore;
  private events: EventStore;
  private contextPacks: ContextPackStore;

  constructor(private readonly db: SqliteDatabase) {
    this.events = new EventStore(db);
    this.sessions = new SessionStore(db, this.events);
    this.contextPacks = new ContextPackStore(db);
  }

  handoff(input: {
    sourceSessionId: string;
    targetAgentType: AgentType;
    targetTitle?: string;
    actorType?: string;
    actorRef?: string;
  }): { targetSessionId: string; targetTaskId: string; sourceContextPackId: string; eventId: string } {
    const source = this.sessions.getSession(input.sourceSessionId);
    if (!source) throw new Error(`Source session not found: ${input.sourceSessionId}`);

    // Create context pack from source
    const sourceEvents = this.events.listAfterGlobalSeq({ sessionId: source.id, afterGlobalSeq: 0, limit: 500 });
    const pack = this.contextPacks.create({
      sessionId: source.id,
      sourceEventStartId: sourceEvents[0]?.id ?? "",
      sourceEventEndId: sourceEvents[sourceEvents.length - 1]?.id ?? "",
      tokenEstimate: Math.round(sourceEvents.length * 50),
      summary: { sourceAgent: source.agentType, sourceTitle: source.title },
      createdBy: "user",
      strategy: "miniagent_summary",
    });

    // Create target session
    const target = this.sessions.createSession({
      title: input.targetTitle ?? `Handoff: ${source.title}`,
      agentType: input.targetAgentType,
      workspacePath: source.workspacePath,
      channelType: source.channelType as any,
      channelRef: source.channelRef,
      sourceSessionId: source.id,
      sourceContextPackId: pack.id,
    });

    // Create task in target session
    const { task, event } = this.sessions.createTask({
      sessionId: target.id,
      sourceType: "handoff",
      type: "message",
      input: { handoffFrom: source.agentType, contextPackId: pack.id },
    });

    return {
      targetSessionId: target.id,
      targetTaskId: task.id,
      sourceContextPackId: pack.id,
      eventId: event.id,
    };
  }
}
