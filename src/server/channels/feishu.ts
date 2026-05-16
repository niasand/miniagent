import * as lark from "@larksuiteoapi/node-sdk";
import type { ChannelAdapter, ChannelMessage, SendResult, TestResult } from "./types.js";

type MessageListResult = {
  items?: Array<{
    message_id?: string;
    body?: { content?: string };
    sender?: { id?: string; id_type?: string; sender_type?: string };
  }>;
};

export class FeishuChannel implements ChannelAdapter {
  readonly channelType = "feishu";
  private wsClient: lark.WSClient | null = null;
  private larkClient: lark.Client | null = null;
  private connected = false;
  private lastMessageAt = 0;
  private backfillTimer: ReturnType<typeof setInterval> | null = null;
  private onMessageRef: ((msg: ChannelMessage) => void) | null = null;
  private knownChats = new Set<string>(); // track chats we've seen

  constructor(private readonly config: Record<string, string>) {}

  async test(): Promise<TestResult> {
    const { app_id, app_secret } = this.config;
    if (!app_id || !app_secret) return { ok: false, message: "app_id or app_secret is empty" };
    try {
      const client = new lark.Client({ appId: app_id, appSecret: app_secret, appType: lark.AppType.SelfBuild });
      const res = await client.auth.tenantAccessToken.internal({ data: { app_id, app_secret } });
      if (res.code !== 0) return { ok: false, message: `Feishu error: ${res.msg}` };
      return { ok: true, message: "Connected" };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Connection failed" };
    }
  }

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    const { app_id, app_secret } = this.config;
    if (!app_id || !app_secret) throw new Error("Feishu not configured");

    this.onMessageRef = onMessage;
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

          const isMentioned = /@_user_\d+/.test(text);
          text = text.replace(/@_user_\d+\s*/g, "").trim();
          if (!text) return;

          const chatType = message.chat_type === "p2p" ? "private" : "group";
          const chatRef = chatType === "private" ? `p2p:${chatId}` : `group:${chatId}`;

          this.lastMessageAt = Date.now();
          this.knownChats.add(chatRef);

          onMessage({
            messageId: message.message_id,
            chatId: chatRef,
            userId: senderOpenId,
            text,
            chatType,
            isMentioned,
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

    // Start periodic backfill check (every 5 minutes)
    this.backfillTimer = setInterval(() => {
      this.checkBackfill().catch((err) => {
        console.error("[Feishu] Backfill check failed:", err instanceof Error ? err.message : err);
      });
    }, 5 * 60 * 1000);
  }

  private async checkBackfill(): Promise<void> {
    if (!this.larkClient || !this.onMessageRef) return;

    const now = Date.now();
    // If we haven't seen a message in 5+ minutes, we might have missed some during disconnect
    if (now - this.lastMessageAt < 5 * 60 * 1000) return;

    const since = new Date(this.lastMessageAt);
    console.log(`[Feishu] Backfill check: fetching messages since ${since.toISOString()}`);

    for (const chatRef of this.knownChats) {
      try {
        const chatId = chatRef.replace(/^(p2p|group):/, "");
        const res = await this.larkClient.im.v1.message.list({
          params: {
            container_id_type: "chat",
            container_id: chatId,
            start_time: String(Math.floor(this.lastMessageAt / 1000)),
            end_time: String(Math.floor(now / 1000)),
            page_size: 50,
          },
        });

        const result = res.data as MessageListResult | undefined;
        const items = result?.items ?? [];
        for (const item of items) {
          if (!item.message_id || !item.body?.content) continue;
          // Skip bot's own messages
          if (item.sender?.sender_type === "app") continue;

          const content = item.body.content;
          let text = "";
          try {
            const parsed = JSON.parse(content);
            text = parsed.text ?? content;
          } catch {
            text = content;
          }

          const isMentioned = /@_user_\d+/.test(text);
          text = text.replace(/@_user_\d+\s*/g, "").trim();
          if (!text) continue;

          const chatType = chatRef.startsWith("p2p:") ? "private" : "group";
          this.onMessageRef({
            messageId: item.message_id,
            chatId: chatRef,
            userId: item.sender?.id ?? "",
            text,
            chatType,
            isMentioned,
          });
        }

        if (items.length > 0) {
          console.log(`[Feishu] Backfill: recovered ${items.length} messages from ${chatRef}`);
        }
      } catch (err) {
        console.error(`[Feishu] Backfill failed for ${chatRef}:`, err instanceof Error ? err.message : err);
      }
    }

    this.lastMessageAt = now;
  }

  stop(): void {
    if (this.backfillTimer) {
      clearInterval(this.backfillTimer);
      this.backfillTimer = null;
    }
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
