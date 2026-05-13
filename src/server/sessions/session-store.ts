import type { SqliteDatabase } from "../db/migrate.js";
import { EventStore, type StoredEvent } from "../events/event-store.js";
import { createId } from "../../shared/ids.js";
import { parseJson, stringifyJson, type JsonValue } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";

export type SessionStatus = "idle" | "running" | "compacting" | "failed" | "archived";
export type TaskStatus = "scheduled" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "paused";
export type RunStatus =
  | "queued"
  | "starting"
  | "running"
  | "waiting_permission"
  | "compacting"
  | "stopping"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "overflowed";

export type SourceType = "web" | "feishu" | "cron" | "handoff" | "mcp" | "system";
export type TaskType = "message" | "compact" | "handoff" | "schedule_run" | "stop" | "resume";

export type SessionRecord = {
  id: string;
  title: string;
  agentType: string;
  workspacePath: string;
  status: SessionStatus;
  channelType: string | null;
  channelRef: string | null;
  defaultParams: JsonValue;
  activeRunId: string | null;
  currentContextPackId: string | null;
  sourceSessionId: string | null;
  sourceContextPackId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type TaskRecord = {
  id: string;
  sessionId: string | null;
  sourceType: SourceType;
  sourceRef: string | null;
  type: TaskType;
  status: TaskStatus;
  targetAgentType: string | null;
  input: JsonValue;
  dedupeKey: string | null;
  runId: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentRunRecord = {
  id: string;
  sessionId: string;
  taskId: string | null;
  agentType: string;
  status: RunStatus;
  launchSpec: JsonValue;
  pid: number | null;
  contextPackId: string | null;
  firstGlobalSeq: number | null;
  lastGlobalSeq: number | null;
  heartbeatAt: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  exitCode: number | null;
  stopReason: string | null;
  errorClass: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateSessionInput = {
  id?: string;
  title: string;
  agentType: string;
  workspacePath: string;
  channelType?: "web" | "feishu" | null;
  channelRef?: string | null;
  defaultParams?: JsonValue;
  sourceSessionId?: string | null;
  sourceContextPackId?: string | null;
};

export type CreateTaskInput = {
  id?: string;
  sessionId: string;
  sourceType: SourceType;
  sourceRef?: string | null;
  type: TaskType;
  targetAgentType?: string | null;
  input?: JsonValue;
  dedupeKey?: string | null;
  queuedAt?: string | null;
};

export type StartRunInput = {
  id?: string;
  sessionId: string;
  taskId: string;
  agentType?: string;
  launchSpec?: JsonValue;
  pid?: number | null;
  contextPackId?: string | null;
  startedAt?: string;
};

export type FinishRunInput = {
  runId: string;
  status: Extract<RunStatus, "succeeded" | "failed" | "cancelled" | "overflowed">;
  exitCode?: number | null;
  stopReason?: string | null;
  errorClass?: string | null;
  stoppedAt?: string;
};

type SessionRow = {
  id: string;
  title: string;
  agent_type: string;
  workspace_path: string;
  status: SessionStatus;
  channel_type: string | null;
  channel_ref: string | null;
  default_params_json: string;
  active_run_id: string | null;
  current_context_pack_id: string | null;
  source_session_id: string | null;
  source_context_pack_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type TaskRow = {
  id: string;
  session_id: string | null;
  source_type: SourceType;
  source_ref: string | null;
  type: TaskType;
  status: TaskStatus;
  target_agent_type: string | null;
  input_json: string;
  dedupe_key: string | null;
  run_id: string | null;
  queued_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

type AgentRunRow = {
  id: string;
  session_id: string;
  task_id: string | null;
  agent_type: string;
  status: RunStatus;
  launch_spec_json: string;
  pid: number | null;
  context_pack_id: string | null;
  first_global_seq: number | null;
  last_global_seq: number | null;
  heartbeat_at: string | null;
  started_at: string | null;
  stopped_at: string | null;
  exit_code: number | null;
  stop_reason: string | null;
  error_class: string | null;
  created_at: string;
  updated_at: string;
};

export class SessionStore {
  private readonly events: EventStore;

  constructor(private readonly db: SqliteDatabase, events = new EventStore(db)) {
    this.events = events;
  }

  createSession(input: CreateSessionInput): SessionRecord {
    const timestamp = nowIso();
    const row = this.db
      .prepare(
        `
        INSERT INTO sessions (
          id, title, agent_type, workspace_path, status, channel_type, channel_ref,
          default_params_json, source_session_id, source_context_pack_id, created_at, updated_at
        )
        VALUES (
          @id, @title, @agentType, @workspacePath, 'idle', @channelType, @channelRef,
          @defaultParamsJson, @sourceSessionId, @sourceContextPackId, @createdAt, @updatedAt
        )
        RETURNING *
      `,
      )
      .get({
        id: input.id ?? createId("ses"),
        title: input.title,
        agentType: input.agentType,
        workspacePath: input.workspacePath,
        channelType: input.channelType ?? null,
        channelRef: input.channelRef ?? null,
        defaultParamsJson: stringifyJson(input.defaultParams ?? {}),
        sourceSessionId: input.sourceSessionId ?? null,
        sourceContextPackId: input.sourceContextPackId ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }) as SessionRow;

    return mapSessionRow(row);
  }

  createTask(input: CreateTaskInput): { task: TaskRecord; event: StoredEvent } {
    const create = this.db.transaction((taskInput: CreateTaskInput) => {
      const timestamp = nowIso();
      const task = this.insertTask(taskInput, timestamp);
      const event = this.events.append({
        sessionId: taskInput.sessionId,
        taskId: task.id,
        type: "task_created",
        payload: {
          sourceType: task.sourceType,
          sourceRef: task.sourceRef,
          taskType: task.type,
          targetAgentType: task.targetAgentType,
          input: task.input,
          dedupeKey: task.dedupeKey,
        },
        createdAt: timestamp,
      });

      return { task, event };
    });

    return create(input);
  }

  startRun(input: StartRunInput): { run: AgentRunRecord; event: StoredEvent } {
    const start = this.db.transaction((runInput: StartRunInput) => {
      const session = this.requireSession(runInput.sessionId);
      if (session.status === "archived") {
        throw new Error(`Cannot start run for archived session: ${session.id}`);
      }

      const task = this.requireTask(runInput.taskId);
      if (task.sessionId !== session.id) {
        throw new Error(`Task ${task.id} does not belong to session ${session.id}`);
      }
      if (task.runId) {
        throw new Error(`Task already has a run: ${task.id}`);
      }

      const timestamp = runInput.startedAt ?? nowIso();
      const agentType = runInput.agentType ?? session.agentType;
      const runId = runInput.id ?? createId("run");

      this.db
        .prepare(
          `
          INSERT INTO agent_runs (
            id, session_id, task_id, agent_type, status, launch_spec_json, pid,
            context_pack_id, heartbeat_at, started_at, created_at, updated_at
          )
          VALUES (
            @id, @sessionId, @taskId, @agentType, 'running', @launchSpecJson, @pid,
            @contextPackId, @heartbeatAt, @startedAt, @createdAt, @updatedAt
          )
        `,
        )
        .run({
          id: runId,
          sessionId: session.id,
          taskId: task.id,
          agentType,
          launchSpecJson: stringifyJson(runInput.launchSpec ?? {}),
          pid: runInput.pid ?? null,
          contextPackId: runInput.contextPackId ?? null,
          heartbeatAt: timestamp,
          startedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

      const event = this.events.append({
        sessionId: session.id,
        runId,
        taskId: task.id,
        type: "run_started",
        payload: {
          agentType,
          launchSpec: runInput.launchSpec ?? {},
          pid: runInput.pid ?? null,
          contextPackId: runInput.contextPackId ?? null,
        },
        createdAt: timestamp,
      });

      this.db
        .prepare(
          `
          UPDATE agent_runs
          SET first_global_seq = @globalSeq, last_global_seq = @globalSeq, updated_at = @updatedAt
          WHERE id = @runId
        `,
        )
        .run({ runId, globalSeq: event.globalSeq, updatedAt: timestamp });

      this.db
        .prepare(
          `
          UPDATE tasks
          SET status = 'running', run_id = @runId, started_at = @startedAt, updated_at = @updatedAt
          WHERE id = @taskId
        `,
        )
        .run({ taskId: task.id, runId, startedAt: timestamp, updatedAt: timestamp });

      this.db
        .prepare(
          `
          UPDATE sessions
          SET status = 'running', active_run_id = @runId, updated_at = @updatedAt
          WHERE id = @sessionId
        `,
        )
        .run({ sessionId: session.id, runId, updatedAt: timestamp });

      return { run: this.requireRun(runId), event };
    });

    return start(input);
  }

  finishRun(input: FinishRunInput): { run: AgentRunRecord; event: StoredEvent } {
    const finish = this.db.transaction((finishInput: FinishRunInput) => {
      const run = this.requireRun(finishInput.runId);
      if (isTerminalRunStatus(run.status)) {
        throw new Error(`Run is already terminal: ${run.id}`);
      }

      const timestamp = finishInput.stoppedAt ?? nowIso();
      const eventType =
        finishInput.status === "succeeded" || finishInput.status === "cancelled" ? "run_finished" : "run_failed";
      const event = this.events.append({
        sessionId: run.sessionId,
        runId: run.id,
        taskId: run.taskId,
        type: eventType,
        payload: {
          status: finishInput.status,
          exitCode: finishInput.exitCode ?? null,
          stopReason: finishInput.stopReason ?? null,
          errorClass: finishInput.errorClass ?? null,
        },
        createdAt: timestamp,
      });

      this.db
        .prepare(
          `
          UPDATE agent_runs
          SET
            status = @status,
            last_global_seq = @lastGlobalSeq,
            stopped_at = @stoppedAt,
            exit_code = @exitCode,
            stop_reason = @stopReason,
            error_class = @errorClass,
            updated_at = @updatedAt
          WHERE id = @runId
        `,
        )
        .run({
          runId: run.id,
          status: finishInput.status,
          lastGlobalSeq: event.globalSeq,
          stoppedAt: timestamp,
          exitCode: finishInput.exitCode ?? null,
          stopReason: finishInput.stopReason ?? null,
          errorClass: finishInput.errorClass ?? null,
          updatedAt: timestamp,
        });

      if (run.taskId) {
        this.db
          .prepare(
            `
            UPDATE tasks
            SET status = @status, finished_at = @finishedAt, updated_at = @updatedAt
            WHERE id = @taskId
          `,
          )
          .run({
            taskId: run.taskId,
            status: mapRunStatusToTaskStatus(finishInput.status),
            finishedAt: timestamp,
            updatedAt: timestamp,
          });
      }

      this.db
        .prepare(
          `
          UPDATE sessions
          SET
            status = @status,
            active_run_id = CASE WHEN active_run_id = @runId THEN NULL ELSE active_run_id END,
            updated_at = @updatedAt
          WHERE id = @sessionId
        `,
        )
        .run({
          sessionId: run.sessionId,
          runId: run.id,
          status: mapRunStatusToSessionStatus(finishInput.status),
          updatedAt: timestamp,
        });

      return { run: this.requireRun(run.id), event };
    });

    return finish(input);
  }

  updateRunProcess(runId: string, pid: number | null, heartbeatAt = nowIso()): AgentRunRecord {
    this.db
      .prepare(
        `
        UPDATE agent_runs
        SET pid = @pid, heartbeat_at = @heartbeatAt, updated_at = @updatedAt
        WHERE id = @runId
      `,
      )
      .run({ runId, pid, heartbeatAt, updatedAt: heartbeatAt });

    return this.requireRun(runId);
  }

  getSession(id: string): SessionRecord | null {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
    return row ? mapSessionRow(row) : null;
  }

  getTask(id: string): TaskRecord | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
    return row ? mapTaskRow(row) : null;
  }

  getRun(id: string): AgentRunRecord | null {
    const row = this.db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id) as AgentRunRow | undefined;
    return row ? mapAgentRunRow(row) : null;
  }

  private insertTask(input: CreateTaskInput, timestamp: string): TaskRecord {
    const row = this.db
      .prepare(
        `
        INSERT INTO tasks (
          id, session_id, source_type, source_ref, type, status, target_agent_type,
          input_json, dedupe_key, queued_at, created_at, updated_at
        )
        VALUES (
          @id, @sessionId, @sourceType, @sourceRef, @type, 'queued', @targetAgentType,
          @inputJson, @dedupeKey, @queuedAt, @createdAt, @updatedAt
        )
        RETURNING *
      `,
      )
      .get({
        id: input.id ?? createId("tsk"),
        sessionId: input.sessionId,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef ?? null,
        type: input.type,
        targetAgentType: input.targetAgentType ?? null,
        inputJson: stringifyJson(input.input ?? {}),
        dedupeKey: input.dedupeKey ?? null,
        queuedAt: input.queuedAt ?? timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      }) as TaskRow;

    return mapTaskRow(row);
  }

  private requireSession(id: string): SessionRecord {
    const session = this.getSession(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }
    return session;
  }

  private requireTask(id: string): TaskRecord {
    const task = this.getTask(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }
    return task;
  }

  private requireRun(id: string): AgentRunRecord {
    const run = this.getRun(id);
    if (!run) {
      throw new Error(`Run not found: ${id}`);
    }
    return run;
  }
}

function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "overflowed";
}

function mapRunStatusToTaskStatus(status: FinishRunInput["status"]): TaskStatus {
  if (status === "succeeded") {
    return "succeeded";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return "failed";
}

function mapRunStatusToSessionStatus(status: FinishRunInput["status"]): SessionStatus {
  if (status === "failed") {
    return "failed";
  }
  if (status === "overflowed") {
    return "compacting";
  }
  return "idle";
}

function mapSessionRow(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    title: row.title,
    agentType: row.agent_type,
    workspacePath: row.workspace_path,
    status: row.status,
    channelType: row.channel_type,
    channelRef: row.channel_ref,
    defaultParams: parseJson(row.default_params_json),
    activeRunId: row.active_run_id,
    currentContextPackId: row.current_context_pack_id,
    sourceSessionId: row.source_session_id,
    sourceContextPackId: row.source_context_pack_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function mapTaskRow(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    type: row.type,
    status: row.status,
    targetAgentType: row.target_agent_type,
    input: parseJson(row.input_json),
    dedupeKey: row.dedupe_key,
    runId: row.run_id,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentRunRow(row: AgentRunRow): AgentRunRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    taskId: row.task_id,
    agentType: row.agent_type,
    status: row.status,
    launchSpec: parseJson(row.launch_spec_json),
    pid: row.pid,
    contextPackId: row.context_pack_id,
    firstGlobalSeq: row.first_global_seq,
    lastGlobalSeq: row.last_global_seq,
    heartbeatAt: row.heartbeat_at,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    exitCode: row.exit_code,
    stopReason: row.stop_reason,
    errorClass: row.error_class,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
