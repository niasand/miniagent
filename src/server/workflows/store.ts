import type { SqliteDatabase } from "../db/migrate.js";
import { parseJson, stringifyJson, type JsonValue } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";
import type { WorkflowDefinition } from "./definition.js";

export type WorkflowRunStatus = "running" | "waiting_gate" | "succeeded" | "failed" | "cancelled";

export interface WorkflowRunRecord {
  id: string;
  sessionId: string;
  definition: WorkflowDefinition;
  status: WorkflowRunStatus;
  currentGateNode: string | null;
  startedAt: string;
  finishedAt: string | null;
  errorNode: string | null;
  errorReason: string | null;
  createdAt: string;
  updatedAt: string;
}

type WorkflowRunRow = {
  id: string; session_id: string; definition_json: string; status: string;
  current_gate_node: string | null; started_at: string; finished_at: string | null;
  error_node: string | null; error_reason: string | null;
  created_at: string; updated_at: string;
};

export class WorkflowRunStore {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: { id: string; sessionId: string; definition: WorkflowDefinition; startedAt?: string }): WorkflowRunRecord {
    const now = input.startedAt ?? nowIso();
    this.db.prepare(
      `INSERT INTO workflow_runs (id, session_id, definition_json, status, started_at, created_at, updated_at)
       VALUES (@id, @sessionId, @definitionJson, 'running', @startedAt, @createdAt, @updatedAt)`,
    ).run({
      id: input.id,
      sessionId: input.sessionId,
      definitionJson: stringifyJson(input.definition as unknown as JsonValue),
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return this.get(input.id)!;
  }

  get(id: string): WorkflowRunRecord | null {
    const row = this.db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id) as WorkflowRunRow | undefined;
    return row ? mapRow(row) : null;
  }

  listByStatus(statuses: WorkflowRunStatus[]): WorkflowRunRecord[] {
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM workflow_runs WHERE status IN (${placeholders}) ORDER BY updated_at ASC`)
      .all(...statuses) as WorkflowRunRow[];
    return rows.map(mapRow);
  }

  listRecent(limit = 50): WorkflowRunRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM workflow_runs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as WorkflowRunRow[];
    return rows.map(mapRow);
  }

  /** All fields are set explicitly so callers can clear a value by passing null. */
  updateStatus(
    id: string,
    fields: {
      status: WorkflowRunStatus;
      currentGateNode: string | null;
      finishedAt: string | null;
      errorNode: string | null;
      errorReason: string | null;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE workflow_runs SET status = @status, current_gate_node = @currentGateNode,
          finished_at = @finishedAt, error_node = @errorNode, error_reason = @errorReason,
          updated_at = @updatedAt WHERE id = @id`,
      )
      .run({ id, ...fields, updatedAt: nowIso() });
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM workflow_runs WHERE id = ?").run(id);
  }
}

function mapRow(row: WorkflowRunRow): WorkflowRunRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    definition: parseJson(row.definition_json) as unknown as WorkflowDefinition,
    status: row.status as WorkflowRunStatus,
    currentGateNode: row.current_gate_node,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorNode: row.error_node,
    errorReason: row.error_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
