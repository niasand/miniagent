import type { SqliteDatabase } from "../db/migrate.js";
import { EventStore, type StoredEvent } from "./event-store.js";
import { createId } from "../../shared/ids.js";
import { parseJson, stringifyJson, type JsonObject, type JsonValue } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";

export type SessionStatus = "idle" | "running" | "compacting" | "failed" | "archived";
export type TaskStatus = "scheduled" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "paused";
export type RunStatus =
  | "queued" | "starting" | "running" | "waiting_permission" | "compacting"
  | "stopping" | "succeeded" | "failed" | "cancelled" | "overflowed";
export type SourceType = "web" | "feishu" | "qq" | "telegram" | "discord" | "wechat" | "wecom" | "dingtalk" | "cron" | "handoff" | "mcp" | "system";
export type TaskType = "message" | "compact" | "handoff" | "schedule_run" | "stop" | "resume";
export type RuntimeKind = "cli" | "acp";

export type SessionRecord = {
  id: string;
  name: string;
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
  runtimeKind: RuntimeKind;
  externalSessionId: string | null;
  checkpointId: string | null;
  protocolState: JsonValue;
  cancelState: string | null;
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
  name?: string;
  title: string;
  agentType: string;
  workspacePath: string;
  channelType?: "web" | "feishu" | "qq" | "telegram" | "discord" | null;
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
  runtimeKind?: RuntimeKind;
  externalSessionId?: string | null;
  checkpointId?: string | null;
  protocolState?: JsonValue;
  cancelState?: string | null;
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
  inputTokens?: number;
  outputTokens?: number;
};

export type RuntimeProtocolStateUpdate = {
  protocolState?: Record<string, unknown> | null;
  externalSessionId?: string | null;
  checkpointId?: string | null;
  cancelState?: string | null;
};

// Internal row types
type SessionRow = {
  id: string; name: string; title: string; agent_type: string; workspace_path: string;
  status: SessionStatus; channel_type: string | null; channel_ref: string | null;
  default_params_json: string; active_run_id: string | null;
  current_context_pack_id: string | null; source_session_id: string | null;
  source_context_pack_id: string | null; created_at: string; updated_at: string;
  archived_at: string | null;
};

type TaskRow = {
  id: string; session_id: string | null; source_type: SourceType;
  source_ref: string | null; type: TaskType; status: TaskStatus;
  target_agent_type: string | null; input_json: string; dedupe_key: string | null;
  run_id: string | null; queued_at: string | null; started_at: string | null;
  finished_at: string | null; created_at: string; updated_at: string;
};

type AgentRunRow = {
  id: string; session_id: string; task_id: string | null; agent_type: string;
  status: RunStatus; launch_spec_json: string; pid: number | null;
  runtime_kind: RuntimeKind; external_session_id: string | null;
  checkpoint_id: string | null; protocol_state_json: string;
  cancel_state: string | null; context_pack_id: string | null;
  first_global_seq: number | null; last_global_seq: number | null;
  heartbeat_at: string | null; started_at: string | null; stopped_at: string | null;
  exit_code: number | null; stop_reason: string | null; error_class: string | null;
  created_at: string; updated_at: string;
};

export class SessionStore {
  private readonly events: EventStore;

  constructor(private readonly db: SqliteDatabase, events?: EventStore) {
    this.events = events ?? new EventStore(db);
  }

  // ── Startup recovery ──

  /** Mark orphaned "running" runs as failed (process died with the old API instance). */
  recoverZombieRuns(): number {
    const timestamp = nowIso();
    const tx = this.db.transaction(() => {
      // 1. Find all runs still marked as running
      const zombieRuns = this.db.prepare(
        "SELECT id, session_id, task_id FROM agent_runs WHERE status = 'running'"
      ).all() as Array<{ id: string; session_id: string; task_id: string | null }>;

      for (const run of zombieRuns) {
        // Append a run_failed event so the event log stays consistent
        this.events.append({
          sessionId: run.session_id, runId: run.id, taskId: run.task_id,
          type: "run_failed",
          payload: {
            status: "failed",
            exitCode: -1,
            stopReason: "api_restart",
            errorClass: null,
            inputTokens: null,
            outputTokens: null,
          },
          createdAt: timestamp,
        });

        // Mark run as failed
        this.db.prepare(
          `UPDATE agent_runs SET status = 'failed', stopped_at = @ts, exit_code = -1,
            stop_reason = 'api_restart', updated_at = @ts WHERE id = @id`
        ).run({ id: run.id, ts: timestamp });

        // Mark its task as failed
        if (run.task_id) {
          this.db.prepare(
            "UPDATE tasks SET status = 'failed', finished_at = @ts, updated_at = @ts WHERE id = @id"
          ).run({ id: run.task_id, ts: timestamp });
        }

        // Clear session's active_run_id and reset to idle
        this.db.prepare(
          `UPDATE sessions SET status = 'idle', active_run_id = NULL, updated_at = @ts WHERE id = @id`
        ).run({ id: run.session_id, ts: timestamp });
      }

      return zombieRuns.length;
    });

    const count = tx();
    console.log(`[Recovery] Zombie run check: ${count} cleaned`);
    return count;
  }

