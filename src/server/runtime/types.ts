import type { JsonObject, JsonValue } from "../../shared/json.js";
import type { RuntimeProcess, RuntimeProcessExit } from "./process.js";

export type AgentType = "codex" | "claude" | "trae";
export type RuntimeKind = "cli" | "acp";
export type AgentHealthStatus = "unknown" | "healthy" | "missing" | "auth_required" | "failed";

export type RuntimeCapabilities = {
  textStreaming: boolean;
  structuredEvents: boolean;
  nativeCompact: boolean;
  resume: boolean;
  sessionExport: boolean;
  permissionPrompt: boolean;
  imageInput: boolean;
};

export type AgentProbeResult = {
  agentType: AgentType;
  status: AgentHealthStatus;
  command: string;
  version: string | null;
  message: string | null;
  checkedAt: string;
};

export type RuntimeSessionContext = {
  id: string;
  agentType: string;
  workspacePath: string;
  defaultParams?: JsonObject;
};

export type RuntimeTaskContext = {
  id: string;
  type: string;
  input?: JsonValue;
};

export type RuntimeRunContext = {
  id: string;
};

export type RuntimeLaunchContext = {
  session: RuntimeSessionContext;
  task?: RuntimeTaskContext;
  run: RuntimeRunContext;
};

export type RuntimeLaunchSpec = JsonObject & {
  agentType: AgentType;
  runtimeKind?: RuntimeKind;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  envSummary: Record<string, "set" | "unset">;
};

export type RuntimeInput = {
  taskType: string;
  input: JsonValue;
};

export type RuntimeOutputChunk = {
  stream: "stdout" | "stderr";
  text: string;
  receivedAt: string;
};

export type RuntimeEventDraft = {
  type:
    | "text_delta"
    | "runtime_stderr"
    | "permission_prompt"
    | "context_budget_changed"
    | "runtime_event"
    | "tool_call"
    | "tool_call_update"
    | "acp_session_started"
    | "acp_cancel_requested"
    | "usage_report";
  payload: JsonObject;
};

export type RuntimeErrorClass =
  | "authentication_failed"
  | "permission_wait"
  | "context_overflow"
  | "process_crash"
  | "user_cancelled"
  | "unknown";

export type RuntimeErrorClassification = {
  class: RuntimeErrorClass;
  message: string;
  retryable: boolean;
};

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
