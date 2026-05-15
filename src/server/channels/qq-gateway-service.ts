import type { SqliteDatabase } from "../db/migrate.js";
import { EventStore } from "../events/event-store.js";
import { projectReadModelsUntilIdle } from "../events/projector-runner.js";
import { QQInboundService } from "./qq-inbound-service.js";
import { QQRestClient, QQTokenManager, QQWebSocketClient, type QQMessageEvent } from "./qq-bot-client.js";
import { QQDeliveryService } from "./qq-delivery-service.js";
import type { WorkspacePolicy } from "../security/workspace-policy.js";
import { RuntimeService } from "../runtime/runtime-service.js";
import { RuntimeSupervisor } from "../runtime/runtime-supervisor.js";
import { SessionStore } from "../sessions/session-store.js";
import { PermissionRequestStore } from "../runtime/permission-request-store.js";
import { RuntimeAdapterRegistry } from "../runtime/registry.js";

function readChannelConfig(db: SqliteDatabase, channelId: string): Record<string, string> {
  const rows = db
    .prepare("SELECT key, value FROM channel_configs WHERE channel_id = ?")
    .all(channelId) as Array<{ key: string; value: string }>;
  const config: Record<string, string> = {};
  for (const row of rows) config[row.key] = row.value;
  return config;
}

export class QQGatewayService {
  private wsClient: QQWebSocketClient | null = null;
  private tokenManager: QQTokenManager | null = null;
  private restClient: QQRestClient | null = null;
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
    const config = readChannelConfig(this.db, "qq");
    if (!config.app_id || !config.app_secret) {
      console.log("[QQ] Not configured, skipping");
      return;
    }

    this.tokenManager = new QQTokenManager(config.app_id, config.app_secret);
    this.restClient = new QQRestClient(this.tokenManager);

    this.wsClient = new QQWebSocketClient(
      this.tokenManager,
      (msg) => this.handleMessage(msg),
      (msg) => console.log(`[QQ] ${msg}`),
    );

    this.wsClient.start().then(() => {
      this.connected = true;
      console.log("[QQ] Gateway started");
    }).catch((err) => {
      console.error("[QQ] Gateway start failed:", err);
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

  private handleMessage(msg: QQMessageEvent): void {
    try {
      const chatId = msg.chatType === "group" && msg.group_openid
        ? `group:${msg.group_openid}`
        : `c2c:${msg.author.user_openid}`;

      const inbound = new QQInboundService(this.db, undefined, { workspacePolicy: this.workspacePolicy });
      const result = inbound.receiveMessage({
        messageId: msg.id,
        chatId,
        userId: msg.author.user_openid || msg.author.member_openid,
        text: msg.content,
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
      console.error("[QQ] Message handling failed:", err);
    }
  }

  private deliverDue(): void {
    if (!this.restClient) return;
    try {
      const delivery = new QQDeliveryService(this.db, this.restClient);
      delivery.deliverDue({ workerId: "qq-delivery" }).catch((err) => {
        console.error("[QQ] Delivery failed:", err);
      });
    } catch { /* skip */ }
  }
}
