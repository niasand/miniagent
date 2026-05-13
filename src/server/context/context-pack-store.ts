import type { SqliteDatabase } from "../db/migrate.js";
import { parseJson, stringifyJson, type JsonValue } from "../../shared/json.js";

export type ContextPackStatus = "draft" | "ready" | "failed" | "superseded";
export type ContextPackCreatedBy = "system" | "user" | "agent";
export type ContextPackStrategy = "native_compact" | "miniagent_summary" | "manual";

export type ContextPackRecord = {
  id: string;
  sessionId: string;
  sourceRunId: string | null;
  schemaVersion: number;
  status: ContextPackStatus;
  sourceEventStartId: string;
  sourceEventEndId: string;
  tokenEstimate: number | null;
  summary: JsonValue;
  recentMessages: JsonValue;
  keyFiles: JsonValue;
  openTasks: JsonValue;
  createdBy: ContextPackCreatedBy;
  strategy: ContextPackStrategy;
  createdAt: string;
};

export type InsertContextPackInput = {
  id: string;
  sessionId: string;
  sourceRunId?: string | null;
  schemaVersion?: number;
  status: ContextPackStatus;
  sourceEventStartId: string;
  sourceEventEndId: string;
  tokenEstimate?: number | null;
  summary: JsonValue;
  recentMessages: JsonValue;
  keyFiles: JsonValue;
  openTasks: JsonValue;
  createdBy: ContextPackCreatedBy;
  strategy: ContextPackStrategy;
  createdAt: string;
};

type ContextPackRow = {
  id: string;
  session_id: string;
  source_run_id: string | null;
  schema_version: number;
  status: ContextPackStatus;
  source_event_start_id: string;
  source_event_end_id: string;
  token_estimate: number | null;
  summary_json: string;
  recent_messages_json: string;
  key_files_json: string;
  open_tasks_json: string;
  created_by: ContextPackCreatedBy;
  strategy: ContextPackStrategy;
  created_at: string;
};

export class ContextPackStore {
  constructor(private readonly db: SqliteDatabase) {}

  insert(input: InsertContextPackInput): ContextPackRecord {
    const row = this.db
      .prepare(
        `
        INSERT INTO context_packs (
          id, session_id, source_run_id, schema_version, status,
          source_event_start_id, source_event_end_id, token_estimate,
          summary_json, recent_messages_json, key_files_json, open_tasks_json,
          created_by, strategy, created_at
        )
        VALUES (
          @id, @sessionId, @sourceRunId, @schemaVersion, @status,
          @sourceEventStartId, @sourceEventEndId, @tokenEstimate,
          @summaryJson, @recentMessagesJson, @keyFilesJson, @openTasksJson,
          @createdBy, @strategy, @createdAt
        )
        RETURNING *
      `,
      )
      .get({
        id: input.id,
        sessionId: input.sessionId,
        sourceRunId: input.sourceRunId ?? null,
        schemaVersion: input.schemaVersion ?? 1,
        status: input.status,
        sourceEventStartId: input.sourceEventStartId,
        sourceEventEndId: input.sourceEventEndId,
        tokenEstimate: input.tokenEstimate ?? null,
        summaryJson: stringifyJson(input.summary),
        recentMessagesJson: stringifyJson(input.recentMessages),
        keyFilesJson: stringifyJson(input.keyFiles),
        openTasksJson: stringifyJson(input.openTasks),
        createdBy: input.createdBy,
        strategy: input.strategy,
        createdAt: input.createdAt,
      }) as ContextPackRow;

    return mapContextPackRow(row);
  }

  get(id: string): ContextPackRecord | null {
    const row = this.db.prepare("SELECT * FROM context_packs WHERE id = ?").get(id) as ContextPackRow | undefined;
    return row ? mapContextPackRow(row) : null;
  }

  getLatestReady(sessionId: string): ContextPackRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT *
        FROM context_packs
        WHERE session_id = ? AND status = 'ready'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      )
      .get(sessionId) as ContextPackRow | undefined;

    return row ? mapContextPackRow(row) : null;
  }
}

function mapContextPackRow(row: ContextPackRow): ContextPackRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    sourceRunId: row.source_run_id,
    schemaVersion: row.schema_version,
    status: row.status,
    sourceEventStartId: row.source_event_start_id,
    sourceEventEndId: row.source_event_end_id,
    tokenEstimate: row.token_estimate,
    summary: parseJson(row.summary_json),
    recentMessages: parseJson(row.recent_messages_json),
    keyFiles: parseJson(row.key_files_json),
    openTasks: parseJson(row.open_tasks_json),
    createdBy: row.created_by,
    strategy: row.strategy,
    createdAt: row.created_at,
  };
}
