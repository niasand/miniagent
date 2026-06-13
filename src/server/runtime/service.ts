import type { SqliteDatabase } from "../db/migrate.js";
import { SessionStore } from "../stores/session-store.js";
import { EventStore } from "../stores/event-store.js";
import { AuditLogStore } from "../stores/audit-log-store.js";
import { PermissionRequestStore } from "../stores/permission-request-store.js";
import { GoalStore } from "../stores/goal-store.js";
import { RuntimeSupervisor } from "./supervisor.js";
import { RuntimeAdapterRegistry } from "./registry.js";
import { WorkspacePolicy, WorkspacePolicyError } from "../security/workspace-policy.js";
import type { KnowledgeService } from "../services/knowledge.js";
import { MemoryService } from "../services/memory.js";
import type { JsonValue } from "../../shared/json.js";

export type StartNextQueuedTaskResult = {
  task: { id: string; sessionId: string; status: string; type: string; input: unknown };
  run: { id: string; status: string };
};

export class RuntimeService {
  private readonly sessions: SessionStore;
  private readonly auditLogs: AuditLogStore;
  private readonly permissionRequests: PermissionRequestStore;
  private readonly goals: GoalStore;
  private readonly memory: MemoryService;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly supervisor: RuntimeSupervisor,
    private readonly workspacePolicy: WorkspacePolicy,
    private readonly knowledgeService?: KnowledgeService,
  ) {
    const events = new EventStore(db);
    this.sessions = new SessionStore(db, events);
    this.auditLogs = new AuditLogStore(db);
    this.permissionRequests = new PermissionRequestStore(db);
    this.goals = new GoalStore(db);
    this.memory = new MemoryService(db);
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

    const enrichedInput = this.augmentWithControlContext(session, task.input);
    const knowledgeInput = this.knowledgeService
      ? this.augmentWithKnowledge(session, enrichedInput)
      : enrichedInput;

    this.supervisor.sendInput(started.run.id, {
      taskType: task.type,
      input: knowledgeInput,
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

  private augmentWithKnowledge(
    session: { defaultParams: JsonValue },
    taskInput: JsonValue,
  ): JsonValue {
    const config = this.knowledgeService!.resolveConfig(session.defaultParams);
    if (!config.enabled) return taskInput;

    const queryText = this.knowledgeService!.extractQueryText(taskInput);
    if (!queryText) return taskInput;

    const knowledge = this.knowledgeService!.retrieve(queryText, config);
    if (!knowledge) return taskInput;

    const inputObj = taskInput && typeof taskInput === "object" && !Array.isArray(taskInput)
      ? taskInput as Record<string, unknown>
      : { text: taskInput };
    return { ...inputObj, knowledge };
  }

  private augmentWithControlContext(
    session: { id: string },
    taskInput: JsonValue,
  ): JsonValue {
    const inputObj = taskInput && typeof taskInput === "object" && !Array.isArray(taskInput)
      ? taskInput as Record<string, unknown>
      : { text: taskInput };

    const goal = this.goals.get(session.id);
    const goalContext = goal?.status === "active"
      ? {
          objective: goal.objective,
          turnCount: goal.turnCount,
          maxTurns: goal.maxTurns,
          subgoals: goal.subgoals,
        }
      : undefined;
    if (goalContext) {
      const updated = this.goals.incrementTurn(session.id);
      if (updated && updated.turnCount >= updated.maxTurns) {
        this.goals.updateStatus(session.id, "paused");
      }
    }

    const text = typeof inputObj.text === "string" ? inputObj.text : "";
    const memoryResults = text ? this.memory.search(text, { sessionId: session.id, limit: 3 }) : [];
    const memoryContext = memoryResults.length > 0 ? this.memory.formatResults(memoryResults) : undefined;

    if (!goalContext && !memoryContext) return taskInput;
    return {
      ...inputObj,
      ...(goalContext ? { activeGoal: goalContext } : {}),
      ...(memoryContext ? { memoryContext } : {}),
    };
  }
}
