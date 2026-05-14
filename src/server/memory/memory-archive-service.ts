import type { SqliteDatabase } from "../db/migrate.js";
import { EventStore, type EventRow, type StoredEvent, mapEventRow } from "../events/event-store.js";
import type { JsonObject, JsonValue } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";
import { MemoryArchiveStore, type MemoryArchiveRecord } from "./memory-archive-store.js";

export type CreateDailyMemoryArchiveInput = {
  sessionId: string;
  archiveDate: string;
  createdAt?: string;
};

export type CreateDailyMemoryArchiveResult = {
  archive: MemoryArchiveRecord;
  event: StoredEvent;
};

export class MemoryArchiveService {
  private readonly archives: MemoryArchiveStore;
  private readonly events: EventStore;

  constructor(private readonly db: SqliteDatabase, events = new EventStore(db)) {
    this.archives = new MemoryArchiveStore(db);
    this.events = events;
  }

  createDailyArchive(input: CreateDailyMemoryArchiveInput): CreateDailyMemoryArchiveResult {
    this.requireSession(input.sessionId);
    const range = dateRange(input.archiveDate);
    const events = this.readEvents(input.sessionId, range.start, range.end);
    if (events.length === 0) {
      throw new Error(`No events found for archive date: ${input.archiveDate}`);
    }

    const timestamp = input.createdAt ?? nowIso();
    const archive = this.archives.upsert({
      sessionId: input.sessionId,
      archiveDate: input.archiveDate,
      sourceEventStartId: events[0].id,
      sourceEventEndId: events[events.length - 1].id,
      sourceGlobalSeqStart: events[0].globalSeq,
      sourceGlobalSeqEnd: events[events.length - 1].globalSeq,
      rawEvents: events.map(serializeEvent),
      summary: buildSummary(events),
      createdAt: timestamp,
    });
    const event = this.events.append({
      sessionId: input.sessionId,
      type: "memory_archive_created",
      payload: {
        archiveId: archive.id,
        archiveDate: archive.archiveDate,
        sourceEventStartId: archive.sourceEventStartId,
        sourceEventEndId: archive.sourceEventEndId,
        sourceGlobalSeqStart: archive.sourceGlobalSeqStart,
        sourceGlobalSeqEnd: archive.sourceGlobalSeqEnd,
      },
      createdAt: timestamp,
    });

    return { archive, event };
  }

  listArchives(sessionId: string): MemoryArchiveRecord[] {
    this.requireSession(sessionId);
    return this.archives.listBySession(sessionId);
  }

  private readEvents(sessionId: string, start: string, end: string): StoredEvent[] {
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM events
        WHERE session_id = ?
          AND created_at >= ?
          AND created_at < ?
          AND type != 'memory_archive_created'
        ORDER BY global_seq ASC
      `,
      )
      .all(sessionId, start, end) as EventRow[];

    return rows.map(mapEventRow);
  }

  private requireSession(sessionId: string): void {
    const row = this.db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId) as { id: string } | undefined;
    if (!row) {
      throw new Error(`Session not found: ${sessionId}`);
    }
  }
}

function dateRange(archiveDate: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(archiveDate)) {
    throw new Error("archiveDate must use YYYY-MM-DD");
  }

  const start = new Date(`${archiveDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new Error("archiveDate must be valid");
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function buildSummary(events: StoredEvent[]): JsonObject {
  const byType: Record<string, number> = {};
  for (const event of events) {
    byType[event.type] = (byType[event.type] ?? 0) + 1;
  }

  return {
    eventCount: events.length,
    byType,
    sourceEventRange: {
      start: events[0].id,
      end: events[events.length - 1].id,
      startGlobalSeq: events[0].globalSeq,
      endGlobalSeq: events[events.length - 1].globalSeq,
    },
    firstUserMessage: readFirstUserMessage(events),
    latestEventType: events[events.length - 1].type,
  };
}

function readFirstUserMessage(events: StoredEvent[]): string | null {
  for (const event of events) {
    if (event.type === "task_created") {
      const payload = readObject(event.payload);
      const input = readObject(payload.input);
      if (typeof input.text === "string") {
        return input.text;
      }
    }
  }
  return null;
}

function serializeEvent(event: StoredEvent): JsonObject {
  return {
    globalSeq: event.globalSeq,
    id: event.id,
    sessionId: event.sessionId,
    runId: event.runId,
    taskId: event.taskId,
    runSeq: event.runSeq,
    type: event.type,
    payload: event.payload,
    createdAt: event.createdAt,
  };
}

function readObject(value: JsonValue): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
