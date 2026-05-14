import type { SqliteDatabase } from "../db/migrate.js";
import type { JsonValue } from "../../shared/json.js";
import type { AgentType } from "../runtime/types.js";
import {
  AgentDefaultStore,
  type AgentDefaultRecord,
  type AgentDefaultScopeType,
} from "./agent-default-store.js";

export type SetAgentDefaultInput = {
  scopeType: AgentDefaultScopeType;
  scopeRef: string;
  agentType: AgentType;
  params?: JsonValue;
};

export type ResolveAgentDefaultInput = {
  userRef?: string | null;
  channelRef?: string | null;
  workspacePath?: string | null;
};

export class DefaultAgentService {
  private readonly defaults: AgentDefaultStore;

  constructor(db: SqliteDatabase) {
    this.defaults = new AgentDefaultStore(db);
  }

  setDefault(input: SetAgentDefaultInput): AgentDefaultRecord {
    const scopeRef = normalizeScopeRef(input.scopeType, input.scopeRef);
    return this.defaults.upsert({
      scopeType: input.scopeType,
      scopeRef,
      agentType: input.agentType,
      params: input.params ?? {},
    });
  }

  resolve(input: ResolveAgentDefaultInput = {}): AgentDefaultRecord {
    const candidates: Array<[AgentDefaultScopeType, string | null | undefined]> = [
      ["user", input.userRef],
      ["channel", input.channelRef],
      ["workspace", input.workspacePath],
      ["system", "global"],
    ];

    for (const [scopeType, rawScopeRef] of candidates) {
      if (!rawScopeRef) {
        continue;
      }

      const record = this.defaults.get(scopeType, normalizeScopeRef(scopeType, rawScopeRef));
      if (record) {
        return record;
      }
    }

    throw new Error("System default agent is not configured");
  }
}

function normalizeScopeRef(scopeType: AgentDefaultScopeType, scopeRef: string): string {
  const trimmed = scopeRef.trim();
  if (!trimmed) {
    throw new Error("scopeRef is required");
  }
  if (scopeType === "system") {
    return "global";
  }
  return trimmed;
}
