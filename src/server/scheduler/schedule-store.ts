import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { parseJson, stringifyJson, type JsonValue } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";

export type ScheduleStatus = "active" | "paused" | "cancelled";
export type ScheduleKind = "once" | "cron";

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
  lockedBy: string | null;
  lockedAt: string | null;
  leaseExpiresAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InsertScheduleInput = {
  id?: string;
  sessionId: string;
  kind: ScheduleKind;
  cronExpr?: string | null;
  runAt?: string | null;
  timezone?: string;
  payload?: JsonValue;
  nextRunAt?: string | null;
  createdAt?: string;
};

type ScheduleRow = {
  id: string;
  session_id: string;
  status: ScheduleStatus;
  kind: ScheduleKind;
  cron_expr: string | null;
  run_at: string | null;
  timezone: string;
  payload_json: string;
  next_run_at: string | null;
  locked_by: string | null;
  locked_at: string | null;
  lease_expires_at: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export class ScheduleStore {
  constructor(private readonly db: SqliteDatabase) {}

  insert(input: InsertScheduleInput): ScheduleRecord {
    const createdAt = input.createdAt ?? nowIso();
    const row = this.db
      .prepare(
        `
        INSERT INTO schedules (
          id, session_id, status, kind, cron_expr, run_at, timezone, payload_json,
          next_run_at, created_at, updated_at
        )
        VALUES (
          @id, @sessionId, 'active', @kind, @cronExpr, @runAt, @timezone, @payloadJson,
          @nextRunAt, @createdAt, @updatedAt
        )
        RETURNING *
      `,
      )
      .get({
        id: input.id ?? createId("sch"),
        sessionId: input.sessionId,
        kind: input.kind,
        cronExpr: input.cronExpr ?? null,
        runAt: input.runAt ?? null,
        timezone: input.timezone ?? "Asia/Shanghai",
        payloadJson: stringifyJson(input.payload ?? {}),
        nextRunAt: input.nextRunAt ?? input.runAt ?? null,
        createdAt,
        updatedAt: createdAt,
      }) as ScheduleRow;

    return mapScheduleRow(row);
  }

  get(id: string): ScheduleRecord | null {
    const row = this.db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as ScheduleRow | undefined;
    return row ? mapScheduleRow(row) : null;
  }

  listBySession(sessionId: string): ScheduleRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM schedules
        WHERE session_id = ?
        ORDER BY created_at DESC, id DESC
      `,
      )
      .all(sessionId) as ScheduleRow[];

    return rows.map(mapScheduleRow);
  }

  setStatus(id: string, status: ScheduleStatus, updatedAt = nowIso()): ScheduleRecord {
    const row = this.db
      .prepare(
        `
        UPDATE schedules
        SET status = @status,
            locked_by = NULL,
            locked_at = NULL,
            lease_expires_at = NULL,
            updated_at = @updatedAt
        WHERE id = @id
        RETURNING *
      `,
      )
      .get({ id, status, updatedAt }) as ScheduleRow | undefined;

    if (!row) {
      throw new Error(`Schedule not found: ${id}`);
    }

    return mapScheduleRow(row);
  }

  setNextRun(id: string, nextRunAt: string | null, lastRunAt: string, updatedAt = nowIso()): ScheduleRecord {
    const row = this.db
      .prepare(
        `
        UPDATE schedules
        SET next_run_at = @nextRunAt,
            last_run_at = @lastRunAt,
            locked_by = NULL,
            locked_at = NULL,
            lease_expires_at = NULL,
            updated_at = @updatedAt
        WHERE id = @id
        RETURNING *
      `,
      )
      .get({ id, nextRunAt, lastRunAt, updatedAt }) as ScheduleRow | undefined;

    if (!row) {
      throw new Error(`Schedule not found: ${id}`);
    }

    return mapScheduleRow(row);
  }

  claimDue(input: { workerId: string; now: string; leaseExpiresAt: string; limit: number }): ScheduleRecord[] {
    if (input.limit <= 0) {
      throw new Error("limit must be positive");
    }

    const claim = this.db.transaction((request: typeof input) => {
      const candidates = this.db
        .prepare(
          `
          SELECT id
          FROM schedules
          WHERE status = 'active'
            AND next_run_at IS NOT NULL
            AND next_run_at <= @now
            AND (lease_expires_at IS NULL OR lease_expires_at <= @now)
          ORDER BY next_run_at ASC, created_at ASC, id ASC
          LIMIT @limit
        `,
        )
        .all(request) as Array<{ id: string }>;

      const claimed: ScheduleRecord[] = [];
      for (const candidate of candidates) {
        const row = this.db
          .prepare(
            `
            UPDATE schedules
            SET locked_by = @workerId,
                locked_at = @now,
                lease_expires_at = @leaseExpiresAt,
                updated_at = @now
            WHERE id = @id
              AND status = 'active'
              AND next_run_at IS NOT NULL
              AND next_run_at <= @now
              AND (lease_expires_at IS NULL OR lease_expires_at <= @now)
            RETURNING *
          `,
          )
          .get({
            id: candidate.id,
            workerId: request.workerId,
            now: request.now,
            leaseExpiresAt: request.leaseExpiresAt,
          }) as ScheduleRow | undefined;

        if (row) {
          claimed.push(mapScheduleRow(row));
        }
      }

      return claimed;
    });

    return claim(input);
  }
}

function mapScheduleRow(row: ScheduleRow): ScheduleRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    status: row.status,
    kind: row.kind,
    cronExpr: row.cron_expr,
    runAt: row.run_at,
    timezone: row.timezone,
    payload: parseJson(row.payload_json),
    nextRunAt: row.next_run_at,
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
    leaseExpiresAt: row.lease_expires_at,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
