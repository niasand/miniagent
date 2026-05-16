import type { ChannelAdapter, ChannelMessage, SendResult } from "./types.js";

const API_BASE = "https://api.telegram.org";
const POLL_TIMEOUT_S = 30;
const MAX_BACKOFF_MS = 30_000;

export class TelegramChannel implements ChannelAdapter {
  readonly channelType = "telegram";
  private stopped = false;
  private abortController: AbortController | null = null;
  private offset = 0;
  private attempt = 0;
  private botUsername: string | null = null;

  constructor(private readonly config: Record<string, string>) {}

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    this.stopped = false;
    await this.fetchBotInfo();
    this.poll(onMessage);
  }

  private async fetchBotInfo(): Promise<void> {
    try {
      const url = `${API_BASE}/bot${this.config.bot_token}/getMe`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json() as { result?: { username?: string } };
        this.botUsername = data.result?.username ?? null;
        console.log(`[Telegram] Bot username: @${this.botUsername}`);
      }
    } catch { /* ignore */ }
  }

  stop(): void {
    this.stopped = true;
    this.abortController?.abort();
  }

  async send(targetRef: string, content: string): Promise<SendResult> {
    const chatId = targetRef.replace(/^(private|group|supergroup):/, "");
    const url = `${API_BASE}/bot${this.config.bot_token}/sendMessage`;

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: content }),
      });

      if (res.ok) {
        const data = await res.json() as { result?: { message_id?: number } };
        return { providerMessageId: String(data.result?.message_id ?? "") };
      }

      if (res.status === 429) {
        const body = await res.json() as { parameters?: { retry_after?: number } };
        await sleep((body.parameters?.retry_after ?? 1) * 1000);
        continue;
      }

      throw new Error(`Telegram send failed: ${res.status}`);
    }
    throw new Error("Telegram send failed after retries");
  }

  private async poll(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    while (!this.stopped) {
      try {
        this.abortController = new AbortController();
        const url = `${API_BASE}/bot${this.config.bot_token}/getUpdates?offset=${this.offset}&timeout=${POLL_TIMEOUT_S}`;
        const res = await fetch(url, { signal: this.abortController.signal });

        if (!res.ok) throw new Error(`getUpdates: ${res.status}`);
        const data = await res.json() as { ok: boolean; result: TelegramUpdate[] };
        if (!data.ok) throw new Error("getUpdates returned ok=false");

        for (const update of data.result) {
          this.offset = update.update_id + 1;
          if (update.message?.text) {
            const msg = update.message;
            const text = msg.text as string;
            const isMentioned = this.botUsername
              ? text.includes(`@${this.botUsername}`)
              : false;
            onMessage({
              messageId: String(update.update_id),
              chatId: `${msg.chat.type}:${msg.chat.id}`,
              userId: String(msg.from.id),
              text,
              chatType: msg.chat.type === "private" ? "private" : "group",
              isMentioned,
            });
          }
        }
        this.attempt = 0;
      } catch (err) {
        if (this.stopped) break;
        if (err instanceof DOMException && err.name === "AbortError") break;
        const delay = Math.min(1000 * 2 ** this.attempt, MAX_BACKOFF_MS);
        this.attempt++;
        console.error(`[Telegram] Poll error, retrying in ${delay}ms:`, err instanceof Error ? err.message : err);
        await sleep(delay);
      }
    }
  }
}

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number };
    chat: { id: number; type: string };
    text?: string;
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
