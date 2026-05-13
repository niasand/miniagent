import type { SqliteDatabase } from "../db/migrate.js";
import type { JsonObject, JsonValue } from "../../shared/json.js";
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
