import type { SqliteDatabase } from "../db/migrate.js";
import { EventStore, type EventRow, type StoredEvent, mapEventRow } from "../events/event-store.js";
import { createId } from "../../shared/ids.js";
import { parseJson, type JsonObject, type JsonValue } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";
import {
  ContextPackStore,
  type ContextPackCreatedBy,
  type ContextPackRecord,
  type ContextPackStrategy,
} from "./context-pack-store.js";

export type CreateContextPackInput = {
  id?: string;
  sessionId: string;
  sourceEventStartId?: string;
  sourceEventEndId?: string;
  createdBy: ContextPackCreatedBy;
  strategy?: ContextPackStrategy;
  createdAt?: string;
};

export type CreateContextPackResult = {
  contextPack: ContextPackRecord;
  event: StoredEvent;
};

type TaskRow = {
  id: string;
  type: string;
  status: string;
  input_json: string;
};

export class ContextPackService {
  private readonly contextPacks: ContextPackStore;
  private readonly events: EventStore;

  constructor(private readonly db: SqliteDatabase, events = new EventStore(db)) {
    this.contextPacks = new ContextPackStore(db);
    this.events = events;
  }

  createFromEvents(input: CreateContextPackInput): CreateContextPackResult {
    const create = this.db.transaction((request: CreateContextPackInput) => {
      const timestamp = request.createdAt ?? nowIso();
      const range = this.readEventRange(request);
      const sourceRunId = range.events.find((event) => event.runId)?.runId ?? null;
      const packId = request.id ?? createId("ctx");
      const summary = buildSummary(range.events);
      const recentMessages = buildRecentMessages(range.events);
      const keyFiles = buildKeyFiles(range.events);
      const openTasks = this.readOpenTasks(request.sessionId);
      const tokenEstimate = estimateTokens([summary, recentMessages, keyFiles, openTasks]);

      const contextPack = this.contextPacks.insert({
        id: packId,
        sessionId: request.sessionId,
        sourceRunId,
        status: "ready",
        sourceEventStartId: range.start.id,
        sourceEventEndId: range.end.id,
        tokenEstimate,
        summary,
        recentMessages,
        keyFiles,
        openTasks,
        createdBy: request.createdBy,
        strategy: request.strategy ?? "miniagent_summary",
        createdAt: timestamp,
      });

      this.db
        .prepare(
          `
          UPDATE sessions
          SET current_context_pack_id = @contextPackId, updated_at = @updatedAt
          WHERE id = @sessionId
        `,
        )
        .run({
          sessionId: request.sessionId,
          contextPackId: contextPack.id,
          updatedAt: timestamp,
        });

      const event = this.events.append({
        sessionId: request.sessionId,
        type: "context_pack_created",
        payload: {
          contextPackId: contextPack.id,
          sourceRunId,
          sourceEventStartId: contextPack.sourceEventStartId,
          sourceEventEndId: contextPack.sourceEventEndId,
          tokenEstimate: contextPack.tokenEstimate,
          strategy: contextPack.strategy,
        },
        createdAt: timestamp,
      });

      return { contextPack, event };
    });

    return create(input);
  }

