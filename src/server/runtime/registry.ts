import type { AgentType, AgentProbeResult, RuntimeSessionDriver } from "./types.js";
import { AcpRuntimeDriver } from "./acp/driver.js";

export class RuntimeAdapterRegistry {
  private drivers = new Map<string, RuntimeSessionDriver>();

  constructor() {
    this.registerAcpDrivers();
  }

  get(agentType: string, runtimeKind: string): RuntimeSessionDriver {
    const key = `${agentType}:${runtimeKind}`;
    const driver = this.drivers.get(key);
    if (!driver) throw new Error(`No driver for ${key}`);
    return driver;
  }

  async listAgents(): Promise<AgentProbeResult[]> {
    const results: AgentProbeResult[] = [];
    const seen = new Set<string>();
    for (const driver of this.drivers.values()) {
      const key = driver.agentType;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        results.push(await driver.probe());
      } catch {
        results.push({
          agentType: driver.agentType as AgentType,
          status: "missing",
          command: driver.command,
          version: null,
          message: "Probe failed",
          checkedAt: new Date().toISOString(),
        });
      }
    }
    return results;
  }

  defaultRuntimeKind(_agentType: string): string {
    return "acp";
  }

  private registerAcpDrivers(): void {
    const claudeDriver = new AcpRuntimeDriver("claude");
    this.drivers.set("claude:acp", claudeDriver);
    // Future: codex, trae
  }
}
