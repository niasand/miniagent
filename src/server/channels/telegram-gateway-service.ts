import type { SqliteDatabase } from "../db/migrate.js";
import { EventStore } from "../events/event-store.js";
import { projectReadModelsUntilIdle } from "../events/projector-runner.js";
import { TelegramInboundService } from "./telegram-inbound-service.js";
import { TelegramRestClient, TelegramPollingClient, type TelegramMessageEvent } from "./telegram-bot-client.js";
import { TelegramDeliveryService } from "./telegram-delivery-service.js";
import type { WorkspacePolicy } from "../security/workspace-policy.js";
import { RuntimeService } from "../runtime/runtime-service.js";
import { RuntimeSupervisor } from "../runtime/runtime-supervisor.js";

function readChannelConfig(db: SqliteDatabase, channelId: string): Record<string, string> {
  const rows = db
    .prepare("SELECT key, value FROM channel_configs WHERE channel_id = ?")
    .all(channelId) as Array<{ key: string; value: string }>;
  const config: Record<string, string> = {};
  for (const row of rows) config[row.key] = row.value;
  return config;
}

export class TelegramGatewayService {
  private pollingClient: TelegramPollingClient | null = null;
  private restClient: TelegramRestClient | null = null;
  private deliveryTimer: ReturnType<typeof setInterval> | null = null;
  private runtimeService: RuntimeService | null = null;
  private connected = false;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly workspacePolicy: WorkspacePolicy,
    runtimeSupervisor?: RuntimeSupervisor,
  ) {
    if (runtimeSupervisor) {
      this.runtimeService = new RuntimeService(db, runtimeSupervisor, workspacePolicy);
    }
  }

  start(): void {
    const config = readChannelConfig(this.db, "telegram");
    if (!config.bot_token) {
      console.log("[Telegram] Not configured, skipping");
      return;
    }

    this.restClient = new TelegramRestClient(config.bot_token);

    this.pollingClient = new TelegramPollingClient(
      config.bot_token,
      (msg) => this.handleMessage(msg),
      (msg) => console.log(`[Telegram] ${msg}`),
    );

    this.pollingClient.start();
    this.connected = true;
    console.log("[Telegram] Gateway started");

    // Delivery loop every 2s
    this.deliveryTimer = setInterval(() => {
      this.deliverDue();
    }, 2000);
  }

  stop(): void {
    this.pollingClient?.stop();
    if (this.deliveryTimer) clearInterval(this.deliveryTimer);
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private handleMessage(msg: TelegramMessageEvent): void {
    try {
      const chatId = msg.chatType === "private"
        ? `private:${msg.userId}`
        : `group:${msg.chatId}`;

      const inbound = new TelegramInboundService(this.db, undefined, { workspacePolicy: this.workspacePolicy });
      const result = inbound.receiveMessage({
        messageId: msg.id,
        chatId,
        userId: String(msg.userId),
        text: msg.text,
        chatType: msg.chatType,
      });

      if (result.action === "message") {
        projectReadModelsUntilIdle(this.db);
        if (this.runtimeService) {
          try {
            this.runtimeService.startNextQueuedTask(result.session.id);
          } catch { /* run may already be active */ }
        }
      }
    } catch (err) {
      console.error("[Telegram] Message handling failed:", err);
    }
  }

  private deliverDue(): void {
    if (!this.restClient) return;
    try {
      const delivery = new TelegramDeliveryService(this.db, this.restClient);
      delivery.deliverDue({ workerId: "telegram-delivery" }).catch((err) => {
        console.error("[Telegram] Delivery failed:", err);
      });
    } catch { /* skip */ }
  }
}
