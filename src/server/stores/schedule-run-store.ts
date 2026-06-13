import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import type { WorkspaceScheduleRunDelivery } from "../../shared/workspace.js";

export type ScheduleRunStatus = "queued" | "failed";

export type ScheduleRunRecord = {
  id: string;
  scheduleId: string;
  sessionId: string;
  taskId: string | null;
  runId: string | null;
  scheduledFor: string | null;
  payloadSummary: string | null;
  status: ScheduleRunStatus;
  taskStatus: string | null;
  deliveries: WorkspaceScheduleRunDelivery[];
  error: string | null;
  createdAt: string;
};

type ScheduleRunRow = {
  id: string;
  schedule_id: string;
  session_id: string;
  task_id: string | null;
  run_id: string | null;
  scheduled_for: string | null;
  payload_summary: string | null;
  status: ScheduleRunStatus;
  task_status: string | null;
  error: string | null;
  created_at: string;
};

type DeliveryRow = {
  channel_type: WorkspaceScheduleRunDelivery["channelType"];
  target_ref: string;
  status: WorkspaceScheduleRunDelivery["status"];
  last_error: string | null;
  sent_at: string | null;
};

export class ScheduleRunStore {
  constructor(private readonly db: SqliteDatabase) {}

  insert(input: {
    scheduleId: string;
    sessionId: string;
    taskId?: string | null;
    scheduledFor?: string | null;
    payloadSummary?: string | null;
    status: ScheduleRunStatus;
    error?: string | null;
  }): ScheduleRunRecord {
    const row = this.db.prepare(
      `INSERT INTO schedule_runs (id, schedule_id, session_id, task_id, scheduled_for, payload_summary, status, error, created_at)
       VALUES (@id, @scheduleId, @sessionId, @taskId, @scheduledFor, @payloadSummary, @status, @error, @createdAt)
       RETURNING *, NULL AS run_id, NULL AS task_status`,
    ).get({
      id: createId("shr"),
      scheduleId: input.scheduleId,
      sessionId: input.sessionId,
      taskId: input.taskId ?? null,
      scheduledFor: input.scheduledFor ?? null,
      payloadSummary: input.payloadSummary ?? null,
      status: input.status,
      error: input.error ?? null,
      createdAt: nowIso(),
    }) as ScheduleRunRow;
    return mapRow(row);
  }

  listBySchedule(scheduleId: string, limit = 20): ScheduleRunRecord[] {
    const rows = this.db.prepare(
      `SELECT sr.*, t.run_id AS run_id, t.status AS task_status
       FROM schedule_runs sr
       LEFT JOIN tasks t ON t.id = sr.task_id
       WHERE sr.schedule_id = ?
       ORDER BY sr.created_at DESC, sr.id DESC
       LIMIT ?`,
    ).all(scheduleId, limit) as ScheduleRunRow[];
    return rows.map((row) => mapRow(row, this.listDeliveriesByRun(row.run_id)));
  }

  private listDeliveriesByRun(runId: string | null): WorkspaceScheduleRunDelivery[] {
    if (!runId) return [];
    const rows = this.db.prepare(
      `SELECT
         channel_type,
         target_ref,
         CASE
           WHEN SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END) > 0 THEN 'dead'
           WHEN SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) > 0 THEN 'failed'
           WHEN SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END) > 0 THEN 'sending'
           WHEN SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) > 0 THEN 'pending'
           ELSE 'sent'
         END AS status,
         MAX(last_error) AS last_error,
         MAX(sent_at) AS sent_at
       FROM outbox
       WHERE idempotency_key GLOB ?
       GROUP BY channel_type, target_ref
       ORDER BY CASE channel_type
         WHEN 'qq' THEN 0
         WHEN 'telegram' THEN 1
         WHEN 'feishu' THEN 2
         WHEN 'discord' THEN 3
         WHEN 'wechat' THEN 4
         WHEN 'wecom' THEN 5
         WHEN 'dingtalk' THEN 6
         ELSE 7
       END, target_ref`,
    ).all(`${runId}:reply:*`) as DeliveryRow[];

    return rows.map((row) => ({
      channelType: row.channel_type,
      targetRef: row.target_ref,
      status: row.status,
      lastError: row.last_error,
      sentAt: row.sent_at,
    }));
  }
}

function mapRow(row: ScheduleRunRow, deliveries: WorkspaceScheduleRunDelivery[] = []): ScheduleRunRecord {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    sessionId: row.session_id,
    taskId: row.task_id,
    runId: row.run_id,
    scheduledFor: row.scheduled_for,
    payloadSummary: row.payload_summary,
    status: row.status,
    taskStatus: row.task_status,
    deliveries,
    error: row.error,
    createdAt: row.created_at,
  };
}
