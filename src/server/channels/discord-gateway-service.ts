import type { SqliteDatabase } from "../db/migrate.js";
import { EventStore } from "../events/event-store.js";
import { projectReadModelsUntilIdle } from "../events/projector-runner.js";
import { DiscordInboundService } from "./discord-inbound-service.js";
import { DiscordRestClient, DiscordGatewayClient, type DiscordMessageEvent } from "./discord-bot-client.js";
import { DiscordDeliveryService } from "./discord-delivery-service.js";
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

export class DiscordGatewayService {
  private wsClient: DiscordGatewayClient | null = null;
  private restClient: DiscordRestClient | null = null;
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
    const config = readChannelConfig(this.db, "discord");
    if (!config.bot_token) {
      console.log("[Discord] Not configured, skipping");
      return;
    }

    this.restClient = new DiscordRestClient(config.bot_token);

    this.wsClient = new DiscordGatewayClient(
      config.bot_token,
      (msg) => this.handleMessage(msg),
      (msg) => console.log(`[Discord] ${msg}`),
    );

    this.wsClient.start().then(() => {
      this.connected = true;
      console.log("[Discord] Gateway started");
    }).catch((err) => {
      console.error("[Discord] Gateway start failed:", err);
    });

    // Delivery loop every 2s
    this.deliveryTimer = setInterval(() => {
      this.deliverDue();
    }, 2000);
  }

  stop(): void {
    this.wsClient?.stop();
    if (this.deliveryTimer) clearInterval(this.deliveryTimer);
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private handleMessage(msg: DiscordMessageEvent): void {
    try {
      const chatId = msg.isDm ? `dm:${msg.channelId}` : `guild:${msg.channelId}`;

      const inbound = new DiscordInboundService(this.db, undefined, { workspacePolicy: this.workspacePolicy });
      const result = inbound.receiveMessage({
        messageId: msg.id,
        chatId,
        userId: msg.authorId,
        text: msg.content,
        isDm: msg.isDm,
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
      console.error("[Discord] Message handling failed:", err);
    }
  }

  private deliverDue(): void {
    if (!this.restClient) return;
    try {
      const delivery = new DiscordDeliveryService(this.db, this.restClient);
      delivery.deliverDue({ workerId: "discord-delivery" }).catch((err) => {
        console.error("[Discord] Delivery failed:", err);
      });
    } catch { /* skip */ }
  }
}
