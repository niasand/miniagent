import type { SqliteDatabase } from "../db/migrate.js";
import { EventStore, type StoredEvent } from "../events/event-store.js";
import { SessionStore, type TaskRecord } from "../sessions/session-store.js";

export type SendUserMessageInput = {
  sessionId: string;
  text: string;
  actorRef?: string | null;
};

export type SendUserMessageResult = {
  task: TaskRecord;
  event: StoredEvent;
};

export class UserMessageService {
  private readonly sessions: SessionStore;

  constructor(db: SqliteDatabase, events = new EventStore(db)) {
    this.sessions = new SessionStore(db, events);
  }

  send(input: SendUserMessageInput): SendUserMessageResult {
    const text = input.text.trim();
    if (!text) {
      throw new Error("Message text is required");
    }

    const session = this.sessions.getSession(input.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${input.sessionId}`);
    }
    if (session.status === "archived") {
      throw new Error(`Cannot send message to archived session: ${session.id}`);
    }

    return this.sessions.createTask({
      sessionId: session.id,
      sourceType: "web",
      sourceRef: input.actorRef ?? null,
      type: "message",
      input: { text },
    });
  }
}
