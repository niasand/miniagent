import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { parseJson, stringifyJson, type JsonValue } from "../../shared/json.js";
import { nowIso, addMillisecondsIso, formatUtc8 } from "../../shared/time.js";

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

export type UpdateScheduleInput = {
  kind?: ScheduleKind;
  cronExpr?: string | null;
  runAt?: string | null;
  timezone?: string;
  payload?: JsonValue;
};

type ScheduleRow = {
  id: string; session_id: string; status: string; kind: string;
  cron_expr: string | null; run_at: string | null; timezone: string;
  payload_json: string; next_run_at: string | null; last_run_at: string | null;
  created_at: string; updated_at: string;
};

const CLAIM_LEASE_MS = 30_000;
const DEFAULT_TIMEZONE = "Asia/Shanghai";

export class ScheduleStore {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: {
    sessionId: string; kind: ScheduleKind; cronExpr?: string | null;
    runAt?: string | null; timezone?: string; payload?: JsonValue;
  }): ScheduleRecord {
    const now = nowIso();
    const cronExpr = input.cronExpr?.trim() || null;
    const runAt = input.runAt?.trim() || null;
    const timezone = normalizeScheduleTimezone(input.timezone);
    const nextRunAt = input.kind === "once"
      ? normalizeRunAt(runAt)
      : computeNextCronRun(requireCronExpr(cronExpr), now, timezone);
    const row = this.db.prepare(
      `INSERT INTO schedules (id, session_id, status, kind, cron_expr, run_at, timezone, payload_json, next_run_at, created_at, updated_at)
       VALUES (@id, @sessionId, 'active', @kind, @cronExpr, @runAt, @timezone, @payloadJson, @nextRunAt, @createdAt, @updatedAt)
       RETURNING *`
    ).get({
      id: createId("sch"), sessionId: input.sessionId, kind: input.kind,
      cronExpr, runAt,
      timezone,
      payloadJson: stringifyJson(input.payload ?? {}),
      nextRunAt,
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
    const existing = this.get(scheduleId);
    const nextRunAt = status === "active" && existing?.kind === "cron" && existing.cronExpr
      ? computeNextCronRun(existing.cronExpr, now, existing.timezone)
      : existing?.nextRunAt ?? null;
    this.db.prepare(
      "UPDATE schedules SET status = @status, next_run_at = @nextRunAt, locked_by = NULL, locked_at = NULL, lease_expires_at = NULL, updated_at = @updatedAt WHERE id = @id"
    ).run({ id: scheduleId, status, nextRunAt, updatedAt: now });
    const row = this.db.prepare("SELECT * FROM schedules WHERE id = ?").get(scheduleId) as ScheduleRow | undefined;
    return row ? mapRow(row) : null;
  }

  update(scheduleId: string, input: UpdateScheduleInput): ScheduleRecord | null {
    const existing = this.get(scheduleId);
    if (!existing) return null;
    if (existing.status === "cancelled") throw new Error("Cannot edit cancelled schedule");

    const now = nowIso();
    const kind = input.kind ?? existing.kind;
    const cronExpr = kind === "cron" ? (input.cronExpr ?? existing.cronExpr)?.trim() || null : null;
    const runAt = kind === "once" ? (input.runAt ?? existing.runAt)?.trim() || null : null;
    const timezone = normalizeScheduleTimezone(input.timezone ?? existing.timezone);
    const payload = input.payload ?? existing.payload;
    const nextRunAt = kind === "once"
      ? normalizeRunAt(runAt)
      : computeNextCronRun(requireCronExpr(cronExpr), now, timezone);

    this.db.prepare(
      `UPDATE schedules
       SET kind = @kind, cron_expr = @cronExpr, run_at = @runAt, timezone = @timezone,
           payload_json = @payloadJson, next_run_at = @nextRunAt,
           locked_by = NULL, locked_at = NULL, lease_expires_at = NULL, updated_at = @updatedAt
       WHERE id = @id`
    ).run({
      id: scheduleId,
      kind,
      cronExpr,
      runAt,
      timezone,
      payloadJson: stringifyJson(payload),
      nextRunAt,
      updatedAt: now,
    });
    return this.get(scheduleId);
  }

  get(scheduleId: string): ScheduleRecord | null {
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
      const nextRunAt = schedule.cron_expr ? computeNextCronRun(schedule.cron_expr, now, schedule.timezone) : null;
      this.db.prepare(
        "UPDATE schedules SET last_run_at = @lastRunAt, next_run_at = @nextRunAt, locked_by = NULL, locked_at = NULL, lease_expires_at = NULL, updated_at = @updatedAt WHERE id = @id"
      ).run({ id: scheduleId, lastRunAt: now, nextRunAt, updatedAt: now });
    }
  }
}