  // ── Session CRUD ──

  createSession(input: CreateSessionInput): SessionRecord {
    const timestamp = nowIso();
    const row = this.db.prepare(
      `INSERT INTO sessions (id, name, title, agent_type, workspace_path, status, channel_type, channel_ref,
        default_params_json, source_session_id, source_context_pack_id, created_at, updated_at)
       VALUES (@id, @name, @title, @agentType, @workspacePath, 'idle', @channelType, @channelRef,
        @defaultParamsJson, @sourceSessionId, @sourceContextPackId, @createdAt, @updatedAt)
       RETURNING *`
    ).get({
      id: input.id ?? createId("ses"),
      name: normalizeSessionName(input.name ?? ""),
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

  getSession(id: string): SessionRecord | null {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
    return row ? mapSessionRow(row) : null;
  }

  updateSessionName(sessionId: string, name: string): SessionRecord {
    const cleanName = normalizeSessionName(name);
    if (!cleanName) throw new Error("Session name is required");

    const now = nowIso();
    const result = this.db.prepare(
      "UPDATE sessions SET name = @name, updated_at = @updatedAt WHERE id = @sessionId"
    ).run({ sessionId, name: cleanName, updatedAt: now });
    if (result.changes === 0) throw new Error(`Session not found: ${sessionId}`);
    return this.requireSession(sessionId);
  }

  setSessionNameIfEmpty(sessionId: string, name: string): SessionRecord {
    const cleanName = normalizeSessionName(name);
    if (!cleanName) return this.requireSession(sessionId);

    const now = nowIso();
    this.db.prepare(
      "UPDATE sessions SET name = @name, updated_at = @updatedAt WHERE id = @sessionId AND trim(name) = ''"
    ).run({ sessionId, name: cleanName, updatedAt: now });
    return this.requireSession(sessionId);
  }

  listSessions(limit = 50): SessionRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM sessions WHERE status != 'archived' ORDER BY updated_at DESC, id DESC LIMIT ?"
    ).all(limit) as SessionRow[];
    return rows.map(mapSessionRow);
  }

  listSessionsFiltered(options: {
    excludeCronOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {}): { sessions: SessionRecord[]; total: number } {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const cronFilter = options.excludeCronOnly
      ? `AND NOT EXISTS (
          SELECT 1 FROM (
            SELECT session_id FROM tasks WHERE session_id = s.id
            GROUP BY session_id
            HAVING COUNT(*) > 0 AND COUNT(*) = SUM(CASE WHEN source_type = 'cron' THEN 1 ELSE 0 END)
          )
        )`
      : "";

    const countRow = this.db.prepare(
      `SELECT COUNT(*) AS total FROM sessions s WHERE status != 'archived' ${cronFilter}`
    ).get() as { total: number };

    const rows = this.db.prepare(
      `SELECT s.* FROM sessions s WHERE status != 'archived' ${cronFilter}
       ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`
    ).all(limit, offset) as SessionRow[];

    return { sessions: rows.map(mapSessionRow), total: countRow.total };
  }

  findSessionByChannel(channelType: string, channelRef: string): SessionRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM sessions WHERE channel_type = ? AND channel_ref = ? AND status != 'archived' ORDER BY updated_at DESC LIMIT 1"
    ).get(channelType, channelRef) as SessionRow | undefined;
    return row ? mapSessionRow(row) : null;
  }

  setCurrentContextPack(sessionId: string, contextPackId: string): SessionRecord {
    const now = nowIso();
    this.db.prepare(
      "UPDATE sessions SET current_context_pack_id = @contextPackId, updated_at = @updatedAt WHERE id = @sessionId"
    ).run({ sessionId, contextPackId, updatedAt: now });
    return this.requireSession(sessionId);
  }

  // ── Task CRUD ──

