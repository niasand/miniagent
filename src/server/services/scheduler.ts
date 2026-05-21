import type { SqliteDatabase } from "../db/migrate.js";
import { SessionStore, type SourceType } from "../stores/session-store.js";
import { ScheduleStore, type ScheduleKind, type ScheduleRecord } from "../stores/schedule-store.js";
import { ScheduleRunStore, type ScheduleRunRecord } from "../stores/schedule-run-store.js";
import { EventStore } from "../stores/event-store.js";
import { AuditLogStore } from "../stores/audit-log-store.js";
import type { RuntimeService } from "../runtime/service.js";

export class SchedulerService {
  private sessions: SessionStore;
  private schedules: ScheduleStore;
  private scheduleRuns: ScheduleRunStore;
  private auditLogs: AuditLogStore;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly runtimeService?: RuntimeService,
  ) {
    this.sessions = new SessionStore(db, new EventStore(db));
    this.schedules = new ScheduleStore(db);
    this.scheduleRuns = new ScheduleRunStore(db);
    this.auditLogs = new AuditLogStore(db);
  }

  create(input: {
    sessionId: string; kind: ScheduleKind; cronExpr?: string | null;
    runAt?: string | null; timezone?: string; payload?: import("../../shared/json.js").JsonValue;
    actorType?: string; actorRef?: string;
  }) {
    const session = this.sessions.getSession(input.sessionId);
    if (!session) throw new Error(`Session not found: ${input.sessionId}`);
    const schedule = this.schedules.create(input);
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
          status: "queued",
        });

        this.schedules.markRunAndAdvance(schedule.id);

        triggered.push({ schedule: this.schedules.get(schedule.id) ?? schedule, taskId: task.id });
      } catch (err) {
        this.scheduleRuns.insert({
          scheduleId: schedule.id,
          sessionId: schedule.sessionId,
          scheduledFor: schedule.nextRunAt,
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
}
