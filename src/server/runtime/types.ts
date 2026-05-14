import type { JsonObject, JsonValue } from "../../shared/json.js";

export type AgentType = "codex" | "claude" | "trae";

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
  runtimeKind?: "cli" | "acp";
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
    | "acp_cancel_requested";
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

export interface AgentRuntimeAdapter {
  readonly agentType: AgentType;
  readonly displayName: string;
  readonly command: string;

  capabilities(): RuntimeCapabilities;
  probe(): Promise<AgentProbeResult>;
  createLaunchSpec(context: RuntimeLaunchContext): RuntimeLaunchSpec;
  encodeInput(input: RuntimeInput): string;
  decodeOutput(chunk: RuntimeOutputChunk): RuntimeEventDraft[];
  classifyError(error: unknown): RuntimeErrorClassification;
}