  createTask(input: CreateTaskInput): { task: TaskRecord; event: StoredEvent } {
    const tx = this.db.transaction(() => {
      const timestamp = nowIso();
      const task = this.insertTask(input, timestamp);
      const event = this.events.append({
        sessionId: input.sessionId,
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
    return tx();
  }

  getTask(id: string): TaskRecord | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
    return row ? mapTaskRow(row) : null;
  }

  getNextQueuedTask(sessionId: string): TaskRecord | null {
    const row = this.db.prepare(
      `SELECT * FROM tasks WHERE session_id = ? AND status = 'queued' AND run_id IS NULL
       ORDER BY queued_at ASC, created_at ASC, id ASC LIMIT 1`
    ).get(sessionId) as TaskRow | undefined;
    return row ? mapTaskRow(row) : null;
  }

  getSessionIdsWithQueuedTasks(channelType?: string): string[] {
    const rows = channelType
      ? this.db.prepare(
          `SELECT DISTINCT t.session_id FROM tasks t
           JOIN sessions s ON s.id = t.session_id
           WHERE t.status = 'queued' AND t.run_id IS NULL
             AND s.active_run_id IS NULL AND s.channel_type = ?`
        ).all(channelType) as { session_id: string }[]
      : this.db.prepare(
          `SELECT DISTINCT t.session_id FROM tasks t
           JOIN sessions s ON s.id = t.session_id
           WHERE t.status = 'queued' AND t.run_id IS NULL AND s.active_run_id IS NULL`
        ).all() as { session_id: string }[];
    return rows.map((r) => r.session_id);
  }

  // ── Run CRUD ──

  startRun(input: StartRunInput): { run: AgentRunRecord; event: StoredEvent } {
    const tx = this.db.transaction(() => {
      const session = this.requireSession(input.sessionId);
      if (session.status === "archived") throw new Error(`Cannot start run for archived session: ${session.id}`);
      const task = this.requireTask(input.taskId);
      if (task.sessionId !== session.id) throw new Error(`Task ${task.id} does not belong to session ${session.id}`);
      if (task.runId) throw new Error(`Task already has a run: ${task.id}`);

      const timestamp = input.startedAt ?? nowIso();
      const agentType = input.agentType ?? session.agentType;
      const runId = input.id ?? createId("run");

      this.db.prepare(
        `INSERT INTO agent_runs (id, session_id, task_id, agent_type, status, launch_spec_json, pid,
          runtime_kind, external_session_id, checkpoint_id, protocol_state_json, cancel_state,
          context_pack_id, heartbeat_at, started_at, created_at, updated_at)
         VALUES (@id, @sessionId, @taskId, @agentType, 'running', @launchSpecJson, @pid,
          @runtimeKind, @externalSessionId, @checkpointId, @protocolStateJson, @cancelState,
          @contextPackId, @heartbeatAt, @startedAt, @createdAt, @updatedAt)`
      ).run({
        id: runId, sessionId: session.id, taskId: task.id, agentType,
        launchSpecJson: stringifyJson(input.launchSpec ?? {}),
        pid: input.pid ?? null, runtimeKind: input.runtimeKind ?? "acp",
        externalSessionId: input.externalSessionId ?? null,
        checkpointId: input.checkpointId ?? null,
        protocolStateJson: stringifyJson(input.protocolState ?? {}),
        cancelState: input.cancelState ?? null,
        contextPackId: input.contextPackId ?? null,
        heartbeatAt: timestamp, startedAt: timestamp,
        createdAt: timestamp, updatedAt: timestamp,
      });

      const event = this.events.append({
        sessionId: session.id, runId, taskId: task.id, type: "run_started",
        payload: {
          agentType, launchSpec: input.launchSpec ?? {}, pid: input.pid ?? null,
          runtimeKind: input.runtimeKind ?? "acp",
          externalSessionId: input.externalSessionId ?? null,
          checkpointId: input.checkpointId ?? null,
          contextPackId: input.contextPackId ?? null,
        },
        createdAt: timestamp,
      });

      this.db.prepare(
        "UPDATE agent_runs SET first_global_seq = @globalSeq, last_global_seq = @globalSeq, updated_at = @updatedAt WHERE id = @runId"
      ).run({ runId, globalSeq: event.globalSeq, updatedAt: timestamp });

      this.db.prepare(
        "UPDATE tasks SET status = 'running', run_id = @runId, started_at = @startedAt, updated_at = @updatedAt WHERE id = @taskId"
      ).run({ taskId: task.id, runId, startedAt: timestamp, updatedAt: timestamp });

      this.db.prepare(
        "UPDATE sessions SET status = 'running', active_run_id = @runId, updated_at = @updatedAt WHERE id = @sessionId"
      ).run({ sessionId: session.id, runId, updatedAt: timestamp });

      return { run: this.requireRun(runId), event };
    });
    return tx();
  }

  finishRun(input: FinishRunInput): { run: AgentRunRecord; event: StoredEvent } {
    const tx = this.db.transaction(() => {
      const run = this.requireRun(input.runId);
      if (isTerminalRunStatus(run.status)) throw new Error(`Run is already terminal: ${run.id}`);

      const timestamp = input.stoppedAt ?? nowIso();
      const eventType = (input.status === "succeeded" || input.status === "cancelled") ? "run_finished" : "run_failed";
      const event = this.events.append({
        sessionId: run.sessionId, runId: run.id, taskId: run.taskId,
        type: eventType,
        payload: {
          status: input.status,
          exitCode: input.exitCode ?? null,
          stopReason: input.stopReason ?? null,
          errorClass: input.errorClass ?? null,
          inputTokens: input.inputTokens ?? null,
          outputTokens: input.outputTokens ?? null,
        },
        createdAt: timestamp,
      });

      this.db.prepare(
        `UPDATE agent_runs SET status = @status, last_global_seq = @lastGlobalSeq,
          stopped_at = @stoppedAt, exit_code = @exitCode, stop_reason = @stopReason,
          error_class = @errorClass, updated_at = @updatedAt WHERE id = @runId`
      ).run({
        runId: run.id, status: input.status, lastGlobalSeq: event.globalSeq,
        stoppedAt: timestamp, exitCode: input.exitCode ?? null,
        stopReason: input.stopReason ?? null, errorClass: input.errorClass ?? null,
        updatedAt: timestamp,
      });

      if (run.taskId) {
        this.db.prepare(
          "UPDATE tasks SET status = @status, finished_at = @finishedAt, updated_at = @updatedAt WHERE id = @taskId"
        ).run({
          taskId: run.taskId, status: mapRunStatusToTaskStatus(input.status),
          finishedAt: timestamp, updatedAt: timestamp,
        });
      }

      this.db.prepare(
        `UPDATE sessions SET status = @status,
          active_run_id = CASE WHEN active_run_id = @runId THEN NULL ELSE active_run_id END,
          updated_at = @updatedAt WHERE id = @sessionId`
      ).run({
        sessionId: run.sessionId, runId: run.id,
        status: mapRunStatusToSessionStatus(input.status), updatedAt: timestamp,
      });

      return { run: this.requireRun(run.id), event };
    });
    return tx();
  }

  getRun(id: string): AgentRunRecord | null {
    const row = this.db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id) as AgentRunRow | undefined;
    return row ? mapAgentRunRow(row) : null;
  }

  getLatestExternalSessionId(sessionId: string, agentType: string): string | null {
    const row = this.db.prepare(
      `SELECT external_session_id FROM agent_runs
       WHERE session_id = ? AND agent_type = ? AND external_session_id IS NOT NULL
       ORDER BY COALESCE(started_at, created_at) DESC, id DESC LIMIT 1`
    ).get(sessionId, agentType) as { external_session_id: string | null } | undefined;
    return row?.external_session_id ?? null;
  }

  updateRunProcess(runId: string, pid: number | null): AgentRunRecord {
    const now = nowIso();
    this.db.prepare(
      "UPDATE agent_runs SET pid = @pid, heartbeat_at = @heartbeatAt, updated_at = @updatedAt WHERE id = @runId"
    ).run({ runId, pid, heartbeatAt: now, updatedAt: now });
    return this.requireRun(runId);
  }

  updateRunProtocolState(runId: string, state: RuntimeProtocolStateUpdate): AgentRunRecord {
    const existing = this.requireRun(runId);
    const protocolState = mergeProtocolState(existing.protocolState, state.protocolState);
    const now = nowIso();
    this.db.prepare(
      `UPDATE agent_runs SET
        external_session_id = COALESCE(@externalSessionId, external_session_id),
        checkpoint_id = COALESCE(@checkpointId, checkpoint_id),
        protocol_state_json = @protocolStateJson,
        cancel_state = COALESCE(@cancelState, cancel_state),
        heartbeat_at = @heartbeatAt, updated_at = @updatedAt
       WHERE id = @runId`
    ).run({
      runId, externalSessionId: state.externalSessionId ?? null,
      checkpointId: state.checkpointId ?? null,
      protocolStateJson: stringifyJson(protocolState),
      cancelState: state.cancelState ?? null,
      heartbeatAt: now, updatedAt: now,
    });
    return this.requireRun(runId);
  }

  setRunStatus(runId: string, status: RunStatus): AgentRunRecord {
    const now = nowIso();
    this.db.prepare(
      "UPDATE agent_runs SET status = @status, heartbeat_at = @heartbeatAt, updated_at = @updatedAt WHERE id = @runId"
    ).run({ runId, status, heartbeatAt: now, updatedAt: now });
    return this.requireRun(runId);
  }

  // ── Private helpers ──

  private insertTask(input: CreateTaskInput, timestamp: string): TaskRecord {
    const row = this.db.prepare(
      `INSERT INTO tasks (id, session_id, source_type, source_ref, type, status, target_agent_type,
        input_json, dedupe_key, queued_at, created_at, updated_at)
       VALUES (@id, @sessionId, @sourceType, @sourceRef, @type, 'queued', @targetAgentType,
        @inputJson, @dedupeKey, @queuedAt, @createdAt, @updatedAt)
       RETURNING *`
    ).get({
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

  updateWorkspacePath(sessionId: string, workspacePath: string): void {
    this.db.prepare(
      "UPDATE sessions SET workspace_path = ?, updated_at = ? WHERE id = ?",
    ).run(workspacePath, nowIso(), sessionId);
  }

  private requireSession(id: string): SessionRecord {
    const s = this.getSession(id);
    if (!s) throw new Error(`Session not found: ${id}`);
    return s;
  }

  private requireTask(id: string): TaskRecord {
    const t = this.getTask(id);
    if (!t) throw new Error(`Task not found: ${id}`);
    return t;
  }

  private requireRun(id: string): AgentRunRecord {
    const r = this.getRun(id);
    if (!r) throw new Error(`Run not found: ${id}`);
    return r;
  }
}

function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "overflowed";
}

function mapRunStatusToTaskStatus(status: FinishRunInput["status"]): TaskStatus {
  if (status === "succeeded") return "succeeded";
  if (status === "cancelled") return "cancelled";
  return "failed";
}

function mapRunStatusToSessionStatus(status: FinishRunInput["status"]): SessionStatus {
  if (status === "failed") return "failed";
  if (status === "overflowed") return "compacting";
  return "idle";
}

function mapSessionRow(row: SessionRow): SessionRecord {
  return {
    id: row.id, name: row.name ?? "", title: row.title, agentType: row.agent_type,
    workspacePath: row.workspace_path, status: row.status,
    channelType: row.channel_type, channelRef: row.channel_ref,
    defaultParams: parseJson(row.default_params_json),
    activeRunId: row.active_run_id,
    currentContextPackId: row.current_context_pack_id,
    sourceSessionId: row.source_session_id,
    sourceContextPackId: row.source_context_pack_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function normalizeSessionName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function mapTaskRow(row: TaskRow): TaskRecord {
  return {
    id: row.id, sessionId: row.session_id, sourceType: row.source_type,
    sourceRef: row.source_ref, type: row.type, status: row.status,
    targetAgentType: row.target_agent_type, input: parseJson(row.input_json),
    dedupeKey: row.dedupe_key, runId: row.run_id, queuedAt: row.queued_at,
    startedAt: row.started_at, finishedAt: row.finished_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapAgentRunRow(row: AgentRunRow): AgentRunRecord {
  return {
    id: row.id, sessionId: row.session_id, taskId: row.task_id,
    agentType: row.agent_type, status: row.status,
    launchSpec: parseJson(row.launch_spec_json), pid: row.pid,
    runtimeKind: row.runtime_kind, externalSessionId: row.external_session_id,
    checkpointId: row.checkpoint_id, protocolState: parseJson(row.protocol_state_json),
    cancelState: row.cancel_state, contextPackId: row.context_pack_id,
    firstGlobalSeq: row.first_global_seq, lastGlobalSeq: row.last_global_seq,
    heartbeatAt: row.heartbeat_at, startedAt: row.started_at,
    stoppedAt: row.stopped_at, exitCode: row.exit_code,
    stopReason: row.stop_reason, errorClass: row.error_class,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mergeProtocolState(existing: JsonValue, update: Record<string, unknown> | null | undefined): JsonValue {
  const base: JsonObject = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  return update ? { ...base, ...update } as JsonObject : base;
}
