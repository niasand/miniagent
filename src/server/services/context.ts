import type { SqliteDatabase } from "../db/migrate.js";
import { SessionStore } from "../stores/session-store.js";
import { EventStore } from "../stores/event-store.js";
import { ContextBudgetStore } from "../stores/context-budget-store.js";
import { ContextPackStore } from "../stores/context-pack-store.js";
import { MessageStore } from "../stores/message-store.js";

export class ContextService {
  private sessions: SessionStore;
  private events: EventStore;
  private contextBudgets: ContextBudgetStore;
  private contextPacks: ContextPackStore;
  private messages: MessageStore;

  constructor(private readonly db: SqliteDatabase) {
    this.events = new EventStore(db);
    this.sessions = new SessionStore(db, this.events);
    this.contextBudgets = new ContextBudgetStore(db);
    this.contextPacks = new ContextPackStore(db);
    this.messages = new MessageStore(db);
  }

  compact(sessionId: string, options?: { budgetTokens?: number }): { contextPackId: string; eventId: string } {
    const session = this.sessions.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    // Get recent events for the session
    const events = this.events.listAfterGlobalSeq({ sessionId, afterGlobalSeq: 0, limit: 500 });
    const msgs = this.messages.getLatestBySession(sessionId, 50);

    // Create a context pack summary
    const budgetTokens = options?.budgetTokens ?? 200_000;
    const tokenEstimate = Math.round(events.length * 50); // rough estimate

    const pack = this.contextPacks.create({
      sessionId,
      sourceEventStartId: events[0]?.id ?? "",
      sourceEventEndId: events[events.length - 1]?.id ?? "",
      tokenEstimate,
      summary: { eventCount: events.length, messageCount: msgs.length },
      recentMessages: msgs.map((m) => ({ role: m.role, content: m.content.slice(0, 200) })),
      createdBy: "system",
      strategy: "miniagent_summary",
    });

    // Update budget
    this.contextBudgets.setCompacted(sessionId, pack.id, Math.round(tokenEstimate * 0.3));
    this.sessions.setCurrentContextPack(sessionId, pack.id);

    const event = this.events.append({
      sessionId,
      type: "context_compacted",
      payload: { contextPackId: pack.id, tokenEstimate },
    });

    return { contextPackId: pack.id, eventId: event.id };
  }

  restart(sessionId: string, options?: { actorType?: string; actorRef?: string }): { contextPackId: string; taskId: string; eventId: string } {
    const session = this.sessions.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const budget = this.contextBudgets.get(sessionId);
    const contextPackId = budget?.currentContextPackId;

    const { task, event } = this.sessions.createTask({
      sessionId,
      sourceType: "system",
      type: "resume",
      input: { contextPackId: contextPackId ?? null, reason: "context_restart" } as any,
    });

    return { contextPackId: contextPackId ?? "", taskId: task.id, eventId: event.id };
  }

  getBudget(sessionId: string) {
    return this.contextBudgets.get(sessionId);
  }
}
