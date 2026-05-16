import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { parseJson, stringifyJson, type JsonValue } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";

export type PermissionStatus = "pending" | "approved" | "denied" | "cancelled" | "expired";

export type PermissionRequestRecord = {
  id: string;
  sessionId: string;
  runId: string;
  taskId: string | null;
  eventId: string | null;
  acpRequestId: string | null;
  protocol: "acp" | "legacy_cli";
  status: PermissionStatus;
  prompt: string;
  options: JsonValue;
  toolCall: JsonValue;
  selectedOptionId: string | null;
  expiresAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type PermissionRow = {
  id: string; session_id: string; run_id: string; task_id: string | null;
  event_id: string | null; acp_request_id: string | null; protocol: string;
  status: string; prompt: string; options_json: string; tool_call_json: string;
  selected_option_id: string | null; expires_at: string | null;
  resolved_at: string | null; created_at: string; updated_at: string;
};

export class PermissionRequestStore {
  constructor(private readonly db: SqliteDatabase) {}

  upsert(input: {
    sessionId: string; runId: string; taskId?: string | null;
    eventId?: string | null; acpRequestId?: string | null;
    prompt?: string; options?: JsonValue; toolCall?: JsonValue;
    expiresAt?: string | null;
  }): PermissionRequestRecord {
    const now = nowIso();
    let id = createId("prm");

    // Try to find existing by run + acpRequestId
    if (input.acpRequestId) {
      const existing = this.db.prepare("SELECT * FROM permission_requests WHERE run_id = ? AND acp_request_id = ?").get(input.runId, input.acpRequestId) as PermissionRow | undefined;
      if (existing) {
        this.db.prepare(
          `UPDATE permission_requests SET prompt = @prompt, options_json = @optionsJson, tool_call_json = @toolCallJson, status = 'pending', expires_at = @expiresAt, updated_at = @updatedAt WHERE id = @id`
        ).run({
          id: existing.id, prompt: input.prompt ?? existing.prompt,
          optionsJson: stringifyJson(input.options ?? parseJson(existing.options_json)),
          toolCallJson: stringifyJson(input.toolCall ?? parseJson(existing.tool_call_json)),
          expiresAt: input.expiresAt ?? existing.expires_at, updatedAt: now,
        });
        id = existing.id;
        return this.require(id);
      }
    }

    this.db.prepare(
      `INSERT INTO permission_requests (id, session_id, run_id, task_id, event_id, acp_request_id, protocol, status, prompt, options_json, tool_call_json, created_at, updated_at)
       VALUES (@id, @sessionId, @runId, @taskId, @eventId, @acpRequestId, 'acp', 'pending', @prompt, @optionsJson, @toolCallJson, @createdAt, @updatedAt)`
    ).run({
      id, sessionId: input.sessionId, runId: input.runId,
      taskId: input.taskId ?? null, eventId: input.eventId ?? null,
      acpRequestId: input.acpRequestId ?? null,
      prompt: input.prompt ?? "",
      optionsJson: stringifyJson(input.options ?? []),
      toolCallJson: stringifyJson(input.toolCall ?? {}),
      createdAt: now, updatedAt: now,
    });
    return this.require(id);
  }

  respond(runId: string, acpRequestId: string, outcome: "approved" | "denied" | "cancelled", selectedOptionId?: string): PermissionRequestRecord | null {
    const now = nowIso();
    const row = this.db.prepare("SELECT * FROM permission_requests WHERE run_id = ? AND acp_request_id = ?").get(runId, acpRequestId) as PermissionRow | undefined;
    if (!row) return null;
    this.db.prepare(
      `UPDATE permission_requests SET status = @status, selected_option_id = @selectedOptionId, resolved_at = @resolvedAt, updated_at = @updatedAt WHERE id = @id`
    ).run({
      id: row.id, status: outcome === "approved" ? "approved" : outcome === "denied" ? "denied" : "cancelled",
      selectedOptionId: selectedOptionId ?? null, resolvedAt: now, updatedAt: now,
    });
    return this.require(row.id);
  }

  listByRun(runId: string): PermissionRequestRecord[] {
    const rows = this.db.prepare("SELECT * FROM permission_requests WHERE run_id = ? ORDER BY created_at ASC").all(runId) as PermissionRow[];
    return rows.map(mapRow);
  }

  private require(id: string): PermissionRequestRecord {
    const row = this.db.prepare("SELECT * FROM permission_requests WHERE id = ?").get(id) as PermissionRow;
    return mapRow(row);
  }
}

function mapRow(row: PermissionRow): PermissionRequestRecord {
  return {
    id: row.id, sessionId: row.session_id, runId: row.run_id,
    taskId: row.task_id, eventId: row.event_id,
    acpRequestId: row.acp_request_id, protocol: row.protocol as "acp" | "legacy_cli",
    status: row.status as PermissionStatus, prompt: row.prompt,
    options: parseJson(row.options_json), toolCall: parseJson(row.tool_call_json),
    selectedOptionId: row.selected_option_id, expiresAt: row.expires_at,
    resolvedAt: row.resolved_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
