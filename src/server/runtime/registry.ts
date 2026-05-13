import type { AgentRuntimeAdapter, AgentType } from "./types.js";
import { ClaudeRuntimeAdapter } from "./adapters/claude-adapter.js";
import { CodexRuntimeAdapter } from "./adapters/codex-adapter.js";
import { TraeRuntimeAdapter } from "./adapters/trae-adapter.js";

export class RuntimeAdapterRegistry {
  private readonly adapters = new Map<AgentType, AgentRuntimeAdapter>();

  constructor(adapters: AgentRuntimeAdapter[] = defaultRuntimeAdapters()) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter: AgentRuntimeAdapter): void {
    this.adapters.set(adapter.agentType, adapter);
  }

  get(agentType: AgentType): AgentRuntimeAdapter {
    const adapter = this.adapters.get(agentType);
    if (!adapter) {
      throw new Error(`Runtime adapter not registered: ${agentType}`);
    }
    return adapter;
  }

  list(): AgentRuntimeAdapter[] {
    return [...this.adapters.values()];
  }
}

export function defaultRuntimeAdapters(): AgentRuntimeAdapter[] {
  return [new CodexRuntimeAdapter(), new ClaudeRuntimeAdapter(), new TraeRuntimeAdapter()];
}
