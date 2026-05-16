import { createRequire } from "node:module";
import type { AgentType, AgentProbeResult, RuntimeSessionDriver } from "./types.js";
import { AcpRuntimeDriver } from "./acp/driver.js";

const require = createRequire(import.meta.url);

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
    const acpBin = resolveAcpBin("claude-agent-acp");
    const claudeDriver = new AcpRuntimeDriver({
      agentType: "claude",
      displayName: "Claude",
      command: acpBin,
    });
    this.drivers.set("claude:acp", claudeDriver);
    // Future: codex, trae
  }
}

function resolveAcpBin(name: string): string {
  try {
    return require.resolve(`@agentclientprotocol/${name}/dist/index.js`);
  } catch {
    // Fallback: try node_modules/.bin
    return `node_modules/.bin/${name}`;
  }
}
