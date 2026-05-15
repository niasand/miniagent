import type { SqliteDatabase } from "../db/migrate.js";
import type { JsonObject, JsonValue } from "../../shared/json.js";
import { parseJson } from "../../shared/json.js";
import { MessageStore, type MessageRole } from "./message-store.js";
import { OutboxStore } from "./outbox-store.js";
import { ProjectorStore, type ProjectBatchResult } from "./projector-store.js";
import type { StoredEvent } from "./event-store.js";

export type ProjectorOptions = {
  batchSize?: number;
};

const DEFAULT_BATCH_SIZE = 100;

export class MessageProjector {
  private readonly messages: MessageStore;
  private readonly projectors: ProjectorStore;

  constructor(db: SqliteDatabase) {
    this.messages = new MessageStore(db);
    this.projectors = new ProjectorStore(db);
  }

  projectNextBatch(options: ProjectorOptions = {}): ProjectBatchResult {
    return this.projectors.projectBatch("messages", { limit: options.batchSize ?? DEFAULT_BATCH_SIZE }, (events) => {
      for (const event of events) {
        const input = mapEventToMessage(event);
        if (!input) {
          continue;
        }

        this.messages.upsert(input);
      }
    });
  }
}

export class WebOutboxProjector {
  private readonly outbox: OutboxStore;
  private readonly projectors: ProjectorStore;

  constructor(db: SqliteDatabase) {
    this.outbox = new OutboxStore(db);
    this.projectors = new ProjectorStore(db);
  }

  projectNextBatch(options: ProjectorOptions = {}): ProjectBatchResult {
    return this.projectors.projectBatch("web_outbox", { limit: options.batchSize ?? DEFAULT_BATCH_SIZE }, (events) => {
      for (const event of events) {
        this.outbox.enqueueOnce({
          sessionId: event.sessionId,
          eventId: event.id,
          eventGlobalSeq: event.globalSeq,
          channelType: "web",
          targetRef: event.sessionId,
          kind: "web_event",
          viewModel: mapEventToWebViewModel(event),
          idempotencyKey: `web:${event.id}`,
        });
      }
    });
  }
}

export class FeishuOutboxProjector {
  private readonly outbox: OutboxStore;
  private readonly projectors: ProjectorStore;

  constructor(private readonly db: SqliteDatabase) {
    this.outbox = new OutboxStore(db);
    this.projectors = new ProjectorStore(db);
  }

  projectNextBatch(options: ProjectorOptions = {}): ProjectBatchResult {
    return this.projectors.projectBatch("feishu_outbox", { limit: options.batchSize ?? DEFAULT_BATCH_SIZE }, (events) => {
      for (const event of events) {
        if (event.type.startsWith("delivery_")) {
          continue;
        }

        const targetRef = this.readFeishuTargetRef(event.sessionId);
        if (!targetRef) {
          continue;
        }

        this.outbox.enqueueOnce({
          sessionId: event.sessionId,
          eventId: event.id,
          eventGlobalSeq: event.globalSeq,
          channelType: "feishu",
          targetRef,
          kind: event.type === "task_created" ? "feishu_card_create" : "feishu_card_update",
          viewModel: mapEventToFeishuCard(event),
          idempotencyKey: `feishu:${targetRef}:${event.id}`,
        });
      }
    });
  }

  private readFeishuTargetRef(sessionId: string): string | null {
    const row = this.db
      .prepare("SELECT channel_ref FROM sessions WHERE id = ? AND channel_type = 'feishu'")
      .get(sessionId) as { channel_ref: string | null } | undefined;

    return row?.channel_ref ?? null;
  }
}

export class QQOutboxProjector {
  private readonly outbox: OutboxStore;
  private readonly projectors: ProjectorStore;

  constructor(private readonly db: SqliteDatabase) {
    this.outbox = new OutboxStore(db);
    this.projectors = new ProjectorStore(db);
  }

  projectNextBatch(options: ProjectorOptions = {}): ProjectBatchResult {
    return this.projectors.projectBatch("qq_outbox", { limit: options.batchSize ?? DEFAULT_BATCH_SIZE }, (events) => {
      for (const event of events) {
        if (event.type.startsWith("delivery_")) {
          continue;
        }
        // Only send run results, not per-delta chunks or user messages
        if (event.type !== "run_finished" && event.type !== "run_failed") {
          continue;
        }

        const targetRef = this.readQQTargetRef(event.sessionId);
        if (!targetRef) {
          continue;
        }

        const text = event.type === "run_finished"
          ? this.collectRunText(event.runId)
          : this.runStatusText(event);

        if (!text) {
          continue;
        }

        this.outbox.enqueueOnce({
          sessionId: event.sessionId,
          eventId: event.id,
          eventGlobalSeq: event.globalSeq,
          channelType: "qq",
          targetRef,
          kind: "qq_markdown",
          viewModel: { type: "qq_markdown", eventType: event.type, text },
          idempotencyKey: `qq:${targetRef}:${event.id}`,
        });
      }
    });
  }

