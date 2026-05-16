import type { SqliteDatabase } from "../db/migrate.js";
import { EventStore } from "../events/event-store.js";
import { projectReadModelsUntilIdle } from "../events/projector-runner.js";
import { FeishuInboundService } from "./feishu-inbound-service.js";
import { FeishuDeliveryService, type FeishuDeliveryClient } from "./feishu-delivery-service.js";
import type { WorkspacePolicy } from "../security/workspace-policy.js";
import { RuntimeService } from "../runtime/runtime-service.js";
import { RuntimeSupervisor } from "../runtime/runtime-supervisor.js";
import * as lark from "@larksuiteoapi/node-sdk";

function readChannelConfig(db: SqliteDatabase, channelId: string): Record<string, string> {
  const rows = db
    .prepare("SELECT key, value FROM channel_configs WHERE channel_id = ?")
    .all(channelId) as Array<{ key: string; value: string }>;
  const config: Record<string, string> = {};
  for (const row of rows) config[row.key] = row.value;
  return config;
}

export class FeishuGatewayService {
  private wsClient: lark.WSClient | null = null;
  private larkClient: lark.Client | null = null;
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
    const config = readChannelConfig(this.db, "feishu");
    if (!config.app_id || !config.app_secret) {
      console.log("[Feishu] Not configured, skipping");
      return;
    }

    // REST client for sending messages
    this.larkClient = new lark.Client({
      appId: config.app_id,
      appSecret: config.app_secret,
      appType: lark.AppType.SelfBuild,
    });

    // Event dispatcher for handling incoming messages
    const eventDispatcher = new lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data: any) => {
        try {
          const message = data.message;
          const senderOpenId = data.sender?.sender_id?.open_id ?? "";
          const chatId = message.chat_id;
          const messageType = message.message_type;
          const content = message.content;

          // Extract text from content
          let text = "";
          if (messageType === "text") {
            try {
              const parsed = JSON.parse(content);
              text = parsed.text ?? "";
            } catch { text = content; }
          } else if (messageType === "post") {
            try {
              const parsed = JSON.parse(content);
              const title = parsed.title ?? "";
              const lines: string[] = [];
              for (const para of (parsed.content ?? []) as Array<Array<{ tag: string; text?: string }>>) {
                for (const el of para) {
                  if (el.text) lines.push(el.text);
                }
              }
              text = [title, ...lines].filter(Boolean).join("\n");
            } catch { text = content; }
          } else {
            text = `[${messageType}]`;
          }

          if (!text.trim()) return;

          // Strip @bot mention prefix
          text = text.replace(/@_user_\d+\s*/g, "").trim();
          if (!text) return;

          const chatType = message.chat_type === "p2p" ? "p2p" : "group";
          const chatRef = chatType === "p2p" ? `p2p:${chatId}` : `group:${chatId}`;

          const inbound = new FeishuInboundService(this.db, undefined, { workspacePolicy: this.workspacePolicy });
          const result = inbound.receiveMessage({
            messageId: message.message_id,
            chatId: chatRef,
            userId: senderOpenId,
            text,
          });

          if (result.action === "message") {
            projectReadModelsUntilIdle(this.db);
            if (this.runtimeService) {
              try { this.runtimeService.startNextQueuedTask(result.session.id); } catch { /* already active */ }
            }
          }
        } catch (err) {
          console.error("[Feishu] Message handling failed:", err);
        }
      },
    });

    // WebSocket client
    this.wsClient = new lark.WSClient({
      appId: config.app_id,
      appSecret: config.app_secret,
      loggerLevel: lark.LoggerLevel.warn,
    });

    this.wsClient.start({ eventDispatcher }).then(() => {
      this.connected = true;
      console.log("[Feishu] WebSocket gateway started");
    }).catch((err: Error) => {
      console.error("[Feishu] WebSocket start failed:", err.message);
    });

    // Delivery loop every 2s
    this.deliveryTimer = setInterval(() => {
      this.deliverDue();
    }, 2000);
  }

  stop(): void {
    if (this.wsClient) {
      try { (this.wsClient as any).close(); } catch { /* ignore */ }
    }
    if (this.deliveryTimer) clearInterval(this.deliveryTimer);
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private deliverDue(): void {
    if (!this.larkClient) return;
    try {
      const deliveryClient: FeishuDeliveryClient = {
        sendText: async (targetRef: string, text: string) => {
          const chatId = targetRef.replace(/^(p2p|group):/, "");
          const res = await this.larkClient!.im.v1.message.create({
            params: { receive_id_type: "chat_id" },
            data: {
              receive_id: chatId,
              msg_type: "text",
              content: JSON.stringify({ text }),
            },
          });
          return { providerMessageId: res.data?.message_id ?? "" };
        },
        sendCard: async (targetRef: string, card: any) => {
          const chatId = targetRef.replace(/^(p2p|group):/, "");
          const res = await this.larkClient!.im.v1.message.create({
            params: { receive_id_type: "chat_id" },
            data: {
              receive_id: chatId,
              msg_type: "interactive",
              content: JSON.stringify(card),
            },
          });
          return { providerMessageId: res.data?.message_id ?? "" };
        },
        updateCard: async (targetRef: string, card: any) => {
          // Update not supported in text-only mode; treat as new send
          const chatId = targetRef.replace(/^(p2p|group):/, "");
          const res = await this.larkClient!.im.v1.message.create({
            params: { receive_id_type: "chat_id" },
            data: {
              receive_id: chatId,
              msg_type: "interactive",
              content: JSON.stringify(card),
            },
          });
          return { providerMessageId: res.data?.message_id ?? "" };
        },
      };
      const delivery = new FeishuDeliveryService(this.db, deliveryClient);
      delivery.deliverDue({ workerId: "feishu-delivery" }).catch((err) => {
        console.error("[Feishu] Delivery failed:", err);
      });
    } catch { /* skip */ }
  }
}
