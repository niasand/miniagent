import type { SqliteDatabase } from "../db/migrate.js";
import { AuditLogStore } from "../audit/audit-log-store.js";
import { OutboxStore, type OutboxItem } from "../events/outbox-store.js";
import { EventStore } from "../events/event-store.js";
import type { TelegramRestClient } from "./telegram-bot-client.js";
import { parseJson, type JsonValue } from "../../shared/json.js";
import { addMillisecondsIso, nowIso } from "../../shared/time.js";

export type DeliverTelegramOutboxInput = {
  workerId: string;
  limit?: number;
  leaseMs?: number;
  now?: string;
};

export type DeliverTelegramOutboxResult = {
  sent: number;
  failed: number;
};

export class TelegramDeliveryService {
  private readonly auditLogs: AuditLogStore;
  private readonly events: EventStore;
  private readonly outbox: OutboxStore;

  constructor(
    db: SqliteDatabase,
    private readonly client: TelegramRestClient,
    events = new EventStore(db),
  ) {
    this.auditLogs = new AuditLogStore(db);
    this.events = events;
    this.outbox = new OutboxStore(db);
  }

  async deliverDue(input: DeliverTelegramOutboxInput): Promise<DeliverTelegramOutboxResult> {
    const now = input.now ?? nowIso();
    const items = this.outbox.claimDue({
      workerId: input.workerId,
      limit: input.limit ?? 20,
      leaseMs: input.leaseMs ?? 30_000,
      now,
      channelType: "telegram",
    });

    let sent = 0;
    let failed = 0;

    for (const item of items) {
      try {
        await this.deliverItem(item);
        this.outbox.markSent(item.id, `telegram:${item.targetRef}:${now}`, now);
        this.events.append({
          sessionId: item.sessionId,
          type: "delivery_succeeded",
          causationId: item.eventId,
          payload: {
            outboxId: item.id,
            channelType: item.channelType,
            kind: item.kind,
            targetRef: item.targetRef,
          },
          createdAt: now,
        });
        this.auditLogs.insert({
          actorType: "system",
          action: "delivery_succeeded",
          resourceType: "outbox",
          resourceId: item.id,
          payload: {
            sessionId: item.sessionId,
            channelType: item.channelType,
            kind: item.kind,
            targetRef: item.targetRef,
          },
          createdAt: now,
        });
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Telegram delivery failed";
        this.outbox.markFailed(item.id, message, addMillisecondsIso(now, retryDelayMs(item.attempts)), now);
        this.events.append({
          sessionId: item.sessionId,
          type: "delivery_failed",
          causationId: item.eventId,
          payload: {
            outboxId: item.id,
            channelType: item.channelType,
            kind: item.kind,
            error: message,
          },
          createdAt: now,
        });
        this.auditLogs.insert({
          actorType: "system",
          action: "delivery_failed",
          resourceType: "outbox",
          resourceId: item.id,
          payload: {
            sessionId: item.sessionId,
            channelType: item.channelType,
            kind: item.kind,
            error: message,
          },
          createdAt: now,
        });
        failed += 1;
      }
    }

    return { sent, failed };
  }

  private async deliverItem(item: OutboxItem): Promise<void> {
    const viewModel = parseJson(item.viewModelJson);
    const text = readText(viewModel);
    const targetRef = item.targetRef;

    // Parse chat ID from targetRef (strip "private:" or "group:" prefix)
    const chatId = targetRef.startsWith("private:")
      ? targetRef.slice(8)
      : targetRef.startsWith("group:")
        ? targetRef.slice(6)
        : targetRef;

    return this.client.sendMessage(chatId, text);
  }
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

function retryDelayMs(attempts: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
}