  private readEventRange(input: CreateContextPackInput): { events: StoredEvent[]; start: StoredEvent; end: StoredEvent } {
    const bounds = this.readBounds(input);
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM events
        WHERE session_id = ? AND global_seq >= ? AND global_seq <= ?
        ORDER BY global_seq ASC
      `,
      )
      .all(input.sessionId, bounds.start.globalSeq, bounds.end.globalSeq) as EventRow[];

    const events = rows.map(mapEventRow);
    if (events.length === 0) {
      throw new Error(`No events found for context pack session: ${input.sessionId}`);
    }

    return {
      events,
      start: events[0],
      end: events[events.length - 1],
    };
  }

  private readBounds(input: CreateContextPackInput): { start: StoredEvent; end: StoredEvent } {
    const start = input.sourceEventStartId
      ? this.readEventById(input.sessionId, input.sourceEventStartId)
      : this.readBoundaryEvent(input.sessionId, "ASC");
    const end = input.sourceEventEndId
      ? this.readEventById(input.sessionId, input.sourceEventEndId)
      : this.readBoundaryEvent(input.sessionId, "DESC");

    if (start.globalSeq > end.globalSeq) {
      throw new Error("ContextPack source range is invalid");
    }

    return { start, end };
  }

  private readBoundaryEvent(sessionId: string, direction: "ASC" | "DESC"): StoredEvent {
    const row = this.db
      .prepare(
        `
        SELECT *
        FROM events
        WHERE session_id = ?
        ORDER BY global_seq ${direction}
        LIMIT 1
      `,
      )
      .get(sessionId) as EventRow | undefined;

    if (!row) {
      throw new Error(`No events found for context pack session: ${sessionId}`);
    }

    return mapEventRow(row);
  }

  private readEventById(sessionId: string, eventId: string): StoredEvent {
    const row = this.db
      .prepare("SELECT * FROM events WHERE session_id = ? AND id = ?")
      .get(sessionId, eventId) as EventRow | undefined;

    if (!row) {
      throw new Error(`ContextPack source event not found: ${eventId}`);
    }

    return mapEventRow(row);
  }

  private readOpenTasks(sessionId: string): JsonValue[] {
    const rows = this.db
      .prepare(
        `
        SELECT id, type, status, input_json
        FROM tasks
        WHERE session_id = ? AND status IN ('scheduled', 'queued', 'running', 'paused')
        ORDER BY created_at ASC
      `,
      )
      .all(sessionId) as TaskRow[];

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      input: parseJson(row.input_json),
    }));
  }
}

function buildSummary(events: StoredEvent[]): JsonObject {
  const firstTask = events.find((event) => event.type === "task_created");
  const latestRunEvent = [...events].reverse().find((event) => event.type.startsWith("run_"));

  return {
    goal: firstTask ? readTaskText(firstTask.payload) : "",
    decisions: [],
    constraints: [],
    currentState: latestRunEvent
      ? {
          eventType: latestRunEvent.type,
          payload: latestRunEvent.payload,
        }
      : {},
    sourceEventRange: {
      start: events[0].id,
      end: events[events.length - 1].id,
      count: events.length,
    },
  };
}

function buildRecentMessages(events: StoredEvent[]): JsonValue[] {
  return events
    .filter((event) => event.type === "task_created" || event.type === "text_delta" || event.type === "runtime_stderr")
    .slice(-12)
    .map((event) => ({
      eventId: event.id,
      role: event.type === "task_created" ? "user" : event.type === "runtime_stderr" ? "tool" : "assistant",
      content: event.type === "task_created" ? readTaskText(event.payload) : readPayloadText(event.payload),
      createdAt: event.createdAt,
    }));
}

function buildKeyFiles(events: StoredEvent[]): JsonValue[] {
  const files = new Map<string, JsonObject>();
  for (const event of events) {
    collectFileHints(event.payload, files);
  }

  return [...files.values()];
}

function collectFileHints(value: JsonValue, files: Map<string, JsonObject>): void {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectFileHints(item, files);
    }
    return;
  }

  const path = typeof value.path === "string" ? value.path : typeof value.file === "string" ? value.file : null;
  if (path) {
    files.set(path, { path });
  }

  for (const item of Object.values(value)) {
    collectFileHints(item, files);
  }
}

function estimateTokens(values: JsonValue[]): number {
  const chars = JSON.stringify(values).length;
  return Math.max(1, Math.ceil(chars / 4));
}

function readTaskText(payload: JsonValue): string {
  const object = readObject(payload);
  return readPayloadText(object.input ?? payload);
}

function readPayloadText(payload: JsonValue): string {
  if (typeof payload === "string") {
    return payload;
  }

  const object = readObject(payload);
  if (typeof object.text === "string") {
    return object.text;
  }

  return "";
}

function readObject(value: JsonValue): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
