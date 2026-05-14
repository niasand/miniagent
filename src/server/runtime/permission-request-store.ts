import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { parseJson, stringifyJson, type JsonObject, type JsonValue } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";
import type { StoredEvent } from "../events/event-store.js";

export type PermissionRequestStatus = "pending" | "approved" | "denied" | "cancelled" | "expired";

export type PermissionRequestRecord = {
  id: string;
  sessionId: string;
  runId: string;
  taskId: string | null;
  eventId: string | null;
  acpRequestId: string | null;
  protocol: "acp" | "legacy_cli";
  status: PermissionRequestStatus;
  prompt: string;
  options: JsonValue;
  toolCall: JsonValue;
  selectedOptionId: string | null;
  expiresAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsertPermissionPromptInput = {
  event: StoredEvent;
  payload: JsonObject;
};

export type ResolvePermissionInput = {
  runId: string;
  requestId: string;
  status: Extract<PermissionRequestStatus, "approved" | "denied" | "cancelled">;
  selectedOptionId?: string | null;
  resolvedAt?: string;
};

type PermissionRequestRow = {
  id: string;
  session_id: string;
  run_id: string;
  task_id: string | null;
  event_id: string | null;
  acp_request_id: string | null;
  protocol: "acp" | "legacy_cli";
  status: PermissionRequestStatus;
  prompt: string;
  options_json: string;
  tool_call_json: string;
  selected_option_id: string | null;
  expires_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export class PermissionRequestStore {
  constructor(private readonly db: SqliteDatabase) {}

  upsertPrompt(input: UpsertPermissionPromptInput): PermissionRequestRecord | null {
    if (!input.event.runId) {
      return null;
    }

    const protocol = input.payload.protocol === "legacy_cli" ? "legacy_cli" : "acp";
    const acpRequestId = readString(input.payload, "requestId");
    const timestamp = input.event.createdAt;
    const row = this.db
      .prepare(
        `
        INSERT INTO permission_requests (
          id, session_id, run_id, task_id, event_id, acp_request_id, protocol,
          status, prompt, options_json, tool_call_json, created_at, updated_at
        )
        VALUES (
          @id, @sessionId, @runId, @taskId, @eventId, @acpRequestId, @protocol,
          'pending', @prompt, @optionsJson, @toolCallJson, @createdAt, @updatedAt
        )
        ON CONFLICT (run_id, acp_request_id) DO UPDATE SET
          event_id = excluded.event_id,
          status = 'pending',
          prompt = excluded.prompt,
          options_json = excluded.options_json,
          tool_call_json = excluded.tool_call_json,
          updated_at = excluded.updated_at
        RETURNING *
      `,
      )
      .get({
        id: createId("prm"),
        sessionId: input.event.sessionId,
        runId: input.event.runId,
        taskId: input.event.taskId,
        eventId: input.event.id,
        acpRequestId,
        protocol,
        prompt: readPrompt(input.payload),
        optionsJson: stringifyJson(readJson(input.payload.options, [])),
        toolCallJson: stringifyJson(readJson(input.payload.toolCall, {})),
        createdAt: timestamp,
        updatedAt: timestamp,
      }) as PermissionRequestRow;

    return mapPermissionRequestRow(row);
  }

  resolve(input: ResolvePermissionInput): PermissionRequestRecord {
    const resolvedAt = input.resolvedAt ?? nowIso();
    const row = this.db
      .prepare(
        `
        UPDATE permission_requests
        SET status = @status,
            selected_option_id = @selectedOptionId,
            resolved_at = @resolvedAt,
            updated_at = @updatedAt
        WHERE run_id = @runId
          AND acp_request_id = @requestId
          AND status = 'pending'
        RETURNING *
      `,
      )
      .get({
        runId: input.runId,
        requestId: input.requestId,
        status: input.status,
        selectedOptionId: input.selectedOptionId ?? null,
        resolvedAt,
        updatedAt: resolvedAt,
      }) as PermissionRequestRow | undefined;

    if (!row) {
      throw new Error(`Permission request is not pending: ${input.requestId}`);
    }

    return mapPermissionRequestRow(row);
  }

  listByRun(runId: string): PermissionRequestRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM permission_requests
        WHERE run_id = ?
        ORDER BY created_at ASC, id ASC
      `,
      )
      .all(runId) as PermissionRequestRow[];

    return rows.map(mapPermissionRequestRow);
  }
}

function mapPermissionRequestRow(row: PermissionRequestRow): PermissionRequestRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id,
    taskId: row.task_id,
    eventId: row.event_id,
    acpRequestId: row.acp_request_id,
    protocol: row.protocol,
    status: row.status,
    prompt: row.prompt,
    options: parseJson(row.options_json),
    toolCall: parseJson(row.tool_call_json),
    selectedOptionId: row.selected_option_id,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readPrompt(payload: JsonObject): string {
  return readString(payload, "prompt") ?? readString(payload, "text") ?? "Agent requests permission";
}

function readString(payload: JsonObject, key: string): string | null {
  return typeof payload[key] === "string" ? payload[key] : null;
}

function readJson(value: JsonValue | undefined, fallback: JsonValue): JsonValue {
  return value === undefined ? fallback : value;
}
