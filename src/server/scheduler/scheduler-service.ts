import type { SqliteDatabase } from "../db/migrate.js";
import { AuditLogStore, type AuditActorType } from "../audit/audit-log-store.js";
import { EventStore } from "../events/event-store.js";
import { type TaskRecord, type TaskType, SessionStore } from "../sessions/session-store.js";
import { type JsonObject, type JsonValue } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";
import { ScheduleStore, type ScheduleKind, type ScheduleRecord } from "./schedule-store.js";

export type CreateScheduleInput = {
  id?: string;
  sessionId: string;
  kind: ScheduleKind;
  cronExpr?: string | null;
  runAt?: string | null;
  timezone?: string;
  payload?: JsonValue;
  actorType?: AuditActorType;
  actorRef?: string | null;
  createdAt?: string;
};

export type RunDueSchedulesInput = {
  workerId: string;
  now?: string;
  leaseMs?: number;
  limit?: number;
};

export type ScheduleTriggerResult = {
  schedule: ScheduleRecord;
  task: TaskRecord;
};

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_LIMIT = 20;

export class SchedulerService {
  private readonly schedules: ScheduleStore;
  private readonly sessions: SessionStore;
  private readonly auditLogs: AuditLogStore;

  constructor(private readonly db: SqliteDatabase, events = new EventStore(db)) {
    this.schedules = new ScheduleStore(db);
    this.sessions = new SessionStore(db, events);
    this.auditLogs = new AuditLogStore(db);
  }

  createSchedule(input: CreateScheduleInput): ScheduleRecord {
    this.requireSession(input.sessionId);
    const createdAt = input.createdAt ?? nowIso();
    const nextRunAt = resolveInitialNextRun(input, createdAt);
    const schedule = this.schedules.insert({
      id: input.id,
      sessionId: input.sessionId,
      kind: input.kind,
      cronExpr: input.cronExpr ?? null,
      runAt: input.runAt ?? null,
      timezone: input.timezone ?? "Asia/Shanghai",
      payload: input.payload ?? {},
      nextRunAt,
      createdAt,
    });

    this.auditLogs.insert({
      actorType: input.actorType ?? "system",
      actorRef: input.actorRef ?? null,
      action: "schedule_create",
      resourceType: "schedule",
      resourceId: schedule.id,
      payload: {
        sessionId: schedule.sessionId,
        kind: schedule.kind,
        cronExpr: schedule.cronExpr,
        runAt: schedule.runAt,
        nextRunAt: schedule.nextRunAt,
      },
      createdAt,
    });

    return schedule;
  }

  listSchedules(sessionId: string): ScheduleRecord[] {
    this.requireSession(sessionId);
    return this.schedules.listBySession(sessionId);
  }

  pauseSchedule(id: string, actorType: AuditActorType = "system", actorRef?: string | null): ScheduleRecord {
    const schedule = this.schedules.setStatus(id, "paused");
    this.auditScheduleStatus(schedule, actorType, actorRef ?? null, "schedule_pause");
    return schedule;
  }

  resumeSchedule(id: string, actorType: AuditActorType = "system", actorRef?: string | null): ScheduleRecord {
    const existing = this.requireSchedule(id);
    const now = nowIso();
    const nextRunAt = existing.kind === "cron" ? nextCronRun(existing.cronExpr ?? "", now) : existing.nextRunAt;
    this.db
      .prepare(
        `
        UPDATE schedules
        SET status = 'active',
            next_run_at = @nextRunAt,
            locked_by = NULL,
            locked_at = NULL,
            lease_expires_at = NULL,
            updated_at = @updatedAt
        WHERE id = @id
      `,
      )
      .run({ id, nextRunAt, updatedAt: now });

    const schedule = this.requireSchedule(id);
    this.auditScheduleStatus(schedule, actorType, actorRef ?? null, "schedule_resume");
    return schedule;
  }

  cancelSchedule(id: string, actorType: AuditActorType = "system", actorRef?: string | null): ScheduleRecord {
    const schedule = this.schedules.setStatus(id, "cancelled");
    this.auditScheduleStatus(schedule, actorType, actorRef ?? null, "schedule_cancel");
    return schedule;
  }

  runDueSchedules(input: RunDueSchedulesInput): ScheduleTriggerResult[] {
    const now = input.now ?? nowIso();
    assertIsoDate(now, "now");
    const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS;
    if (leaseMs <= 0) {
      throw new Error("leaseMs must be positive");
    }

    const due = this.schedules.claimDue({
      workerId: input.workerId,
      now,
      leaseExpiresAt: new Date(new Date(now).getTime() + leaseMs).toISOString(),
      limit: input.limit ?? DEFAULT_LIMIT,
    });

    const results: ScheduleTriggerResult[] = [];
    for (const schedule of due) {
      const task = this.createTaskForSchedule(schedule, now);
      const nextRunAt = schedule.kind === "cron" ? nextCronRun(schedule.cronExpr ?? "", now) : null;
      const updated = this.schedules.setNextRun(schedule.id, nextRunAt, now, now);
      results.push({ schedule: updated, task });
    }

    return results;
  }

