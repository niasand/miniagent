import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { parseJson, stringifyJson, type JsonValue } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";

export type AppendEventInput = {
  id?: string;
  sessionId: string;
  runId?: string | null;
  taskId?: string | null;
  runSeq?: number | null;
  type: string;
  payload?: JsonValue;
  schemaVersion?: number;
  causationId?: string | null;
  correlationId?: string | null;
  createdAt?: string;
};

export type StoredEvent = {
  globalSeq: number;
  id: string;
  sessionId: string;
  runId: string | null;
  taskId: string | null;
  runSeq: number | null;
  type: string;
  payload: JsonValue;
  schemaVersion: number;
  causationId: string | null;
  correlationId: string | null;
  createdAt: string;
};

export type EventRow = {
  global_seq: number;
  id: string;
  session_id: string;
  run_id: string | null;
  task_id: string | null;
  run_seq: number | null;
  type: string;
  payload_json: string;
  schema_version: number;
  causation_id: string | null;
  correlation_id: string | null;
  created_at: string;
};

export class EventStore {
  constructor(private readonly db: SqliteDatabase) {}

  append(input: AppendEventInput): StoredEvent {
    const appendOne = this.db.transaction((event: AppendEventInput) => this.insertEvent(event));
    return appendOne(input);
  }

  appendBatch(inputs: AppendEventInput[]): StoredEvent[] {
    const appendMany = this.db.transaction((events: AppendEventInput[]) =>
      events.map((event) => this.insertEvent(event)),
    );
    return appendMany(inputs);
  }

  listAfterGlobalSeq(options: { sessionId?: string; afterGlobalSeq: number; limit?: number }): StoredEvent[] {
    const limit = options.limit ?? 100;
    if (limit <= 0) {
      throw new Error("limit must be positive");
    }

    const rows = options.sessionId
      ? this.db
          .prepare(
            `
            SELECT *
            FROM events
            WHERE session_id = ? AND global_seq > ?
            ORDER BY global_seq ASC
            LIMIT ?
          `,
          )
          .all(options.sessionId, options.afterGlobalSeq, limit)
      : this.db
          .prepare(
            `
            SELECT *
            FROM events
            WHERE global_seq > ?
            ORDER BY global_seq ASC
            LIMIT ?
          `,
          )
          .all(options.afterGlobalSeq, limit);

    return rows.map((row) => mapEventRow(row as EventRow));
  }

  private insertEvent(input: AppendEventInput): StoredEvent {
    if (!input.runId && input.runSeq != null) {
      throw new Error("runSeq requires runId");
    }

    const runSeq = input.runId ? (input.runSeq ?? this.nextRunSeq(input.runId)) : null;
    const row = this.db
      .prepare(
        `
        INSERT INTO events (
          id, session_id, run_id, task_id, run_seq, type, payload_json,
          schema_version, causation_id, correlation_id, created_at
        )
        VALUES (
          @id, @sessionId, @runId, @taskId, @runSeq, @type, @payloadJson,
          @schemaVersion, @causationId, @correlationId, @createdAt
        )
        RETURNING *
      `,
      )
      .get({
        id: input.id ?? createId("evt"),
        sessionId: input.sessionId,
        runId: input.runId ?? null,
        taskId: input.taskId ?? null,
        runSeq,
        type: input.type,
        payloadJson: stringifyJson(input.payload ?? {}),
        schemaVersion: input.schemaVersion ?? 1,
        causationId: input.causationId ?? null,
        correlationId: input.correlationId ?? null,
        createdAt: input.createdAt ?? nowIso(),
      }) as EventRow;

    return mapEventRow(row);
  }

  private nextRunSeq(runId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(run_seq), 0) + 1 AS next_run_seq FROM events WHERE run_id = ?")
      .get(runId) as { next_run_seq: number };

    return row.next_run_seq;
  }
}

export function mapEventRow(row: EventRow): StoredEvent {
  return {
    globalSeq: row.global_seq,
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id,
    taskId: row.task_id,
    runSeq: row.run_seq,
    type: row.type,
    payload: parseJson(row.payload_json),
    schemaVersion: row.schema_version,
    causationId: row.causation_id,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
  };
}
