import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";

export type ScheduleRunStatus = "queued" | "failed";

export type ScheduleRunRecord = {
  id: string;
  scheduleId: string;
  sessionId: string;
  taskId: string | null;
  scheduledFor: string | null;
  payloadSummary: string | null;
  status: ScheduleRunStatus;
  taskStatus: string | null;
  error: string | null;
  createdAt: string;
};

type ScheduleRunRow = {
  id: string;
  schedule_id: string;
  session_id: string;
  task_id: string | null;
  scheduled_for: string | null;
  payload_summary: string | null;
  status: ScheduleRunStatus;
  task_status: string | null;
  error: string | null;
  created_at: string;
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
       RETURNING *, NULL AS task_status`,
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
      `SELECT sr.*, t.status AS task_status
       FROM schedule_runs sr
       LEFT JOIN tasks t ON t.id = sr.task_id
       WHERE sr.schedule_id = ?
       ORDER BY sr.created_at DESC, sr.id DESC
       LIMIT ?`,
    ).all(scheduleId, limit) as ScheduleRunRow[];
    return rows.map(mapRow);
  }
}

function mapRow(row: ScheduleRunRow): ScheduleRunRecord {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    sessionId: row.session_id,
    taskId: row.task_id,
    scheduledFor: row.scheduled_for,
    payloadSummary: row.payload_summary,
    status: row.status,
    taskStatus: row.task_status,
    error: row.error,
    createdAt: row.created_at,
  };
}
