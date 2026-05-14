import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventStore } from "../../src/server/events/event-store.js";
import { MemoryArchiveService } from "../../src/server/memory/memory-archive-service.js";
import { SessionStore } from "../../src/server/sessions/session-store.js";
import { createTestDatabase, type TestDatabase } from "../support/db.js";

describe("MemoryArchiveService", () => {
  let testDb: TestDatabase;
  let events: EventStore;
  let sessions: SessionStore;
  let service: MemoryArchiveService;

  beforeEach(() => {
    testDb = createTestDatabase();
    events = new EventStore(testDb.db);
    sessions = new SessionStore(testDb.db, events);
    service = new MemoryArchiveService(testDb.db, events);
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

  it("archives raw daily events with a rebuildable summary", () => {
    sessions.createTask({
      id: "task-1",
      sessionId: "session-1",
      sourceType: "web",
      type: "message",
      input: { text: "Summarize the day" },
    });
    testDb.db.prepare("UPDATE events SET id = 'event-task', created_at = '2026-05-13T09:00:00.000Z'").run();
    events.append({
      id: "event-text",
      sessionId: "session-1",
      type: "text_delta",
      payload: { text: "Daily work done" },
      createdAt: "2026-05-13T09:01:00.000Z",
    });
    events.append({
      id: "event-other-day",
      sessionId: "session-1",
      type: "text_delta",
      payload: { text: "Not today" },
      createdAt: "2026-05-14T00:01:00.000Z",
    });

    const result = service.createDailyArchive({
      sessionId: "session-1",
      archiveDate: "2026-05-13",
      createdAt: "2026-05-14T00:00:00.000Z",
    });

    expect(result.archive).toMatchObject({
      sessionId: "session-1",
      archiveDate: "2026-05-13",
      sourceEventStartId: "event-task",
      sourceEventEndId: "event-text",
      summary: {
        eventCount: 2,
        firstUserMessage: "Summarize the day",
        latestEventType: "text_delta",
      },
    });
    expect(result.archive.rawEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "event-task" }),
        expect.objectContaining({ id: "event-text" }),
      ]),
    );
    expect(result.event).toMatchObject({
      type: "memory_archive_created",
      payload: {
        archiveId: result.archive.id,
        archiveDate: "2026-05-13",
      },
    });
    expect(service.listArchives("session-1")).toHaveLength(1);
  });

  it("rejects invalid dates and empty archive days", () => {
    expect(() =>
      service.createDailyArchive({
        sessionId: "session-1",
        archiveDate: "2026/05/13",
      }),
    ).toThrow("archiveDate must use YYYY-MM-DD");
    expect(() =>
      service.createDailyArchive({
        sessionId: "session-1",
        archiveDate: "2026-05-13",
      }),
    ).toThrow("No events found");
  });
});
