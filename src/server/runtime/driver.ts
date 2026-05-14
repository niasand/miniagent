import type { JsonObject } from "../../shared/json.js";
import type { RuntimeProcess, RuntimeProcessExit } from "./process.js";
import type {
  AgentProbeResult,
  AgentRuntimeAdapter,
  AgentType,
  RuntimeCapabilities,
  RuntimeErrorClassification,
  RuntimeInput,
  RuntimeLaunchContext,
  RuntimeLaunchSpec,
  RuntimeEventDraft,
} from "./types.js";

export type RuntimeKind = "cli" | "acp";

export type RuntimeDriverStartContext = RuntimeLaunchContext & {
  launchSpec: RuntimeLaunchSpec;
};

export type RuntimePermissionResponseInput = {
  requestId: string;
  outcome: "selected" | "cancelled";
  optionId?: string;
};

export type RuntimeDriverCallbacks = {
  emit: (drafts: RuntimeEventDraft | RuntimeEventDraft[]) => void;
  exit: (exit: RuntimeProcessExit) => void;
  updateProtocolState?: (state: RuntimeProtocolStateUpdate) => void;
};

export type RuntimeProtocolStateUpdate = {
  externalSessionId?: string | null;
  checkpointId?: string | null;
  protocolState?: JsonObject;
  cancelState?: string | null;
};

export interface RuntimeRunHandle {
  sendInput(input: RuntimeInput): void;
  stop(): void;
  flush(): RuntimeEventDraft[];
  respondPermission?(input: RuntimePermissionResponseInput): void;
}

export interface RuntimeSessionDriver {
  readonly runtimeKind: RuntimeKind;
  readonly agentType: AgentType;
  readonly displayName: string;
  readonly command: string;

  capabilities(): RuntimeCapabilities;
  probe(): Promise<AgentProbeResult>;
  createLaunchSpec(context: RuntimeLaunchContext): RuntimeLaunchSpec;
  classifyError(error: unknown): RuntimeErrorClassification;
  start(context: RuntimeDriverStartContext, process: RuntimeProcess, callbacks: RuntimeDriverCallbacks): RuntimeRunHandle;
}

export function isRuntimeSessionDriver(value: AgentRuntimeAdapter | RuntimeSessionDriver): value is RuntimeSessionDriver {
  return typeof (value as RuntimeSessionDriver).start === "function";
}
