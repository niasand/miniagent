import type { ChannelMessage, SendResult, TestResult } from "./types.js";
import { BaseChannel } from "./base-channel.js";

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const CHANNEL_VERSION = "2.0.0";
const MAX_BACKOFF_MS = 30_000;
const MAX_TEXT_LEN = 2000;
const POLL_TIMEOUT_MS = 40_000;

export class WeChatChannel extends BaseChannel {
  readonly channelType = "wechat";
  private uin: string;
  private contextTokens = new Map<string, string>(); // userId → context_token

  constructor(private readonly config: Record<string, string>) {
    super();
    this.uin = btoa(String(Math.floor(Math.random() * 0xFFFFFFFF)));
  }

  async test(): Promise<TestResult> {
    if (!this.config.bot_token) return { ok: false, message: "bot_token is empty" };
    return this.safeTest(async () => {
      const url = `${this.baseUrl()}/ilink/bot/getupdates?timeout=1`;
      const res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
      const data = await res.json().catch(() => null) as WeChatApiStatus | null;
      if (!data) return { ok: false, message: "Invalid WeChat response" };
      // errcode=-14 means "session not established" — proves the token is accepted
      if (data.errcode === -14) return { ok: true, message: "Connected" };
      const error = wechatApiError(data);
      if (error) return { ok: false, message: error };
      return { ok: true, message: "Connected" };
    });
  }

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    this.stopped = false;
    this.pollLoop(onMessage);
  }

  async send(targetRef: string, content: string): Promise<SendResult> {
    const userId = targetRef.replace(/^wechat:/, "");
    const contextToken = this.contextTokens.get(userId);
    if (!contextToken) throw new Error(`No context_token for ${userId}`);

    const url = `${this.baseUrl()}/ilink/bot/sendmessage`;
    const chunks = BaseChannel.splitText(content, MAX_TEXT_LEN);

    for (const chunk of chunks) {
      const clientId = String(Math.floor(Math.random() * 0xFFFFFFFF));
      const res = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          msg: {
            to_user_id: userId,
            context_token: contextToken,
            item_list: [{ type: 1, text_item: { text: chunk } }],
            message_type: 2,
            message_state: 2,
            client_id: clientId,
          },
          base_info: { channel_version: CHANNEL_VERSION },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json() as WeChatApiStatus;
      if (!res.ok) throw new Error(`WeChat send failed: ${res.status}`);
      const error = wechatApiError(data);
      if (error) throw new Error(`WeChat send error: ${error}`);
    }

    return { providerMessageId: "" };
  }

  private async pollLoop(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    let updatesBuf = "";

    while (!this.stopped) {
      try {
        const url = `${this.baseUrl()}/ilink/bot/getupdates`;
        const res = await fetch(url, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({
            get_updates_buf: updatesBuf,
            base_info: { channel_version: CHANNEL_VERSION },
          }),
          signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        });

        if (!res.ok) throw new Error(`getupdates: ${res.status}`);
        const data = await res.json() as WeChatUpdatesResponse;

        if (data.errcode === -14) {
          console.error("[WeChat] Session expired, stopping");
          break;
        }

        updatesBuf = data.get_updates_buf ?? updatesBuf;
        this.attempt = 0;

        const msgs = data.msgs ?? [];
        if (msgs.length > 0) console.log(`[WeChat] Received ${msgs.length} message(s)`);

        for (const msg of msgs) {
          const fromUserId = msg.from_user_id ?? "";
          const messageId = msg.message_id ?? msg.seq ?? `${fromUserId}:${Date.now()}`;

          // Cache context_token for replies
          if (msg.context_token) {
            this.contextTokens.set(fromUserId, msg.context_token);
          }

          // Extract text from item_list
          let text = "";
          for (const item of msg.item_list ?? []) {
            if (item.text_item?.text) {
              text += item.text_item.text;
            } else if (item.voice_item?.text) {
              text += item.voice_item.text; // STT transcription
            }
          }
          text = text.trim();
          if (!text) continue;

          const chatType = "private" as const; // WeChat iLink is 1:1 only
          onMessage({
            messageId: String(messageId),
            chatId: `wechat:${fromUserId}`,
            userId: fromUserId,
            text,
            chatType,
            isMentioned: true, // 1:1 chat, always mentioned
          });
        }
      } catch (err) {
        if (this.stopped) break;
        const delay = this.nextBackoffMs(MAX_BACKOFF_MS);
        console.error(`[WeChat] Poll error, retrying in ${delay}ms:`, err instanceof Error ? err.message : err);
        await BaseChannel.sleep(delay);
      }
    }
  }

  private baseUrl(): string {
    return this.config.base_url ?? DEFAULT_BASE_URL;
  }

  private headers(): Record<string, string> {
    return {
      "AuthorizationType": "ilink_bot_token",
      "Authorization": `Bearer ${this.config.bot_token}`,
      "X-WECHAT-UIN": this.uin,
      "iLink-App-ClientVersion": "1",
      "Content-Type": "application/json",
    };
  }
}

type WeChatUpdatesResponse = {
  errcode?: number;
  errmsg?: string;
  get_updates_buf?: string;
  msgs?: Array<{
    message_id?: string;
    seq?: string;
    from_user_id?: string;
    context_token?: string;
    item_list?: Array<{
      type?: number;
      text_item?: { text?: string };
      voice_item?: { text?: string };
    }>;
  }>;
};

type WeChatApiStatus = {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  [key: string]: unknown;
};

function wechatApiError(data: WeChatApiStatus): string | null {
  if (data.ret !== undefined && data.ret !== 0) {
    return `ret=${data.ret} errcode=${data.errcode} ${data.errmsg ?? ""}`.trim();
  }
  if (data.errcode !== undefined && data.errcode !== 0) {
    return `ret=${data.ret} errcode=${data.errcode} ${data.errmsg ?? ""}`.trim();
  }
  return null;
}
