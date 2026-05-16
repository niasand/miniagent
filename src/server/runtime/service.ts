import type { SqliteDatabase } from "../db/migrate.js";
import { SessionStore } from "../stores/session-store.js";
import { EventStore } from "../stores/event-store.js";
import { AuditLogStore } from "../stores/audit-log-store.js";
import { PermissionRequestStore } from "../stores/permission-request-store.js";
import { RuntimeSupervisor } from "./supervisor.js";
import { RuntimeAdapterRegistry } from "./registry.js";
import { WorkspacePolicy, WorkspacePolicyError } from "../security/workspace-policy.js";

export type StartNextQueuedTaskResult = {
  task: { id: string; sessionId: string; status: string; type: string; input: unknown };
  run: { id: string; status: string };
};

export class RuntimeService {
  private readonly sessions: SessionStore;
  private readonly auditLogs: AuditLogStore;
  private readonly permissionRequests: PermissionRequestStore;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly supervisor: RuntimeSupervisor,
    private readonly workspacePolicy: WorkspacePolicy,
  ) {
    const events = new EventStore(db);
    this.sessions = new SessionStore(db, events);
    this.auditLogs = new AuditLogStore(db);
    this.permissionRequests = new PermissionRequestStore(db);
  }

  startNextQueuedTask(sessionId: string): StartNextQueuedTaskResult | null {
    const session = this.sessions.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.activeRunId) return null; // already running

    try {
      this.workspacePolicy.assertAllowed(session.workspacePath);
    } catch (error) {
      if (error instanceof WorkspacePolicyError) {
        this.auditLogs.insert({
          actorType: "system",
          action: "workspace_denied",
          resourceType: "session",
          resourceId: session.id,
          payload: { workspacePath: error.workspacePath, reason: error.reason },
        });
      }
      throw error;
    }

    const task = this.sessions.getNextQueuedTask(session.id);
    if (!task) return null;

    const started = this.supervisor.startTask({
      sessionId: session.id,
      taskId: task.id,
    });

    this.supervisor.sendInput(started.run.id, {
      taskType: task.type,
      input: task.input,
    });

    return {
      task: {
        id: task.id,
        sessionId: task.sessionId ?? session.id,
        status: task.status,
        type: task.type,
        input: task.input,
      },
      run: { id: started.run.id, status: started.run.status },
    };
  }
}
