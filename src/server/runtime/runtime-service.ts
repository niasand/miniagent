import type { SqliteDatabase } from "../db/migrate.js";
import { EventStore } from "../events/event-store.js";
import { SessionStore, type AgentRunRecord, type TaskRecord } from "../sessions/session-store.js";
import { RuntimeSupervisor } from "./runtime-supervisor.js";

export type StartNextQueuedTaskResult = {
  task: TaskRecord;
  run: AgentRunRecord;
};

export class RuntimeService {
  private readonly sessions: SessionStore;

  constructor(
    db: SqliteDatabase,
    private readonly supervisor: RuntimeSupervisor,
  ) {
    this.sessions = new SessionStore(db, new EventStore(db));
  }

  startNextQueuedTask(sessionId: string): StartNextQueuedTaskResult {
    const session = this.sessions.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (session.activeRunId) {
      throw new Error(`Session already has an active run: ${session.id}`);
    }

    const task = this.sessions.getNextQueuedTask(session.id);
    if (!task) {
      throw new Error(`No queued task for session: ${session.id}`);
    }

    const started = this.supervisor.startTask({
      sessionId: session.id,
      taskId: task.id,
    });
    this.supervisor.sendInput(started.run.id, {
      taskType: task.type,
      input: task.input,
    });

    return {
      task,
      run: this.sessions.getRun(started.run.id) ?? started.run,
    };
  }
}
