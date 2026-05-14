import type { RuntimeSessionDriver } from "./driver.js";
import { isRuntimeSessionDriver } from "./driver.js";
import type { AgentRuntimeAdapter, AgentType } from "./types.js";
import { ClaudeRuntimeAdapter } from "./adapters/claude-adapter.js";
import { CodexRuntimeAdapter } from "./adapters/codex-adapter.js";
import { TraeRuntimeAdapter } from "./adapters/trae-adapter.js";
import { LegacyCliRuntimeDriver } from "./drivers/legacy-cli-driver.js";

export class RuntimeAdapterRegistry {
  private readonly adapters = new Map<AgentType, RuntimeSessionDriver>();

  constructor(adapters: Array<AgentRuntimeAdapter | RuntimeSessionDriver> = defaultRuntimeAdapters()) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter: AgentRuntimeAdapter | RuntimeSessionDriver): void {
    const driver = isRuntimeSessionDriver(adapter) ? adapter : new LegacyCliRuntimeDriver(adapter);
    this.adapters.set(driver.agentType, driver);
  }

  get(agentType: AgentType): RuntimeSessionDriver {
    const adapter = this.adapters.get(agentType);
    if (!adapter) {
      throw new Error(`Runtime adapter not registered: ${agentType}`);
    }
    return adapter;
  }

  list(): RuntimeSessionDriver[] {
    return [...this.adapters.values()];
  }
}

export function defaultRuntimeAdapters(): AgentRuntimeAdapter[] {
  return [new CodexRuntimeAdapter(), new ClaudeRuntimeAdapter(), new TraeRuntimeAdapter()];
}
