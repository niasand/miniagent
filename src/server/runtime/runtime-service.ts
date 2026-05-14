import type { SqliteDatabase } from "../db/migrate.js";
import { AuditLogStore } from "../audit/audit-log-store.js";
import { EventStore } from "../events/event-store.js";
import { WorkspacePolicy, WorkspacePolicyError } from "../security/workspace-policy.js";
import { SessionStore, type AgentRunRecord, type TaskRecord } from "../sessions/session-store.js";
import { RuntimeSupervisor } from "./runtime-supervisor.js";

export type StartNextQueuedTaskResult = {
  task: TaskRecord;
  run: AgentRunRecord;
};

export class RuntimeService {
  private readonly auditLogs: AuditLogStore;
  private readonly sessions: SessionStore;

  constructor(
    db: SqliteDatabase,
    private readonly supervisor: RuntimeSupervisor,
    private readonly workspacePolicy = WorkspacePolicy.fromEnvironment([process.cwd()]),
  ) {
    this.auditLogs = new AuditLogStore(db);
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
    try {
      this.workspacePolicy.assertAllowed(session.workspacePath);
    } catch (error) {
      if (error instanceof WorkspacePolicyError) {
        this.auditLogs.insert({
          actorType: "system",
          action: "workspace_denied",
          resourceType: "session",
          resourceId: session.id,
          payload: {
            workspacePath: error.workspacePath,
            normalizedPath: error.normalizedPath,
            reason: error.reason,
            allowlist: error.allowlist,
          },
        });
      }
      throw error;
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
