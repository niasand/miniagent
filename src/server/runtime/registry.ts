import type { RuntimeKind, RuntimeSessionDriver } from "./driver.js";
import { isRuntimeSessionDriver } from "./driver.js";
import type { AgentRuntimeAdapter, AgentType } from "./types.js";
import { ClaudeRuntimeAdapter } from "./adapters/claude-adapter.js";
import { CodexRuntimeAdapter } from "./adapters/codex-adapter.js";
import { TraeRuntimeAdapter } from "./adapters/trae-adapter.js";
import { AcpRuntimeDriver } from "./drivers/acp-runtime-driver.js";
import { LegacyCliRuntimeDriver } from "./drivers/legacy-cli-driver.js";

export class RuntimeAdapterRegistry {
  private readonly adapters = new Map<string, RuntimeSessionDriver>();
  private readonly defaultRuntimeKinds = new Map<AgentType, RuntimeKind>();

  constructor(adapters: Array<AgentRuntimeAdapter | RuntimeSessionDriver> = defaultRuntimeAdapters()) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter: AgentRuntimeAdapter | RuntimeSessionDriver): void {
    const driver = isRuntimeSessionDriver(adapter) ? adapter : new LegacyCliRuntimeDriver(adapter);
    this.adapters.set(adapterKey(driver.agentType, driver.runtimeKind), driver);
    this.defaultRuntimeKinds.set(driver.agentType, this.defaultRuntimeKinds.get(driver.agentType) ?? driver.runtimeKind);
  }

  get(agentType: AgentType, runtimeKind?: RuntimeKind): RuntimeSessionDriver {
    const selectedRuntimeKind = runtimeKind ?? this.defaultRuntimeKind(agentType);
    const adapter = this.adapters.get(adapterKey(agentType, selectedRuntimeKind));
    if (!adapter) {
      throw new Error(`Runtime adapter not registered: ${agentType}/${selectedRuntimeKind}`);
    }
    return adapter;
  }

  list(): RuntimeSessionDriver[] {
    return [...this.adapters.values()];
  }

  defaultRuntimeKind(agentType: AgentType): RuntimeKind {
    const runtimeKind = this.defaultRuntimeKinds.get(agentType);
    if (!runtimeKind) {
      throw new Error(`Runtime adapter not registered: ${agentType}`);
    }
    return runtimeKind;
  }
}

export function defaultRuntimeAdapters(): Array<AgentRuntimeAdapter | RuntimeSessionDriver> {
  const runtimeMode = readRuntimeMode();
  const cli = [new CodexRuntimeAdapter(), new ClaudeRuntimeAdapter(), new TraeRuntimeAdapter()];
  const acp = [
    new AcpRuntimeDriver({
      agentType: "codex",
      displayName: "Codex ACP",
      command: process.env.MINIAGENT_CODEX_ACP_COMMAND ?? "codex",
      defaultArgs: readEnvArgs("MINIAGENT_CODEX_ACP_ARGS"),
    }),
    new AcpRuntimeDriver({
      agentType: "claude",
      displayName: "Claude ACP",
      command: process.env.MINIAGENT_CLAUDE_ACP_COMMAND ?? "claude",
      defaultArgs: readEnvArgs("MINIAGENT_CLAUDE_ACP_ARGS"),
    }),
    new AcpRuntimeDriver({
      agentType: "trae",
      displayName: "Trae ACP",
      command: process.env.MINIAGENT_TRAE_ACP_COMMAND ?? "trae",
      defaultArgs: readEnvArgs("MINIAGENT_TRAE_ACP_ARGS"),
    }),
  ];

  if (runtimeMode === "acp") {
    return acp;
  }
  if (runtimeMode === "hybrid") {
    return [...cli, ...acp];
  }
  return cli;
}

function adapterKey(agentType: AgentType, runtimeKind: RuntimeKind): string {
  return `${agentType}:${runtimeKind}`;
}

function readRuntimeMode(): "cli" | "acp" | "hybrid" {
  const value = process.env.MINIAGENT_RUNTIME;
  return value === "acp" || value === "hybrid" ? value : "cli";
}

function readEnvArgs(name: string): string[] {
  const value = process.env[name];
  if (!value) {
    return [];
  }
  return value.split(" ").map((item) => item.trim()).filter(Boolean);
}
