import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { parseJson, stringifyJson, type JsonValue } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";
import type { AgentType } from "../runtime/types.js";

export type AgentDefaultScopeType = "user" | "channel" | "workspace" | "system";

export type AgentDefaultRecord = {
  id: string;
  scopeType: AgentDefaultScopeType;
  scopeRef: string;
  agentType: AgentType;
  params: JsonValue;
  createdAt: string;
  updatedAt: string;
};

export type UpsertAgentDefaultInput = {
  id?: string;
  scopeType: AgentDefaultScopeType;
  scopeRef: string;
  agentType: AgentType;
  params?: JsonValue;
  updatedAt?: string;
};

type AgentDefaultRow = {
  id: string;
  scope_type: AgentDefaultScopeType;
  scope_ref: string;
  agent_type: AgentType;
  params_json: string;
  created_at: string;
  updated_at: string;
};

export class AgentDefaultStore {
  constructor(private readonly db: SqliteDatabase) {}

  get(scopeType: AgentDefaultScopeType, scopeRef: string): AgentDefaultRecord | null {
    const row = this.db
      .prepare("SELECT * FROM agent_defaults WHERE scope_type = ? AND scope_ref = ?")
      .get(scopeType, scopeRef) as AgentDefaultRow | undefined;

    return row ? mapAgentDefaultRow(row) : null;
  }

  upsert(input: UpsertAgentDefaultInput): AgentDefaultRecord {
    const timestamp = input.updatedAt ?? nowIso();
    const row = this.db
      .prepare(
        `
        INSERT INTO agent_defaults (
          id, scope_type, scope_ref, agent_type, params_json, created_at, updated_at
        )
        VALUES (
          @id, @scopeType, @scopeRef, @agentType, @paramsJson, @createdAt, @updatedAt
        )
        ON CONFLICT(scope_type, scope_ref) DO UPDATE SET
          agent_type = excluded.agent_type,
          params_json = excluded.params_json,
          updated_at = excluded.updated_at
        RETURNING *
      `,
      )
      .get({
        id: input.id ?? createId("agd"),
        scopeType: input.scopeType,
        scopeRef: input.scopeRef,
        agentType: input.agentType,
        paramsJson: stringifyJson(input.params ?? {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      }) as AgentDefaultRow;

    return mapAgentDefaultRow(row);
  }
}

function mapAgentDefaultRow(row: AgentDefaultRow): AgentDefaultRecord {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeRef: row.scope_ref,
    agentType: row.agent_type,
    params: parseJson(row.params_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
