import type { SqliteDatabase } from "../db/migrate.js";
import { AuditLogStore } from "../audit/audit-log-store.js";
import { OutboxStore, type OutboxItem } from "../events/outbox-store.js";
import { EventStore } from "../events/event-store.js";
import { parseJson, type JsonValue } from "../../shared/json.js";
import { addMillisecondsIso, nowIso } from "../../shared/time.js";

export type FeishuDeliveryClient = {
  sendText: (targetRef: string, text: string) => Promise<{ providerMessageId: string }>;
  sendCard: (targetRef: string, card: JsonValue) => Promise<{ providerMessageId: string }>;
  updateCard: (targetRef: string, card: JsonValue) => Promise<{ providerMessageId: string }>;
};

export type DeliverFeishuOutboxInput = {
  workerId: string;
  limit?: number;
  leaseMs?: number;
  now?: string;
};

export type DeliverFeishuOutboxResult = {
  sent: number;
  failed: number;
};

export class FeishuDeliveryService {
  private readonly auditLogs: AuditLogStore;
  private readonly events: EventStore;
  private readonly outbox: OutboxStore;

  constructor(
    db: SqliteDatabase,
    private readonly client: FeishuDeliveryClient,
    events = new EventStore(db),
  ) {
    this.auditLogs = new AuditLogStore(db);
    this.events = events;
    this.outbox = new OutboxStore(db);
  }

  async deliverDue(input: DeliverFeishuOutboxInput): Promise<DeliverFeishuOutboxResult> {
    const now = input.now ?? nowIso();
    const items = this.outbox.claimDue({
      workerId: input.workerId,
      limit: input.limit ?? 20,
      leaseMs: input.leaseMs ?? 30_000,
      now,
      channelType: "feishu",
    });

    let sent = 0;
    let failed = 0;

    for (const item of items) {
      try {
        const delivered = await this.deliverItem(item);
        this.outbox.markSent(item.id, delivered.providerMessageId, now);
        this.events.append({
          sessionId: item.sessionId,
          type: "delivery_succeeded",
          causationId: item.eventId,
          payload: {
            outboxId: item.id,
            channelType: item.channelType,
            kind: item.kind,
            providerMessageId: delivered.providerMessageId,
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
            providerMessageId: delivered.providerMessageId,
          },
          createdAt: now,
        });
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Feishu delivery failed";
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

  private deliverItem(item: OutboxItem): Promise<{ providerMessageId: string }> {
    const viewModel = parseJson(item.viewModelJson);
    if (item.kind === "feishu_text") {
      const text = readText(viewModel);
      return this.client.sendText(item.targetRef, text);
    }
    if (item.kind === "feishu_card_create") {
      return this.client.sendCard(item.targetRef, viewModel);
    }
    return this.client.updateCard(item.targetRef, viewModel);
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
