import type { CommandRunner } from "../command-runner.js";
import { DefaultCommandRunner } from "../command-runner.js";
import type {
  AgentProbeResult,
  AgentRuntimeAdapter,
  AgentType,
  RuntimeCapabilities,
  RuntimeErrorClassification,
  RuntimeInput,
  RuntimeLaunchContext,
  RuntimeLaunchSpec,
  RuntimeOutputChunk,
  RuntimeEventDraft,
} from "../types.js";
import { nowIso } from "../../../shared/time.js";
import type { JsonObject, JsonValue } from "../../../shared/json.js";

type BaseCliAdapterOptions = {
  agentType: AgentType;
  displayName: string;
  command: string;
  defaultArgs?: string[];
  capabilities?: Partial<RuntimeCapabilities>;
  commandRunner?: CommandRunner;
};

const defaultCapabilities: RuntimeCapabilities = {
  textStreaming: true,
  structuredEvents: false,
  nativeCompact: false,
  resume: false,
  sessionExport: false,
  permissionPrompt: false,
  imageInput: false,
};

export abstract class BaseCliRuntimeAdapter implements AgentRuntimeAdapter {
  readonly agentType: AgentType;
  readonly displayName: string;
  readonly command: string;

  private readonly defaultArgs: string[];
  private readonly declaredCapabilities: RuntimeCapabilities;
  private readonly commandRunner: CommandRunner;

  protected constructor(options: BaseCliAdapterOptions) {
    this.agentType = options.agentType;
    this.displayName = options.displayName;
    this.command = options.command;
    this.defaultArgs = options.defaultArgs ?? [];
    this.declaredCapabilities = { ...defaultCapabilities, ...options.capabilities };
    this.commandRunner = options.commandRunner ?? new DefaultCommandRunner();
  }

  capabilities(): RuntimeCapabilities {
    return this.declaredCapabilities;
  }

  async probe(): Promise<AgentProbeResult> {
    const result = this.commandRunner.run(this.command, ["--version"], { timeoutMs: 2_000 });
    const output = `${result.stdout}\n${result.stderr}`.trim();

    if (result.errorCode === "ENOENT") {
      return this.probeResult("missing", null, `${this.command} was not found on PATH`);
    }

    if (looksLikeAuthFailure(output)) {
      return this.probeResult("auth_required", null, output);
    }

    if (result.exitCode !== 0) {
      return this.probeResult("failed", null, output || result.errorMessage || "Probe command failed");
    }

    return this.probeResult("healthy", output || null, null);
  }

  createLaunchSpec(context: RuntimeLaunchContext): RuntimeLaunchSpec {
    return {
      agentType: this.agentType,
      command: this.command,
      args: [...this.defaultArgs, ...readStringArray(context.session.defaultParams, "args")],
      cwd: context.session.workspacePath,
      env: {},
      envSummary: {},
    };
  }

  encodeInput(input: RuntimeInput): string {
    return `${readInputText(input.input)}\n`;
  }

  decodeOutput(chunk: RuntimeOutputChunk): RuntimeEventDraft[] {
    const text = chunk.text;
    if (!text) {
      return [];
    }

    if (looksLikePermissionPrompt(text)) {
      return [
        {
          type: "permission_prompt",
          payload: {
            text,
            stream: chunk.stream,
            receivedAt: chunk.receivedAt,
            status: "waiting",
          },
        },
      ];
    }

    if (chunk.stream === "stderr") {
      return [{ type: "runtime_stderr", payload: { text, receivedAt: chunk.receivedAt } }];
    }

    return [{ type: "text_delta", payload: { text, receivedAt: chunk.receivedAt } }];
  }

  classifyError(error: unknown): RuntimeErrorClassification {
    const message = readErrorMessage(error);
    const lower = message.toLowerCase();

    if (looksLikeAuthFailure(lower)) {
      return { class: "authentication_failed", message, retryable: false };
    }
    if (lower.includes("permission") || lower.includes("approval")) {
      return { class: "permission_wait", message, retryable: true };
    }
    if (lower.includes("context") && (lower.includes("overflow") || lower.includes("length") || lower.includes("limit"))) {
      return { class: "context_overflow", message, retryable: true };
    }
    if (lower.includes("cancel") || lower.includes("sigterm") || lower.includes("sigint")) {
      return { class: "user_cancelled", message, retryable: false };
    }

    return { class: "process_crash", message, retryable: true };
  }

  private probeResult(
    status: AgentProbeResult["status"],
    version: string | null,
    message: string | null,
  ): AgentProbeResult {
    return {
      agentType: this.agentType,
      status,
      command: this.command,
      version,
      message,
      checkedAt: nowIso(),
    };
  }
}

function readStringArray(value: JsonObject | undefined, key: string): string[] {
  const maybeArray = value?.[key];
  if (!Array.isArray(maybeArray)) {
    return [];
  }

  return maybeArray.filter((item): item is string => typeof item === "string");
}

function readInputText(value: JsonValue): string {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.text === "string") {
    return value.text;
  }

  return JSON.stringify(value);
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown runtime error";
}

function looksLikeAuthFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("auth") || lower.includes("login") || lower.includes("credential");
}

function looksLikePermissionPrompt(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("permission") ||
    lower.includes("approval required") ||
    lower.includes("requires approval") ||
    lower.includes("approve this")
  );
}