export function computeNextCronRun(cronExpr: string, afterIso = nowIso(), timezone = DEFAULT_TIMEZONE): string {
  const schedule = parseCron(cronExpr);
  const cleanTimezone = normalizeScheduleTimezone(timezone);
  const after = new Date(afterIso);
  if (Number.isNaN(after.getTime())) throw new Error("Invalid base time");
  const startMs = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  const maxMinutes = 366 * 24 * 60;
  const getParts = createTimezonePartsGetter(cleanTimezone);

  for (let i = 0; i < maxMinutes; i++) {
    const candidate = new Date(startMs + i * 60_000);
    const parts = getParts(candidate);
    if (
      schedule.minutes.has(parts.minute) &&
      schedule.hours.has(parts.hour) &&
      schedule.months.has(parts.month) &&
      matchesDay(schedule, parts.day, parts.dayOfWeek)
    ) {
      return formatUtc8(candidate);
    }
  }

  throw new Error("Could not compute next cron run within one year");
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

type ParsedCron = {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  anyDayOfMonth: boolean;
  anyDayOfWeek: boolean;
};

function requireCronExpr(cronExpr: string | null): string {
  if (!cronExpr) throw new Error("cronExpr is required for cron schedules");
  return cronExpr;
}

function normalizeRunAt(runAt: string | null): string {
  if (!runAt) throw new Error("runAt is required for once schedules");
  const date = new Date(runAt);
  if (Number.isNaN(date.getTime())) throw new Error("runAt must be a valid date");
  return formatUtc8(date);
}

export function normalizeScheduleTimezone(timezone?: string | null): string {
  const value = timezone?.trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
  } catch {
    throw new Error("timezone must be a valid IANA time zone");
  }
  return value;
}

export function getSchedulePayloadText(payload: JsonValue): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const text = (payload as Record<string, unknown>).text;
  return typeof text === "string" ? text : null;
}

export function summarizeSchedulePayload(payload: JsonValue, maxLength = 120): string | null {
  const text = getSchedulePayloadText(payload)?.trim();
  const raw = text || stringifyNonEmptyPayload(payload);
  if (!raw) return null;
  return raw.length > maxLength ? `${raw.slice(0, maxLength - 1)}…` : raw;
}

function stringifyNonEmptyPayload(payload: JsonValue): string | null {
  if (!payload || (typeof payload === "object" && !Array.isArray(payload) && Object.keys(payload).length === 0)) return null;
  return JSON.stringify(payload);
}

function parseCron(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("cronExpr must have five fields");
  const daysOfMonth = parseCronField(fields[2], 1, 31, "day of month");
  const daysOfWeek = parseCronField(fields[4], 0, 7, "day of week");
  return {
    minutes: parseCronField(fields[0], 0, 59, "minute"),
    hours: parseCronField(fields[1], 0, 23, "hour"),
    daysOfMonth,
    months: parseCronField(fields[3], 1, 12, "month"),
    daysOfWeek: new Set([...daysOfWeek].map((value) => value === 7 ? 0 : value)),
    anyDayOfMonth: fields[2] === "*",
    anyDayOfWeek: fields[4] === "*",
  };
}

function parseCronField(field: string, min: number, max: number, label: string): Set<number> {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    if (part.split("/").length > 2) throw new Error(`Invalid cron ${label} field`);
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step <= 0) throw new Error(`Invalid cron ${label} step`);
    const [start, end] = parseCronRange(rangePart, min, max, label);
    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }
  if (values.size === 0) throw new Error(`Invalid cron ${label} field`);
  return values;
}

function parseCronRange(range: string, min: number, max: number, label: string): [number, number] {
  if (range === "*") return [min, max];
  const bounds = range.split("-");
  if (bounds.length === 1) {
    const value = parseCronNumber(bounds[0], min, max, label);
    return [value, value];
  }
  if (bounds.length === 2) {
    const start = parseCronNumber(bounds[0], min, max, label);
    const end = parseCronNumber(bounds[1], min, max, label);
    if (start > end) throw new Error(`Invalid cron ${label} range`);
    return [start, end];
  }
  throw new Error(`Invalid cron ${label} range`);
}

function parseCronNumber(raw: string, min: number, max: number, label: string): number {
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid cron ${label} value`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid cron ${label} value`);
  }
  return value;
}

function matchesDay(schedule: ParsedCron, day: number, dayOfWeek: number): boolean {
  const domMatches = schedule.daysOfMonth.has(day);
  const dowMatches = schedule.daysOfWeek.has(dayOfWeek);
  if (schedule.anyDayOfMonth && schedule.anyDayOfWeek) return true;
  if (schedule.anyDayOfMonth) return dowMatches;
  if (schedule.anyDayOfWeek) return domMatches;
  return domMatches || dowMatches;
}

function createTimezonePartsGetter(timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
  return (date: Date) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((part) => [part.type, part.value]),
    );
    const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? "");
    if (dayOfWeek < 0) throw new Error("Invalid timezone weekday");

    return {
      minute: Number(parts.minute),
      hour: Number(parts.hour),
      day: Number(parts.day),
      month: Number(parts.month),
      dayOfWeek,
    };
  };
}
