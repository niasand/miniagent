import type { SqliteDatabase } from "../db/migrate.js";
import { SessionStore, type SourceType } from "../stores/session-store.js";
import { ScheduleStore, summarizeSchedulePayload, type ScheduleKind, type ScheduleRecord, type UpdateScheduleInput } from "../stores/schedule-store.js";
import { ScheduleRunStore, type ScheduleRunRecord } from "../stores/schedule-run-store.js";
import { EventStore } from "../stores/event-store.js";
import { AuditLogStore } from "../stores/audit-log-store.js";
import type { RuntimeService } from "../runtime/service.js";
import type { JsonObject, JsonValue } from "../../shared/json.js";
import { NotificationPreferenceService } from "./notification-preferences.js";

export class SchedulerService {
  private sessions: SessionStore;
  private schedules: ScheduleStore;
  private scheduleRuns: ScheduleRunStore;
  private auditLogs: AuditLogStore;
  private notificationPreferences: NotificationPreferenceService;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly runtimeService?: RuntimeService,
  ) {
    this.sessions = new SessionStore(db, new EventStore(db));
    this.schedules = new ScheduleStore(db);
    this.scheduleRuns = new ScheduleRunStore(db);
    this.auditLogs = new AuditLogStore(db);
    this.notificationPreferences = new NotificationPreferenceService(db);
  }

  create(input: {
    sessionId: string; kind: ScheduleKind; cronExpr?: string | null;
    runAt?: string | null; timezone?: string; payload?: JsonValue;
    actorType?: string; actorRef?: string;
  }) {
    const session = this.sessions.getSession(input.sessionId);
    if (!session) throw new Error(`Session not found: ${input.sessionId}`);
    const schedule = this.schedules.create({
      ...input,
      payload: this.withDefaultPrivateNotificationTargets(input.payload),
    });
    this.auditLogs.insert({
      actorType: (input.actorType ?? "system") as any,
      actorRef: input.actorRef ?? null,
      action: "schedule_created",
      resourceType: "schedule",
      resourceId: schedule.id,
      payload: { kind: input.kind, sessionId: input.sessionId },
    });
    return schedule;
  }

  list(sessionId: string) {
    return this.schedules.listBySession(sessionId);
  }

  listRuns(scheduleId: string): ScheduleRunRecord[] {
    return this.scheduleRuns.listBySchedule(scheduleId);
  }

  update(scheduleId: string, input: UpdateScheduleInput) {
    const schedule = this.schedules.update(scheduleId, input.payload === undefined
      ? input
      : {
          ...input,
          payload: this.withDefaultPrivateNotificationTargets(input.payload),
        });
    if (!schedule) return null;
    this.auditLogs.insert({
      actorType: "web_user",
      actorRef: null,
      action: "schedule_updated",
      resourceType: "schedule",
      resourceId: schedule.id,
      payload: { kind: schedule.kind, sessionId: schedule.sessionId },
    });
    return schedule;
  }

  pause(scheduleId: string) {
    return this.schedules.updateStatus(scheduleId, "paused");
  }

  resume(scheduleId: string) {
    return this.schedules.updateStatus(scheduleId, "active");
  }

  cancel(scheduleId: string) {
    return this.schedules.updateStatus(scheduleId, "cancelled");
  }

  runDue(): { triggered: Array<{ schedule: ScheduleRecord; taskId: string }> } {
    const due = this.schedules.claimDue();
    const triggered: Array<{ schedule: ScheduleRecord; taskId: string }> = [];

    for (const schedule of due) {
      try {
        const dedupeKey = `schedule:${schedule.id}:${schedule.nextRunAt}`;
        const { task } = this.sessions.createTask({
          sessionId: schedule.sessionId,
          sourceType: "cron" as SourceType,
          sourceRef: schedule.id,
          type: "schedule_run",
          input: schedule.payload,
          dedupeKey,
        });
        this.scheduleRuns.insert({
          scheduleId: schedule.id,
          sessionId: schedule.sessionId,
          taskId: task.id,
          scheduledFor: schedule.nextRunAt,
          payloadSummary: summarizeSchedulePayload(schedule.payload),
          status: "queued",
        });

        this.schedules.markRunAndAdvance(schedule.id);

        triggered.push({ schedule: this.schedules.get(schedule.id) ?? schedule, taskId: task.id });
      } catch (err) {
        this.scheduleRuns.insert({
          scheduleId: schedule.id,
          sessionId: schedule.sessionId,
          scheduledFor: schedule.nextRunAt,
          payloadSummary: summarizeSchedulePayload(schedule.payload),
          status: "failed",
          error: err instanceof Error ? err.message : "Schedule run failed",
        });
        // Dedupe or other error — skip
        this.schedules.markRunAndAdvance(schedule.id);
      }
    }

    // Auto-start queued tasks
    if (this.runtimeService) {
      for (const t of triggered) {
        try {
          this.runtimeService.startNextQueuedTask(t.schedule.sessionId);
        } catch { /* skip */ }
      }
    }

    return { triggered };
  }

  private withDefaultPrivateNotificationTargets(payload: JsonValue | undefined): JsonValue {
    const base = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as JsonObject
      : {};
    return {
      ...base,
      notificationTargets: this.notificationPreferences.resolveTargetsForDefaultUser(),
    };
  }
}
