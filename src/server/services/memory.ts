import type { SqliteDatabase } from "../db/migrate.js";

export type MemorySearchResult = {
  sessionId: string;
  messageId: string;
  role: string;
  content: string;
  createdAt: string;
};

export class MemoryService {
  constructor(private readonly db: SqliteDatabase) {}

  search(query: string, options: { sessionId?: string; limit?: number } = {}): MemorySearchResult[] {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];

    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
    const match = toFtsQuery(cleanQuery);
    const whereSession = options.sessionId ? "AND session_id = @sessionId" : "";
    const rows = this.db.prepare(
      `SELECT session_id, message_id, role, content, created_at
       FROM messages_fts
       WHERE messages_fts MATCH @match ${whereSession}
       ORDER BY rank
       LIMIT @limit`
    ).all({ match, sessionId: options.sessionId ?? null, limit }) as Array<{
      session_id: string;
      message_id: string;
      role: string;
      content: string;
      created_at: string;
    }>;

    return rows.map((row) => ({
      sessionId: row.session_id,
      messageId: row.message_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    }));
  }

  formatResults(results: MemorySearchResult[]): string {
    if (results.length === 0) return "没有找到相关历史消息。";
    return results.map((result, index) => {
      const content = result.content.length > 240 ? `${result.content.slice(0, 237)}...` : result.content;
      return `${index + 1}. [${result.role}] ${content}\n   session=${result.sessionId} message=${result.messageId}`;
    }).join("\n");
  }
}

function toFtsQuery(query: string): string {
  return query
    .split(/\s+/)
    .map((part) => part.replace(/["']/g, "").trim())
    .filter(Boolean)
    .map((part) => `"${part}"`)
    .join(" OR ");
}
