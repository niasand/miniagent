import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { parseJson, stringifyJson, type JsonValue } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";

export type MemoryArchiveRecord = {
  id: string;
  sessionId: string;
  archiveDate: string;
  sourceEventStartId: string;
  sourceEventEndId: string;
  sourceGlobalSeqStart: number;
  sourceGlobalSeqEnd: number;
  rawEvents: JsonValue;
  summary: JsonValue;
  createdAt: string;
  updatedAt: string;
};

export type UpsertMemoryArchiveInput = {
  id?: string;
  sessionId: string;
  archiveDate: string;
  sourceEventStartId: string;
  sourceEventEndId: string;
  sourceGlobalSeqStart: number;
  sourceGlobalSeqEnd: number;
  rawEvents: JsonValue;
  summary: JsonValue;
  createdAt?: string;
};

type MemoryArchiveRow = {
  id: string;
  session_id: string;
  archive_date: string;
  source_event_start_id: string;
  source_event_end_id: string;
  source_global_seq_start: number;
  source_global_seq_end: number;
  raw_events_json: string;
  summary_json: string;
  created_at: string;
  updated_at: string;
};

export class MemoryArchiveStore {
  constructor(private readonly db: SqliteDatabase) {}

  upsert(input: UpsertMemoryArchiveInput): MemoryArchiveRecord {
    const timestamp = input.createdAt ?? nowIso();
    const row = this.db
      .prepare(
        `
        INSERT INTO memory_archives (
          id, session_id, archive_date, source_event_start_id, source_event_end_id,
          source_global_seq_start, source_global_seq_end, raw_events_json, summary_json,
          created_at, updated_at
        )
        VALUES (
          @id, @sessionId, @archiveDate, @sourceEventStartId, @sourceEventEndId,
          @sourceGlobalSeqStart, @sourceGlobalSeqEnd, @rawEventsJson, @summaryJson,
          @createdAt, @updatedAt
        )
        ON CONFLICT(session_id, archive_date) DO UPDATE SET
          source_event_start_id = excluded.source_event_start_id,
          source_event_end_id = excluded.source_event_end_id,
          source_global_seq_start = excluded.source_global_seq_start,
          source_global_seq_end = excluded.source_global_seq_end,
          raw_events_json = excluded.raw_events_json,
          summary_json = excluded.summary_json,
          updated_at = excluded.updated_at
        RETURNING *
      `,
      )
      .get({
        id: input.id ?? createId("mem"),
        sessionId: input.sessionId,
        archiveDate: input.archiveDate,
        sourceEventStartId: input.sourceEventStartId,
        sourceEventEndId: input.sourceEventEndId,
        sourceGlobalSeqStart: input.sourceGlobalSeqStart,
        sourceGlobalSeqEnd: input.sourceGlobalSeqEnd,
        rawEventsJson: stringifyJson(input.rawEvents),
        summaryJson: stringifyJson(input.summary),
        createdAt: timestamp,
        updatedAt: timestamp,
      }) as MemoryArchiveRow;

    return mapMemoryArchiveRow(row);
  }

  listBySession(sessionId: string): MemoryArchiveRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM memory_archives
        WHERE session_id = ?
        ORDER BY archive_date DESC
      `,
      )
      .all(sessionId) as MemoryArchiveRow[];

    return rows.map(mapMemoryArchiveRow);
  }
}

function mapMemoryArchiveRow(row: MemoryArchiveRow): MemoryArchiveRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    archiveDate: row.archive_date,
    sourceEventStartId: row.source_event_start_id,
    sourceEventEndId: row.source_event_end_id,
    sourceGlobalSeqStart: row.source_global_seq_start,
    sourceGlobalSeqEnd: row.source_global_seq_end,
    rawEvents: parseJson(row.raw_events_json),
    summary: parseJson(row.summary_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
