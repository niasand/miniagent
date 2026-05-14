import type { RuntimeProcess } from "../process.js";
import type { RuntimeDriverCallbacks, RuntimeDriverStartContext, RuntimeRunHandle, RuntimeSessionDriver } from "../driver.js";
import type {
  AgentRuntimeAdapter,
  RuntimeInput,
  RuntimeEventDraft,
  RuntimeCapabilities,
  AgentProbeResult,
  RuntimeErrorClassification,
  RuntimeLaunchContext,
  RuntimeLaunchSpec,
} from "../types.js";

export class LegacyCliRuntimeDriver implements RuntimeSessionDriver {
  readonly runtimeKind = "cli";
  readonly agentType;
  readonly displayName;
  readonly command;

  constructor(private readonly adapter: AgentRuntimeAdapter) {
    this.agentType = adapter.agentType;
    this.displayName = adapter.displayName;
    this.command = adapter.command;
  }

  capabilities(): RuntimeCapabilities {
    return this.adapter.capabilities();
  }

  probe(): Promise<AgentProbeResult> {
    return this.adapter.probe();
  }

  createLaunchSpec(context: RuntimeLaunchContext): RuntimeLaunchSpec {
    return this.adapter.createLaunchSpec(context);
  }

  classifyError(error: unknown): RuntimeErrorClassification {
    return this.adapter.classifyError(error);
  }

  start(
    _context: RuntimeDriverStartContext,
    process: RuntimeProcess,
    callbacks: RuntimeDriverCallbacks,
  ): RuntimeRunHandle {
    process.onOutput((chunk) => {
      callbacks.emit(this.adapter.decodeOutput(chunk));
    });
    process.onExit((exit) => callbacks.exit(exit));

    return {
      sendInput: (input: RuntimeInput) => process.write(this.adapter.encodeInput(input)),
      stop: () => process.stop("SIGTERM"),
      flush: (): RuntimeEventDraft[] => [],
    };
  }
}
