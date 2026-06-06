import { accessSync, constants } from "node:fs";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";
import type { JsonObject, JsonValue } from "../../../shared/json.js";
import { nowIso } from "../../../shared/time.js";
import type { RuntimeProcess, RuntimeProcessExit } from "../process.js";
import { AcpClientFileSystem } from "./client-file-system.js";
import { AcpJsonRpcConnection, type JsonRpcId } from "./json-rpc.js";
import type {
  AgentProbeResult,
  AgentType,
  RuntimeCapabilities,
  RuntimeErrorClassification,
  RuntimeInput,
  RuntimeLaunchContext,
  RuntimeLaunchSpec,
  RuntimeEventDraft,
  RuntimeDriverCallbacks,
  RuntimeDriverStartContext,
  RuntimePermissionResponseInput,
  RuntimeRunHandle,
  RuntimeSessionDriver,
} from "../types.js";

// ---------------------------------------------------------------------------
// CommandRunner (inlined from old command-runner.ts)
// ---------------------------------------------------------------------------

type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  errorCode?: string;
  errorMessage?: string;
};

interface CommandRunner {
  run(command: string, args: string[], options?: { cwd?: string; timeoutMs?: number }): CommandResult;
}

class DefaultCommandRunner implements CommandRunner {
  run(command: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}): CommandResult {
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      timeout: options.timeoutMs ?? 2_000,
    });

    return {
      exitCode: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      errorCode: result.error ? readErrorCode(result.error) : undefined,
      errorMessage: result.error?.message,
    };
  }
}

function readErrorCode(error: Error): string | undefined {
  return "code" in error && typeof error.code === "string" ? error.code : undefined;
}

// ---------------------------------------------------------------------------
// AcpRuntimeDriver
// ---------------------------------------------------------------------------

type AcpRuntimeDriverOptions = {
  agentType: AgentType;
  displayName: string;
  command: string;
  defaultArgs?: string[];
  commandRunner?: CommandRunner;
  requestTimeoutMs?: number;
};

const agentDefaults: Record<string, AcpRuntimeDriverOptions> = {
  claude: { agentType: "claude", displayName: "Claude", command: "claude" },
  codex: { agentType: "codex", displayName: "Codex", command: "codex" },
  trae: { agentType: "trae", displayName: "Trae", command: "traecli" },
};

const acpCapabilities: RuntimeCapabilities = {
  textStreaming: true,
  structuredEvents: true,
  nativeCompact: false,
  resume: true,
  sessionExport: false,
  permissionPrompt: true,
  imageInput: false,
};

export class AcpRuntimeDriver implements RuntimeSessionDriver {
  readonly runtimeKind = "acp";
  readonly agentType: AgentType;
  readonly displayName: string;
  readonly command: string;

  private readonly defaultArgs: string[];
  private readonly commandRunner: CommandRunner;
  readonly requestTimeoutMs: number;

  constructor(optionsOrAgentType: AcpRuntimeDriverOptions | AgentType) {
    const opts = typeof optionsOrAgentType === "string"
      ? agentDefaults[optionsOrAgentType] ?? { agentType: optionsOrAgentType, displayName: optionsOrAgentType, command: optionsOrAgentType }
      : optionsOrAgentType;
    this.agentType = opts.agentType;
    this.displayName = opts.displayName;
    this.command = opts.command;
    this.defaultArgs = opts.defaultArgs ?? [];
    this.commandRunner = (opts as AcpRuntimeDriverOptions).commandRunner ?? new DefaultCommandRunner();
    this.requestTimeoutMs = (opts as AcpRuntimeDriverOptions).requestTimeoutMs ?? 30_000;
  }

  capabilities(): RuntimeCapabilities {
    return acpCapabilities;
  }

  async probe(): Promise<AgentProbeResult> {
    if (!canExecute(this.command)) {
      const result = this.commandRunner.run("sh", ["-lc", `command -v ${quoteShell(this.command)}`], { timeoutMs: 2_000 });
      if (result.exitCode === 0 && result.stdout.trim()) {
        return this.probeResult("healthy", null, null);
      }
      return this.probeResult("missing", null, `${this.command} was not found on PATH`);
    }

    return this.probeResult("healthy", null, null);
  }

  createLaunchSpec(context: RuntimeLaunchContext): RuntimeLaunchSpec {
    return {
      agentType: this.agentType,
      runtimeKind: "acp",
      command: this.command,
      args: [...this.defaultArgs, ...readStringArray(context.session.defaultParams, "args")],
      cwd: context.session.workspacePath,
      env: {},
      envSummary: {},
      protocolVersion: 1,
    };
  }

