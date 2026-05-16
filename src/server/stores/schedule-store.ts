import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { parseJson, stringifyJson, type JsonValue } from "../../shared/json.js";
import { nowIso, addMillisecondsIso } from "../../shared/time.js";

export type ScheduleKind = "once" | "cron";
export type ScheduleStatus = "active" | "paused" | "cancelled";

export type ScheduleRecord = {
  id: string;
  sessionId: string;
  status: ScheduleStatus;
  kind: ScheduleKind;
  cronExpr: string | null;
  runAt: string | null;
  timezone: string;
  payload: JsonValue;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ScheduleRow = {
  id: string; session_id: string; status: string; kind: string;
  cron_expr: string | null; run_at: string | null; timezone: string;
  payload_json: string; next_run_at: string | null; last_run_at: string | null;
  created_at: string; updated_at: string;
};

const CLAIM_LEASE_MS = 30_000;

export class ScheduleStore {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: {
    sessionId: string; kind: ScheduleKind; cronExpr?: string | null;
    runAt?: string | null; timezone?: string; payload?: JsonValue;
  }): ScheduleRecord {
    const now = nowIso();
    const row = this.db.prepare(
      `INSERT INTO schedules (id, session_id, status, kind, cron_expr, run_at, timezone, payload_json, next_run_at, created_at, updated_at)
       VALUES (@id, @sessionId, 'active', @kind, @cronExpr, @runAt, @timezone, @payloadJson, @nextRunAt, @createdAt, @updatedAt)
       RETURNING *`
    ).get({
      id: createId("sch"), sessionId: input.sessionId, kind: input.kind,
      cronExpr: input.cronExpr ?? null, runAt: input.runAt ?? null,
      timezone: input.timezone ?? "Asia/Shanghai",
      payloadJson: stringifyJson(input.payload ?? {}),
      nextRunAt: input.kind === "once" ? (input.runAt ?? null) : null,
      createdAt: now, updatedAt: now,
    }) as ScheduleRow;
    return mapRow(row);
  }

  listBySession(sessionId: string): ScheduleRecord[] {
    const rows = this.db.prepare("SELECT * FROM schedules WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as ScheduleRow[];
    return rows.map(mapRow);
  }

  updateStatus(scheduleId: string, status: ScheduleStatus): ScheduleRecord | null {
    const now = nowIso();
    this.db.prepare("UPDATE schedules SET status = @status, updated_at = @updatedAt WHERE id = @id").run({ id: scheduleId, status, updatedAt: now });
    const row = this.db.prepare("SELECT * FROM schedules WHERE id = ?").get(scheduleId) as ScheduleRow | undefined;
    return row ? mapRow(row) : null;
  }

  claimDue(limit = 10): ScheduleRecord[] {
    const now = nowIso();
    const leaseExpiry = addMillisecondsIso(now, CLAIM_LEASE_MS);
    const rows = this.db.prepare(
      `SELECT * FROM schedules WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ?
       AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
       ORDER BY next_run_at ASC LIMIT ?`
    ).all(now, now, limit) as ScheduleRow[];

    for (const row of rows) {
      this.db.prepare(
        "UPDATE schedules SET locked_by = 'scheduler', locked_at = @lockedAt, lease_expires_at = @leaseExpiresAt, updated_at = @updatedAt WHERE id = @id"
      ).run({ id: row.id, lockedAt: now, leaseExpiresAt: leaseExpiry, updatedAt: now });
    }
    return rows.map(mapRow);
  }

  markRunAndAdvance(scheduleId: string): void {
    const schedule = this.db.prepare("SELECT * FROM schedules WHERE id = ?").get(scheduleId) as ScheduleRow | undefined;
    if (!schedule) return;
    const now = nowIso();

    if (schedule.kind === "once") {
      this.db.prepare("UPDATE schedules SET status = 'cancelled', last_run_at = @lastRunAt, next_run_at = NULL, updated_at = @updatedAt WHERE id = @id").run({ id: scheduleId, lastRunAt: now, updatedAt: now });
    } else {
      // For cron: advance next_run_at (simplified — just mark last_run_at)
      this.db.prepare("UPDATE schedules SET last_run_at = @lastRunAt, locked_by = NULL, locked_at = NULL, lease_expires_at = NULL, updated_at = @updatedAt WHERE id = @id").run({ id: scheduleId, lastRunAt: now, updatedAt: now });
    }
  }
}

function mapRow(row: ScheduleRow): ScheduleRecord {
  return {
    id: row.id, sessionId: row.session_id, status: row.status as ScheduleStatus,
    kind: row.kind as ScheduleKind, cronExpr: row.cron_expr, runAt: row.run_at,
    timezone: row.timezone, payload: parseJson(row.payload_json),
    nextRunAt: row.next_run_at, lastRunAt: row.last_run_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
