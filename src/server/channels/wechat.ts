import type { ChannelAdapter, ChannelMessage, SendResult, TestResult } from "./types.js";

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const CHANNEL_VERSION = "0.1.0";
const MAX_BACKOFF_MS = 30_000;
const MAX_TEXT_LEN = 2000;

export class WeChatChannel implements ChannelAdapter {
  readonly channelType = "wechat";
  private stopped = false;
  private attempt = 0;
  private uin: string;
  private contextTokens = new Map<string, string>(); // userId → context_token

  constructor(private readonly config: Record<string, string>) {
    this.uin = btoa(String(Math.floor(Math.random() * 0xFFFFFFFF)));
  }

  async test(): Promise<TestResult> {
    if (!this.config.bot_token) return { ok: false, message: "bot_token is empty" };
    try {
      const url = `${this.baseUrl()}/ilink/bot/getupdates?timeout=1`;
      const res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
      return { ok: true, message: "Connected" };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Connection failed" };
    }
  }

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    this.stopped = false;
    this.pollLoop(onMessage);
  }

  stop(): void {
    this.stopped = true;
  }

  async send(targetRef: string, content: string): Promise<SendResult> {
    const userId = targetRef.replace(/^wechat:/, "");
    const contextToken = this.contextTokens.get(userId);
    if (!contextToken) throw new Error(`No context_token for ${userId}`);

    const url = `${this.baseUrl()}/ilink/bot/sendmessage`;
    const chunks = splitText(content, MAX_TEXT_LEN);

    for (const chunk of chunks) {
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
            client_id: Math.floor(Math.random() * 0xFFFFFFFF),
          },
          base_info: { channel_version: CHANNEL_VERSION },
        }),
      });
      if (!res.ok) throw new Error(`WeChat send failed: ${res.status}`);
      const data = await res.json() as { errcode?: number; errmsg?: string };
      if (data.errcode && data.errcode !== 0) {
        throw new Error(`WeChat send error: ${data.errcode} ${data.errmsg}`);
      }
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
        });

        if (!res.ok) throw new Error(`getupdates: ${res.status}`);
        const data = await res.json() as WeChatUpdatesResponse;

        if (data.errcode === -14) {
          console.error("[WeChat] Session expired, stopping");
          break;
        }

        updatesBuf = data.get_updates_buf ?? updatesBuf;
        this.attempt = 0;

        for (const msg of data.msgs ?? []) {
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
        const delay = Math.min(1000 * 2 ** this.attempt, MAX_BACKOFF_MS);
        this.attempt++;
        console.error(`[WeChat] Poll error, retrying in ${delay}ms:`, err instanceof Error ? err.message : err);
        await sleep(delay);
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
      "Content-Type": "application/json",
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    if (rest.length <= maxLen) { chunks.push(rest); break; }
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return chunks;
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