  classifyError(error: unknown): RuntimeErrorClassification {
    const message = readErrorMessage(error);
    const lower = message.toLowerCase();
    if (
      lower.includes("auth") ||
      lower.includes("keyring") ||
      lower.includes("secret not found") ||
      lower.includes("token") ||
      lower.includes("unauthorized")
    ) {
      return { class: "authentication_failed", message, retryable: false };
    }
    if (lower.includes("permission")) {
      return { class: "permission_wait", message, retryable: true };
    }
    if (lower.includes("context") && (lower.includes("overflow") || lower.includes("limit"))) {
      return { class: "context_overflow", message, retryable: true };
    }
    if (lower.includes("cancel")) {
      return { class: "user_cancelled", message, retryable: false };
    }
    return { class: "process_crash", message, retryable: true };
  }

  start(
    context: RuntimeDriverStartContext,
    process: RuntimeProcess,
    callbacks: RuntimeDriverCallbacks,
  ): RuntimeRunHandle {
    return new AcpRunHandle(this, context, process, callbacks);
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

class AcpRunHandle implements RuntimeRunHandle {
  private readonly connection: AcpJsonRpcConnection;
  private readonly fileSystem: AcpClientFileSystem;
  private readonly pendingPermissions = new Map<string, (response: JsonValue) => void>();
  private readonly ready: Promise<void>;
  private promptInFlight: Promise<void> = Promise.resolve();
  private externalSessionId: string | null = null;
  private finished = false;
  private stderrTail = "";

  constructor(
    private readonly driver: AcpRuntimeDriver,
    private readonly context: RuntimeDriverStartContext,
    private readonly process: RuntimeProcess,
    private readonly callbacks: RuntimeDriverCallbacks,
  ) {
    this.fileSystem = new AcpClientFileSystem({ workspacePath: context.session.workspacePath });
    this.connection = new AcpJsonRpcConnection(process, {
      onNotification: (method, params) => this.handleNotification(method, params),
      onRequest: (method, params, id) => this.handleRequest(method, params, id),
      onProtocolEvent: (draft) => {
        this.rememberStderr(draft);
        callbacks.emit(draft);
      },
      requestTimeoutMs: driver.requestTimeoutMs,
    });
    process.onExit((exit) => this.finish(this.withRecentStderr(exit)));
    this.ready = this.bootstrap();
  }

  sendInput(input: RuntimeInput): void {
    this.promptInFlight = this.promptInFlight
      .then(() => this.ready)
      .then(() => this.sendPrompt(input))
      .catch((error) => this.finishWithError(error));
  }

  stop(): void {
    if (this.externalSessionId) {
      this.callbacks.updateProtocolState?.({ cancelState: "requested" });
      this.callbacks.emit({
        type: "acp_cancel_requested",
        payload: { protocol: "acp", sessionId: this.externalSessionId, requestedAt: nowIso() },
      });
      this.connection.sendNotification("session/cancel", { sessionId: this.externalSessionId });
      for (const resolve of this.pendingPermissions.values()) {
        resolve({ outcome: { outcome: "cancelled" } });
      }
      this.pendingPermissions.clear();
      return;
    }

    this.process.stop("SIGTERM");
  }

  flush(): RuntimeEventDraft[] {
    return [];
  }

  respondPermission(input: RuntimePermissionResponseInput): void {
    const resolve = this.pendingPermissions.get(input.requestId);
    if (!resolve) {
      throw new Error(`ACP permission request is not pending: ${input.requestId}`);
    }

    this.pendingPermissions.delete(input.requestId);
    resolve({
      outcome:
        input.outcome === "cancelled"
          ? { outcome: "cancelled" }
          : { outcome: "selected", optionId: input.optionId ?? "allow" },
    });
  }

  private async bootstrap(): Promise<void> {
    const initialize = await this.connection.sendRequest("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: false },
        terminal: false,
      },
      clientInfo: {
        name: "miniagent",
        title: "MiniAgent",
        version: "0.1.0",
      },
    });

    const existingSessionId = readExternalSessionId(this.context.task?.input);
    const method = existingSessionId ? "session/resume" : "session/new";
    const sessionParams: JsonObject = {
      cwd: this.context.session.workspacePath,
      mcpServers: [],
    };
    if (existingSessionId) {
      sessionParams.sessionId = existingSessionId;
    }

    const response = await this.connection.sendRequest(method, sessionParams);
    const sessionId = readString(response, "sessionId") ?? existingSessionId;
    if (!sessionId) {
      throw new Error(`${method} did not return a sessionId`);
    }

    this.externalSessionId = sessionId;
    this.callbacks.updateProtocolState?.({
      externalSessionId: sessionId,
      protocolState: {
        protocol: "acp",
        protocolVersion: readNumber(initialize, "protocolVersion") ?? 1,
        initializedAt: nowIso(),
      },
    });
    this.callbacks.emit({
      type: "acp_session_started",
      payload: { protocol: "acp", sessionId, method, initializedAt: nowIso() },
    });
  }