  private readQQTargetRef(sessionId: string): string | null {
    const row = this.db
      .prepare("SELECT channel_ref FROM sessions WHERE id = ? AND channel_type = 'qq'")
      .get(sessionId) as { channel_ref: string | null } | undefined;

    return row?.channel_ref ?? null;
  }

  private collectRunText(runId: string | null): string {
    if (!runId) return "";
    const rows = this.db
      .prepare(
        "SELECT payload_json FROM events WHERE run_id = ? AND type = 'text_delta' ORDER BY global_seq",
      )
      .all(runId) as Array<{ payload_json: string }>;
    return rows.map((r) => {
      const p = parseJson(r.payload_json) as Record<string, unknown>;
      return typeof p.text === "string" ? p.text : "";
    }).join("");
  }

  private runStatusText(event: StoredEvent): string {
    const payload = readObject(event.payload);
    const status = typeof payload.status === "string" ? payload.status : "failed";
    const reason = typeof payload.stopReason === "string" && payload.stopReason ? `: ${payload.stopReason}` : "";
    return `Run ${status}${reason}`;
  }
}

type MessageInput = Parameters<MessageStore["upsert"]>[0];

function mapEventToMessage(event: StoredEvent): MessageInput | null {
  switch (event.type) {
    case "task_created": {
      const input = readObject(event.payload).input;
      const content = readText(input);
      if (!content) {
        return null;
      }

      return buildMessage(event, "user", content, { eventType: event.type });
    }
    case "text_delta":
      return buildMessage(event, "assistant", readString(event.payload, "text"), { eventType: event.type });
    case "runtime_stderr":
      return buildMessage(event, "tool", readString(event.payload, "text"), { eventType: event.type, stream: "stderr" });
    case "run_failed":
      return buildMessage(event, "system", readRunStatusMessage(event), { eventType: event.type, severity: "error" });
    case "run_finished":
      return buildMessage(event, "system", readRunStatusMessage(event), { eventType: event.type });
    default:
      return null;
  }
}

function buildMessage(event: StoredEvent, role: MessageRole, content: string, metadata: JsonObject): MessageInput {
  return {
    id: `msg_${event.id}`,
    sessionId: event.sessionId,
    runId: event.runId,
    role,
    content,
    metadata,
    sourceEventId: event.id,
    createdAt: event.createdAt,
  };
}

function mapEventToWebViewModel(event: StoredEvent): JsonObject {
  return {
    type: "event",
    event: {
      globalSeq: event.globalSeq,
      id: event.id,
      sessionId: event.sessionId,
      runId: event.runId,
      taskId: event.taskId,
      runSeq: event.runSeq,
      type: event.type,
      payload: event.payload,
      createdAt: event.createdAt,
    },
  };
}

function mapEventToFeishuCard(event: StoredEvent): JsonObject {
  return {
    type: "feishu_card",
    title: "MiniAgent",
    event: {
      globalSeq: event.globalSeq,
      id: event.id,
      sessionId: event.sessionId,
      runId: event.runId,
      taskId: event.taskId,
      type: event.type,
      payload: event.payload,
      createdAt: event.createdAt,
    },
  };
}

function mapEventToQQMarkdown(event: StoredEvent): JsonObject {
  return {
    type: "qq_markdown",
    eventType: event.type,
    text: extractMarkdownText(event),
  };
}

function extractMarkdownText(event: StoredEvent): string {
  const payload = readObject(event.payload);
  if (typeof payload.text === "string") {
    return payload.text;
  }
  if (event.type === "task_created") {
    const input = readObject(payload.input);
    return readText(input);
  }
  return "";
}

function readRunStatusMessage(event: StoredEvent): string {
  const payload = readObject(event.payload);
  const status = typeof payload.status === "string" ? payload.status : event.type;
  const reason = typeof payload.stopReason === "string" && payload.stopReason ? `: ${payload.stopReason}` : "";
  return `Run ${status}${reason}`;
}

function readObject(value: JsonValue): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readString(value: JsonValue, key: string): string {
  const object = readObject(value);
  return typeof object[key] === "string" ? object[key] : "";
}

function readText(value: JsonValue): string {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.text === "string") {
    return value.text;
  }

  return "";
}
