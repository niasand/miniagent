import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { parseJson, stringifyJson, type JsonValue } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";

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

type MessageRow = {
  id: string;
  session_id: string;
  run_id: string | null;
  role: string;
  content: string;
  metadata_json: string;
  source_event_id: string;
  created_at: string;
};

export class MessageStore {
  constructor(private readonly db: SqliteDatabase) {}

  insert(input: {
    sessionId: string;
    runId?: string | null;
    role: MessageRole;
    content: string;
    metadata?: JsonValue;
    sourceEventId: string;
  }): MessageRecord {
    const row = this.db.prepare(
      `INSERT INTO messages (id, session_id, run_id, role, content, metadata_json, source_event_id, created_at)
       VALUES (@id, @sessionId, @runId, @role, @content, @metadataJson, @sourceEventId, @createdAt)
       RETURNING *`
    ).get({
      id: createId("msg"),
      sessionId: input.sessionId,
      runId: input.runId ?? null,
      role: input.role,
      content: input.content,
      metadataJson: stringifyJson(input.metadata ?? {}),
      sourceEventId: input.sourceEventId,
      createdAt: nowIso(),
    }) as MessageRow;

    return mapMessageRow(row);
  }

  listBySession(sessionId: string, limit = 100): MessageRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?"
    ).all(sessionId, limit) as MessageRow[];
    return rows.map(mapMessageRow);
  }

  getFirstUserBySession(sessionId: string): MessageRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM messages WHERE session_id = ? AND role = 'user' ORDER BY created_at ASC, id ASC LIMIT 1"
    ).get(sessionId) as MessageRow | undefined;
    return row ? mapMessageRow(row) : null;
  }

  getLatestBySession(sessionId: string, limit = 50): MessageRecord[] {
    const total = (this.db.prepare("SELECT COUNT(*) as c FROM messages WHERE session_id = ?").get(sessionId) as { c: number }).c;
    const offset = Math.max(0, total - limit);
    const rows = this.db.prepare(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?"
    ).all(sessionId, limit, offset) as MessageRow[];
    return rows.map(mapMessageRow);
  }
}

function mapMessageRow(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id,
    role: row.role as MessageRole,
    content: row.content,
    metadata: parseJson(row.metadata_json),
    sourceEventId: row.source_event_id,
    createdAt: row.created_at,
  };
}