  private async sendPrompt(input: RuntimeInput): Promise<void> {
    if (!this.externalSessionId) {
      throw new Error("ACP session is not initialized");
    }

    const result = await this.connection.sendRequest("session/prompt", {
      sessionId: this.externalSessionId,
      prompt: toPromptBlocks(input.input),
    });

    // Capture token usage from ACP response if available
    const usage = extractUsage(result);
    if (usage) {
      this.callbacks.emit({
        type: "usage_report",
        payload: { protocol: "acp", ...usage, receivedAt: nowIso() },
      });
    }

    const stopReason = readString(result, "stopReason") ?? "end_turn";
    if (stopReason === "cancelled") {
      this.callbacks.updateProtocolState?.({ cancelState: "acknowledged" });
      this.finish({ exitCode: null, signal: "SIGTERM", message: "cancelled", exitedAt: nowIso() });
      return;
    }

    if (stopReason !== "end_turn") {
      this.finish({ exitCode: 1, signal: null, message: stopReason, exitedAt: nowIso() });
      return;
    }

    this.finish({ exitCode: 0, signal: null, message: stopReason, exitedAt: nowIso() });
    this.process.stop("SIGTERM");
  }

  private handleNotification(method: string, params: JsonValue): void {
    if (method === "session/update") {
      this.callbacks.emit(mapSessionUpdate(params));
      return;
    }

    this.callbacks.emit({
      type: "runtime_event",
      payload: { protocol: "acp", method, params: asJsonObject(params), receivedAt: nowIso() },
    });
  }

  private handleRequest(method: string, params: JsonValue, id: JsonRpcId): Promise<JsonValue> | JsonValue {
    if (method === "fs/read_text_file") {
      try {
        const response = this.fileSystem.readTextFile(params);
        this.callbacks.emit({
          type: "runtime_event",
          payload: {
            protocol: "acp",
            method,
            requestId: String(id),
            path: readString(params, "path"),
            status: "succeeded",
            receivedAt: nowIso(),
          },
        });
        return response;
      } catch (error) {
        this.callbacks.emit({
          type: "runtime_event",
          payload: {
            protocol: "acp",
            method,
            requestId: String(id),
            path: readString(params, "path"),
            status: "failed",
            error: readErrorMessage(error),
            receivedAt: nowIso(),
          },
        });
        throw error;
      }
    }

    if (method !== "session/request_permission") {
      throw new Error(`Unsupported ACP client request: ${method}`);
    }

    const requestId = String(id);
    const payload = asJsonObject(params);
    this.callbacks.emit({
      type: "permission_prompt",
      payload: {
        protocol: "acp",
        requestId,
        sessionId: readString(payload, "sessionId"),
        options: readArray(payload.options),
        toolCall: asJsonObject(payload.toolCall),
        status: "waiting",
        receivedAt: nowIso(),
      },
    });

    return new Promise((resolve) => {
      this.pendingPermissions.set(requestId, resolve);
    });
  }

  private finish(exit: RuntimeProcessExit): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    for (const resolve of this.pendingPermissions.values()) {
      resolve({ outcome: { outcome: "cancelled" } });
    }
    this.pendingPermissions.clear();
    this.callbacks.exit(exit);
  }

  private finishWithError(error: unknown): void {
    this.finish({
      exitCode: 1,
      signal: null,
      message: readErrorMessage(error),
      exitedAt: nowIso(),
    });
  }

  private rememberStderr(draft: RuntimeEventDraft): void {
    if (draft.type !== "runtime_stderr") {
      return;
    }

    const text = readString(draft.payload, "text");
    if (!text) {
      return;
    }

    this.stderrTail = `${this.stderrTail}${text}`.slice(-8_000);
  }

  private withRecentStderr(exit: RuntimeProcessExit): RuntimeProcessExit {
    if (exit.message || (exit.exitCode === 0 && !exit.signal)) {
      return exit;
    }

    const stderr = this.stderrTail.trim();
    if (!stderr) {
      return exit;
    }

    const reason = exit.signal ?? `ACP process exited with code ${exit.exitCode}`;
    return { ...exit, message: `${reason}; recent stderr: ${summarizeText(stderr, 1_500)}` };
  }
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function summarizeText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const half = Math.floor((maxLength - 5) / 2);
  return `${text.slice(0, half)}\n...\n${text.slice(-half)}`;
}

