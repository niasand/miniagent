import * as lark from "@larksuiteoapi/node-sdk";
import type { ChannelAdapter, ChannelMessage, SendResult } from "./types.js";

export class FeishuChannel implements ChannelAdapter {
  readonly channelType = "feishu";
  private wsClient: lark.WSClient | null = null;
  private larkClient: lark.Client | null = null;
  private connected = false;

  constructor(private readonly config: Record<string, string>) {}

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    const { app_id, app_secret } = this.config;
    if (!app_id || !app_secret) throw new Error("Feishu not configured");

    this.larkClient = new lark.Client({
      appId: app_id,
      appSecret: app_secret,
      appType: lark.AppType.SelfBuild,
    });

    const eventDispatcher = new lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data: any) => {
        try {
          const message = data.message;
          const senderOpenId = data.sender?.sender_id?.open_id ?? "";
          const chatId = message.chat_id;
          const messageType = message.message_type;
          const content = message.content;

          let text = "";
          if (messageType === "text") {
            try { text = JSON.parse(content).text ?? ""; } catch { text = content; }
          } else if (messageType === "post") {
            try {
              const parsed = JSON.parse(content);
              const title = parsed.title ?? "";
              const lines: string[] = [];
              for (const para of (parsed.content ?? []) as Array<Array<{ tag: string; text?: string }>>) {
                for (const el of para) { if (el.text) lines.push(el.text); }
              }
              text = [title, ...lines].filter(Boolean).join("\n");
            } catch { text = content; }
          } else {
            text = `[${messageType}]`;
          }

          text = text.replace(/@_user_\d+\s*/g, "").trim();
          if (!text) return;

          const chatType = message.chat_type === "p2p" ? "private" : "group";
          const chatRef = chatType === "private" ? `p2p:${chatId}` : `group:${chatId}`;

          onMessage({
            messageId: message.message_id,
            chatId: chatRef,
            userId: senderOpenId,
            text,
            chatType,
          });
        } catch (err) {
          console.error("[Feishu] Message handling failed:", err);
        }
      },
    });

    this.wsClient = new lark.WSClient({
      appId: app_id,
      appSecret: app_secret,
      loggerLevel: lark.LoggerLevel.warn,
    });

    await this.wsClient.start({ eventDispatcher });
    this.connected = true;
  }

  stop(): void {
    if (this.wsClient) {
      try { (this.wsClient as any).close(); } catch { /* ignore */ }
    }
    this.connected = false;
  }

  async send(targetRef: string, content: string): Promise<SendResult> {
    if (!this.larkClient) throw new Error("Feishu client not initialized");
    const chatId = targetRef.replace(/^(p2p|group):/, "");
    const res = await this.larkClient.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text: content }),
      },
    });
    return { providerMessageId: res.data?.message_id ?? "" };
  }
}
