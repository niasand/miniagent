import type { SqliteDatabase } from "../db/migrate.js";
import { SessionStore, type SourceType } from "../stores/session-store.js";
import { ScheduleStore, type ScheduleKind } from "../stores/schedule-store.js";
import { EventStore } from "../stores/event-store.js";
import { AuditLogStore } from "../stores/audit-log-store.js";
import type { RuntimeService } from "../runtime/service.js";

export class SchedulerService {
  private sessions: SessionStore;
  private schedules: ScheduleStore;
  private auditLogs: AuditLogStore;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly runtimeService?: RuntimeService,
  ) {
    this.sessions = new SessionStore(db, new EventStore(db));
    this.schedules = new ScheduleStore(db);
    this.auditLogs = new AuditLogStore(db);
  }

  create(input: {
    sessionId: string; kind: ScheduleKind; cronExpr?: string | null;
    runAt?: string | null; timezone?: string; payload?: import("../../shared/json.js").JsonValue;
    actorType?: string; actorRef?: string;
  }) {
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

  pause(scheduleId: string) {
    return this.schedules.updateStatus(scheduleId, "paused");
  }

  resume(scheduleId: string) {
    return this.schedules.updateStatus(scheduleId, "active");
  }

  cancel(scheduleId: string) {
    return this.schedules.updateStatus(scheduleId, "cancelled");
  }

  runDue(): { triggered: Array<{ scheduleId: string; taskId: string }> } {
    const due = this.schedules.claimDue();
    const triggered: Array<{ scheduleId: string; taskId: string }> = [];

    for (const schedule of due) {
      try {
        const dedupeKey = `schedule:${schedule.id}:${schedule.nextRunAt}`;
        const { task } = this.sessions.createTask({
          sessionId: schedule.sessionId,
          sourceType: "cron" as SourceType,
          type: "schedule_run",
          input: schedule.payload,
          dedupeKey,
        });

        this.schedules.markRunAndAdvance(schedule.id);

        triggered.push({ scheduleId: schedule.id, taskId: task.id });
      } catch (err) {
        // Dedupe or other error — skip
        this.schedules.markRunAndAdvance(schedule.id);
      }
    }

    // Auto-start queued tasks
    if (this.runtimeService) {
      for (const t of triggered) {
        try {
          this.runtimeService.startNextQueuedTask(
            this.schedules.listBySession(
              due.find((s) => s.id === t.scheduleId)?.sessionId ?? ""
            )[0]?.sessionId ?? ""
          );
        } catch { /* skip */ }
      }
    }

    return { triggered };
  }
}