function mapSessionUpdate(params: JsonValue): RuntimeEventDraft[] {
  const object = asJsonObject(params);
  const sessionId = readString(object, "sessionId");
  const update = asJsonObject(object.update);
  const kind = readString(update, "sessionUpdate") ?? "unknown";

  if (kind === "agent_message_chunk") {
    return [
      {
        type: "text_delta",
        payload: {
          text: readContentText(update.content),
          receivedAt: nowIso(),
          protocol: "acp",
          sessionId,
          sessionUpdate: kind,
        },
      },
    ];
  }

  if (kind === "tool_call") {
    return [{ type: "tool_call", payload: { protocol: "acp", sessionId, ...update } }];
  }

  if (kind === "tool_call_update") {
    return [{ type: "tool_call_update", payload: { protocol: "acp", sessionId, ...update } }];
  }

  return [{ type: "runtime_event", payload: { protocol: "acp", sessionId, update, receivedAt: nowIso() } }];
}

export function toPromptBlocks(input: JsonValue): JsonValue[] {
  const object = asJsonObject(input);
  const text = readInputText(input);
  const knowledge = typeof object.knowledge === "string" ? object.knowledge : null;
  const blocks: JsonValue[] = [];

  if (knowledge) blocks.push({ type: "text", text: knowledge });
  if (text) blocks.push({ type: "text", text });

  const files = readArray(object.files);
  for (const file of files) {
    if (typeof file === "string") {
      blocks.push({
        type: "resource_link",
        uri: `file://${file}`,
        name: basename(file),
        mimeType: "text/plain",
      });
    } else if (file && typeof file === "object" && !Array.isArray(file)) {
      const path = typeof file.path === "string" ? file.path : null;
      if (path) {
        blocks.push({
          type: "resource_link",
          uri: `file://${path}`,
          name: typeof file.name === "string" ? file.name : basename(path),
          mimeType: typeof file.mimeType === "string" ? file.mimeType : "text/plain",
        });
      }
    }
  }
  return blocks.length > 0 ? blocks : [{ type: "text", text: JSON.stringify(input) }];
}

function readInputText(input: JsonValue): string {
  if (typeof input === "string") {
    return input;
  }
  const object = asJsonObject(input);
  return typeof object.text === "string" ? object.text : "";
}

function readContentText(value: JsonValue): string {
  const object = asJsonObject(value);
  return typeof object.text === "string" ? object.text : "";
}

function readExternalSessionId(value: JsonValue | undefined): string | null {
  const object = asJsonObject(value);
  return typeof object.externalSessionId === "string" ? object.externalSessionId : null;
}

function asJsonObject(value: JsonValue | undefined): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readString(value: JsonValue | undefined, key: string): string | null {
  const object = asJsonObject(value);
  return typeof object[key] === "string" ? object[key] : null;
}

function readNumber(value: JsonValue | undefined, key: string): number | null {
  const object = asJsonObject(value);
  return typeof object[key] === "number" ? object[key] : null;
}

function readArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value: JsonObject | undefined, key: string): string[] {
  const maybeArray = value?.[key];
  return Array.isArray(maybeArray) ? maybeArray.filter((item): item is string => typeof item === "string") : [];
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown ACP runtime error";
}

function canExecute(command: string): boolean {
  try {
    accessSync(command, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function extractUsage(result: JsonValue): { inputTokens?: number; outputTokens?: number } | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const obj = result as Record<string, unknown>;

  // Try common ACP usage field shapes
  const usage = obj.usage ?? obj.tokenUsage ?? obj.tokens;
  if (usage && typeof usage === "object" && !Array.isArray(usage)) {
    const u = usage as Record<string, unknown>;
    return {
      inputTokens: typeof u.inputTokens === "number" ? u.inputTokens : typeof u.input_tokens === "number" ? u.input_tokens : undefined,
      outputTokens: typeof u.outputTokens === "number" ? u.outputTokens : typeof u.output_tokens === "number" ? u.output_tokens : undefined,
    };
  }

  // Try top-level fields
  const input = obj.inputTokens ?? obj.input_tokens;
  const output = obj.outputTokens ?? obj.output_tokens;
  if (typeof input === "number" || typeof output === "number") {
    return {
      inputTokens: typeof input === "number" ? input : undefined,
      outputTokens: typeof output === "number" ? output : undefined,
    };
  }

  return null;
}