  private createTaskForSchedule(schedule: ScheduleRecord, now: string): TaskRecord {
    const payload = readObject(schedule.payload);
    const taskType = readTaskType(payload.taskType);
    const targetAgentType = typeof payload.targetAgentType === "string" ? payload.targetAgentType : null;
    const input = Object.prototype.hasOwnProperty.call(payload, "input") ? payload.input : schedule.payload;
    const dedupeKey = `schedule:${schedule.id}:${schedule.nextRunAt ?? now}`;

    try {
      return this.sessions.createTask({
        sessionId: schedule.sessionId,
        sourceType: "cron",
        sourceRef: schedule.id,
        type: taskType,
        targetAgentType,
        input,
        dedupeKey,
        queuedAt: now,
      }).task;
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        const existing = this.db.prepare("SELECT * FROM tasks WHERE dedupe_key = ?").get(dedupeKey) as
          | { id: string }
          | undefined;
        if (existing) {
          const task = this.sessions.getTask(existing.id);
          if (task) {
            return task;
          }
        }
      }

      throw error;
    }
  }

  private auditScheduleStatus(
    schedule: ScheduleRecord,
    actorType: AuditActorType,
    actorRef: string | null,
    action: string,
  ): void {
    this.auditLogs.insert({
      actorType,
      actorRef,
      action,
      resourceType: "schedule",
      resourceId: schedule.id,
      payload: {
        sessionId: schedule.sessionId,
        status: schedule.status,
      },
    });
  }

  private requireSchedule(id: string): ScheduleRecord {
    const schedule = this.schedules.get(id);
    if (!schedule) {
      throw new Error(`Schedule not found: ${id}`);
    }
    return schedule;
  }

  private requireSession(id: string): void {
    const session = this.sessions.getSession(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }
    if (session.status === "archived") {
      throw new Error(`Cannot schedule archived session: ${id}`);
    }
  }
}

function resolveInitialNextRun(input: CreateScheduleInput, createdAt: string): string {
  if (input.kind === "once") {
    if (!input.runAt) {
      throw new Error("runAt is required for once schedules");
    }
    assertIsoDate(input.runAt, "runAt");
    return input.runAt;
  }

  if (!input.cronExpr) {
    throw new Error("cronExpr is required for cron schedules");
  }

  return nextCronRun(input.cronExpr, createdAt);
}

function nextCronRun(cronExpr: string, afterIso: string): string {
  const cron = parseCron(cronExpr);
  const after = new Date(afterIso);
  if (Number.isNaN(after.getTime())) {
    throw new Error("afterIso must be a valid ISO timestamp");
  }

  const cursor = new Date(after);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    if (matchesCron(cursor, cron)) {
      return cursor.toISOString();
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  throw new Error(`Unable to find next cron run: ${cronExpr}`);
}

type CronSpec = {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
};

function parseCron(cronExpr: string): CronSpec {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("cronExpr must use 5 fields");
  }

  return {
    minute: parseCronField(parts[0], 0, 59, "minute"),
    hour: parseCronField(parts[1], 0, 23, "hour"),
    dayOfMonth: parseCronField(parts[2], 1, 31, "dayOfMonth"),
    month: parseCronField(parts[3], 1, 12, "month"),
    dayOfWeek: parseCronField(parts[4], 0, 7, "dayOfWeek"),
  };
}

function parseCronField(value: string, min: number, max: number, name: string): Set<number> {
  const result = new Set<number>();
  for (const part of value.split(",")) {
    if (part === "*") {
      addRange(result, min, max, 1);
      continue;
    }

    if (part.startsWith("*/")) {
      const step = Number(part.slice(2));
      if (!Number.isInteger(step) || step <= 0) {
        throw new Error(`Invalid cron ${name} step`);
      }
      addRange(result, min, max, step);
      continue;
    }

    const numeric = Number(part);
    if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
      throw new Error(`Invalid cron ${name} value`);
    }
    result.add(name === "dayOfWeek" && numeric === 7 ? 0 : numeric);
  }

  return result;
}

function addRange(target: Set<number>, min: number, max: number, step: number): void {
  for (let value = min; value <= max; value += step) {
    target.add(value);
  }
}

function matchesCron(date: Date, cron: CronSpec): boolean {
  return (
    cron.minute.has(date.getUTCMinutes()) &&
    cron.hour.has(date.getUTCHours()) &&
    cron.dayOfMonth.has(date.getUTCDate()) &&
    cron.month.has(date.getUTCMonth() + 1) &&
    cron.dayOfWeek.has(date.getUTCDay())
  );
}

function assertIsoDate(value: string, name: string): void {
  if (Number.isNaN(new Date(value).getTime())) {
    throw new Error(`${name} must be a valid ISO timestamp`);
  }
}

function readObject(value: JsonValue): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readTaskType(value: unknown): TaskType {
  if (
    value === "message" ||
    value === "compact" ||
    value === "handoff" ||
    value === "schedule_run" ||
    value === "stop" ||
    value === "resume"
  ) {
    return value;
  }
  return "schedule_run";
}
