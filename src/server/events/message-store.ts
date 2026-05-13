import type { SqliteDatabase } from "../db/migrate.js";
import { parseJson, stringifyJson, type JsonValue } from "../../shared/json.js";

export type MessageRole = "user" | "assistant" | "system" | "tool";

export type MessageRecord = {
  id: string;
  sessionId: string;
  runId: string | null;
  role: MessageRole;
  content: string;
  metadata: JsonValue;
  sourceEventId: string;
  createdAt: string;
};

export type UpsertMessageInput = {
  id: string;
  sessionId: string;
  runId?: string | null;
  role: MessageRole;
  content: string;
  metadata?: JsonValue;
  sourceEventId: string;
  createdAt: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  run_id: string | null;
  role: MessageRole;
  content: string;
  metadata_json: string;
  source_event_id: string;
  created_at: string;
};

export class MessageStore {
  constructor(private readonly db: SqliteDatabase) {}

  upsert(input: UpsertMessageInput): MessageRecord {
    const row = this.db
      .prepare(
        `
        INSERT INTO messages (
          id, session_id, run_id, role, content, metadata_json, source_event_id, created_at
        )
        VALUES (
          @id, @sessionId, @runId, @role, @content, @metadataJson, @sourceEventId, @createdAt
        )
        ON CONFLICT(id) DO UPDATE SET
          content = excluded.content,
          metadata_json = excluded.metadata_json
        RETURNING *
      `,
      )
      .get({
        id: input.id,
        sessionId: input.sessionId,
        runId: input.runId ?? null,
        role: input.role,
        content: input.content,
        metadataJson: stringifyJson(input.metadata ?? {}),
        sourceEventId: input.sourceEventId,
        createdAt: input.createdAt,
      }) as MessageRow;

    return mapMessageRow(row);
  }

  listBySession(sessionId: string): MessageRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT messages.*
        FROM messages
        JOIN events ON events.id = messages.source_event_id
        WHERE messages.session_id = ?
        ORDER BY events.global_seq ASC
      `,
      )
      .all(sessionId) as MessageRow[];

    return rows.map(mapMessageRow);
  }
}

function mapMessageRow(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id,
    role: row.role,
    content: row.content,
    metadata: parseJson(row.metadata_json),
    sourceEventId: row.source_event_id,
    createdAt: row.created_at,
  };
}
