import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventStore } from "../../src/server/events/event-store.js";
import { ScheduleStore } from "../../src/server/scheduler/schedule-store.js";
import { SchedulerService } from "../../src/server/scheduler/scheduler-service.js";
import { SessionStore } from "../../src/server/sessions/session-store.js";
import { createTestDatabase, type TestDatabase } from "../support/db.js";

describe("SchedulerService", () => {
  let testDb: TestDatabase;
  let events: EventStore;
  let sessions: SessionStore;
  let service: SchedulerService;

  beforeEach(() => {
    testDb = createTestDatabase();
    events = new EventStore(testDb.db);
    sessions = new SessionStore(testDb.db, events);
    service = new SchedulerService(testDb.db, events);
    sessions.createSession({
      id: "session-1",
      title: "Codex session",
      agentType: "codex",
      workspacePath: "/tmp/miniagent-test",
    });
  });

  afterEach(() => {
    testDb.close();
  });

  it("creates a due once schedule as a queued task and advances the schedule", () => {
    const schedule = service.createSchedule({
      id: "schedule-once",
      sessionId: "session-1",
      kind: "once",
      runAt: "2026-05-13T00:10:00.000Z",
      payload: {
        taskType: "message",
        targetAgentType: "codex",
        input: { text: "Run the scheduled task" },
      },
      actorType: "web_user",
      actorRef: "user-1",
      createdAt: "2026-05-13T00:00:00.000Z",
    });

    expect(schedule).toMatchObject({
      id: "schedule-once",
      status: "active",
      nextRunAt: "2026-05-13T00:10:00.000Z",
    });
    expect(service.runDueSchedules({ workerId: "worker-1", now: "2026-05-13T00:09:59.000Z" })).toHaveLength(0);

    const triggered = service.runDueSchedules({ workerId: "worker-1", now: "2026-05-13T00:10:00.000Z" });

    expect(triggered).toHaveLength(1);
    expect(triggered[0].task).toMatchObject({
      sessionId: "session-1",
      sourceType: "cron",
      sourceRef: "schedule-once",
      type: "message",
      targetAgentType: "codex",
      input: { text: "Run the scheduled task" },
      dedupeKey: "schedule:schedule-once:2026-05-13T00:10:00.000Z",
      status: "queued",
    });
    expect(triggered[0].schedule).toMatchObject({
      nextRunAt: null,
      lastRunAt: "2026-05-13T00:10:00.000Z",
      lockedBy: null,
    });
    expect(readEventTypes()).toContain("task_created");
    expect(service.runDueSchedules({ workerId: "worker-1", now: "2026-05-13T00:10:01.000Z" })).toHaveLength(0);
  });

  it("runs cron schedules and computes the next fire time", () => {
    const schedule = service.createSchedule({
      id: "schedule-cron",
      sessionId: "session-1",
      kind: "cron",
      cronExpr: "*/5 * * * *",
      payload: { text: "cron payload" },
      createdAt: "2026-05-13T00:00:00.000Z",
    });

    expect(schedule.nextRunAt).toBe("2026-05-13T00:05:00.000Z");

    const triggered = service.runDueSchedules({ workerId: "worker-1", now: "2026-05-13T00:05:00.000Z" });

    expect(triggered).toHaveLength(1);
    expect(triggered[0].task).toMatchObject({
      sourceType: "cron",
      type: "schedule_run",
      input: { text: "cron payload" },
    });
    expect(triggered[0].schedule.nextRunAt).toBe("2026-05-13T00:10:00.000Z");
  });

  it("uses schedule leases to prevent duplicate workers from claiming the same due work", () => {
    service.createSchedule({
      id: "schedule-lease",
      sessionId: "session-1",
      kind: "once",
      runAt: "2026-05-13T00:00:00.000Z",
      createdAt: "2026-05-13T00:00:00.000Z",
    });
    const schedules = new ScheduleStore(testDb.db);

    const first = schedules.claimDue({
      workerId: "worker-a",
      now: "2026-05-13T00:00:00.000Z",
      leaseExpiresAt: "2026-05-13T00:00:30.000Z",
      limit: 1,
    });
    const second = schedules.claimDue({
      workerId: "worker-b",
      now: "2026-05-13T00:00:01.000Z",
      leaseExpiresAt: "2026-05-13T00:00:31.000Z",
      limit: 1,
    });
    const afterExpiry = schedules.claimDue({
      workerId: "worker-b",
      now: "2026-05-13T00:00:31.000Z",
      leaseExpiresAt: "2026-05-13T00:01:01.000Z",
      limit: 1,
    });

    expect(first.map((item) => item.lockedBy)).toEqual(["worker-a"]);
    expect(second).toHaveLength(0);
    expect(afterExpiry.map((item) => item.lockedBy)).toEqual(["worker-b"]);
  });

  it("pauses, resumes, and cancels schedules", () => {
    service.createSchedule({
      id: "schedule-control",
      sessionId: "session-1",
      kind: "cron",
      cronExpr: "0 * * * *",
      createdAt: "2026-05-13T00:00:00.000Z",
    });

    expect(service.pauseSchedule("schedule-control", "web_user", "user-1").status).toBe("paused");
    expect(service.resumeSchedule("schedule-control", "web_user", "user-1")).toMatchObject({
      status: "active",
      nextRunAt: expect.any(String),
    });
    expect(service.cancelSchedule("schedule-control", "web_user", "user-1").status).toBe("cancelled");
    expect(readAuditActions()).toEqual(
      expect.arrayContaining(["schedule_create", "schedule_pause", "schedule_resume", "schedule_cancel"]),
    );
  });

  function readEventTypes(): string[] {
    return testDb.db
      .prepare("SELECT type FROM events WHERE session_id = 'session-1' ORDER BY global_seq ASC")
      .all()
      .map((row) => (row as { type: string }).type);
  }

  function readAuditActions(): string[] {
    return testDb.db
      .prepare("SELECT action FROM audit_logs WHERE resource_type = 'schedule' ORDER BY created_at ASC")
      .all()
      .map((row) => (row as { action: string }).action);
  }
});
