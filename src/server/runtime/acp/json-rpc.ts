import type { JsonObject, JsonValue } from "../../../shared/json.js";
import { nowIso } from "../../../shared/time.js";
import type { RuntimeProcess } from "../process.js";
import type { RuntimeEventDraft } from "../types.js";

export type JsonRpcId = string | number;

export type JsonRpcRequestHandler = (params: JsonValue, id: JsonRpcId) => Promise<JsonValue> | JsonValue;
export type JsonRpcNotificationHandler = (method: string, params: JsonValue) => void;

type PendingRequest = {
  method: string;
  resolve: (value: JsonValue) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type AcpJsonRpcConnectionOptions = {
  onNotification: JsonRpcNotificationHandler;
  onRequest: (method: string, params: JsonValue, id: JsonRpcId) => Promise<JsonValue> | JsonValue;
  onProtocolEvent: (draft: RuntimeEventDraft) => void;
  requestTimeoutMs?: number;
};

export class AcpJsonRpcConnection {
  private nextId = 1;
  private stdoutBuffer = "";
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly process: RuntimeProcess,
    private readonly options: AcpJsonRpcConnectionOptions,
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    process.onOutput((chunk) => {
      if (chunk.stream === "stderr") {
        this.options.onProtocolEvent({
          type: "runtime_stderr",
          payload: { text: chunk.text, receivedAt: chunk.receivedAt, protocol: "acp" },
        });
        return;
      }
      this.acceptStdout(chunk.text);
    });
    process.onExit((exit) => {
      this.rejectAll(new Error(exit.message ?? exit.signal ?? `ACP process exited with code ${exit.exitCode}`));
    });
  }

  sendRequest(method: string, params: JsonValue = {}): Promise<JsonValue> {
    const id = this.nextId++;
    const pending = new Promise<JsonValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
    });
    this.write({ jsonrpc: "2.0", id, method, params });
    return pending;
  }

  sendNotification(method: string, params: JsonValue = {}): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private acceptStdout(text: string): void {
    this.stdoutBuffer += text;
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        this.handleLine(line);
      }
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let message: JsonValue;
    try {
      message = JSON.parse(line) as JsonValue;
    } catch (error) {
      this.options.onProtocolEvent({
        type: "runtime_event",
        payload: {
          protocol: "acp",
          event: "invalid_jsonrpc_line",
          line,
          error: error instanceof Error ? error.message : "Invalid JSON-RPC line",
          receivedAt: nowIso(),
        },
      });
      return;
    }

    if (!isObject(message)) {
      return;
    }

    if (hasId(message) && !("method" in message)) {
      this.handleResponse(message);
      return;
    }

    const method = typeof message.method === "string" ? message.method : null;
    if (!method) {
      return;
    }

    const params = Object.prototype.hasOwnProperty.call(message, "params") ? message.params : {};
    if (hasId(message)) {
      void this.handleRequest(method, params, message.id);
      return;
    }

    this.options.onNotification(method, params);
  }

  private handleResponse(message: JsonObject): void {
    const id = message.id as JsonRpcId;
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    clearTimeout(pending.timer);

    if (isObject(message.error)) {
      const errorMessage =
        typeof message.error.message === "string" ? message.error.message : `${pending.method} returned an error`;
      pending.reject(new Error(errorMessage));
      return;
    }

    pending.resolve(Object.prototype.hasOwnProperty.call(message, "result") ? message.result : {});
  }

  private async handleRequest(method: string, params: JsonValue, id: JsonRpcId): Promise<void> {
    try {
      const result = await this.options.onRequest(method, params, id);
      this.write({ jsonrpc: "2.0", id, result: result ?? {} });
    } catch (error) {
      this.write({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : "ACP client request failed",
        },
      });
    }
  }

  private write(message: JsonObject): void {
    this.process.write(`${JSON.stringify(message)}\n`);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(error);
    }
  }
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasId(value: JsonObject): value is JsonObject & { id: JsonRpcId } {
  return typeof value.id === "string" || typeof value.id === "number";
}
