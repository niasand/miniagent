import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { parseJson, stringifyJson, type JsonValue } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";

export type AgentDefaultScopeType = "user" | "channel" | "workspace" | "system";

export type AgentDefaultRecord = {
  id: string;
  scopeType: AgentDefaultScopeType;
  scopeRef: string;
  agentType: string;
  params: JsonValue;
  updatedAt: string;
};

type AgentDefaultRow = {
  id: string; scope_type: string; scope_ref: string;
  agent_type: string; params_json: string; updated_at: string;
};

export class AgentDefaultStore {
  constructor(private readonly db: SqliteDatabase) {}

  set(input: { scopeType: AgentDefaultScopeType; scopeRef: string; agentType: string; params?: JsonValue }): AgentDefaultRecord {
    const now = nowIso();
    this.db.prepare(
      `INSERT INTO agent_defaults (id, scope_type, scope_ref, agent_type, params_json, created_at, updated_at)
       VALUES (@id, @scopeType, @scopeRef, @agentType, @paramsJson, @createdAt, @updatedAt)
       ON CONFLICT (scope_type, scope_ref) DO UPDATE SET agent_type = @agentType, params_json = @paramsJson, updated_at = @updatedAt`
    ).run({
      id: createId("agd"),
      scopeType: input.scopeType,
      scopeRef: input.scopeRef,
      agentType: input.agentType,
      paramsJson: stringifyJson(input.params ?? {}),
      createdAt: now,
      updatedAt: now,
    });
    const row = this.db.prepare("SELECT * FROM agent_defaults WHERE scope_type = ? AND scope_ref = ?").get(input.scopeType, input.scopeRef) as AgentDefaultRow;
    return mapRow(row);
  }

  resolve(options: { userRef?: string; channelRef?: string; workspacePath?: string }): AgentDefaultRecord | null {
    // Priority: user > channel > workspace > system
    const scopes: Array<{ scopeType: AgentDefaultScopeType; scopeRef: string }> = [];
    if (options.userRef) scopes.push({ scopeType: "user", scopeRef: options.userRef });
    if (options.channelRef) scopes.push({ scopeType: "channel", scopeRef: options.channelRef });
    if (options.workspacePath) scopes.push({ scopeType: "workspace", scopeRef: options.workspacePath });
    scopes.push({ scopeType: "system", scopeRef: "default" });

    for (const scope of scopes) {
      const row = this.db.prepare("SELECT * FROM agent_defaults WHERE scope_type = ? AND scope_ref = ?").get(scope.scopeType, scope.scopeRef) as AgentDefaultRow | undefined;
      if (row) return mapRow(row);
    }
    return null;
  }
}

function mapRow(row: AgentDefaultRow): AgentDefaultRecord {
  return {
    id: row.id, scopeType: row.scope_type as AgentDefaultScopeType,
    scopeRef: row.scope_ref, agentType: row.agent_type,
    params: parseJson(row.params_json), updatedAt: row.updated_at,
  };
}
