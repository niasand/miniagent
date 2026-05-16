// Telegram Bot API client — REST sender, long-polling receiver

const API_BASE = "https://api.telegram.org";
const POLL_TIMEOUT_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

export type TelegramMessageEvent = {
  id: string; // update_id as string
  chatId: number; // chat.id
  chatType: "private" | "group" | "supergroup";
  userId: number; // from.id
  text: string;
};

export type TelegramMessageHandler = (msg: TelegramMessageEvent) => void;

// ── REST Client (send messages) ──

export class TelegramRestClient {
  constructor(private readonly botToken: string) {}

  async sendMessage(
    chatId: number | string,
    text: string,
    parseMode: "MarkdownV2" | "HTML" = "MarkdownV2",
  ): Promise<void> {
    const url = `${API_BASE}/bot${this.botToken}/sendMessage`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
      });

      if (res.ok) return;

      if (res.status === 429) {
        const body = (await res.json()) as { parameters?: { retry_after?: number } };
        const retryAfter = body.parameters?.retry_after ?? 1;
        await sleep(retryAfter * 1000);
        continue;
      }

      const body = await res.text();
      throw new Error(`Telegram send failed: ${res.status} ${body}`);
    }

    throw lastError ?? new Error("Telegram send failed after retries");
  }
}

// ── Long Polling Client (receive messages) ──

export class TelegramPollingClient {
  private stopped = false;
  private abortController: AbortController | null = null;
  private offset = 0;
  private attempt = 0;

  constructor(
    private readonly botToken: string,
    private readonly onMessage: TelegramMessageHandler,
    private readonly log = (msg: string) => console.log(`[Telegram] ${msg}`),
  ) {}

  start(): void {
    this.stopped = false;
    this.poll();
  }

  stop(): void {
    this.stopped = true;
    this.abortController?.abort();
    this.log("Stopped");
  }

  private async poll(): Promise<void> {
    while (!this.stopped) {
      try {
        this.abortController = new AbortController();
        const url = `${API_BASE}/bot${this.botToken}/getUpdates?offset=${this.offset}&timeout=30`;

        const res = await fetch(url, { signal: this.abortController.signal });

        if (!res.ok) {
          throw new Error(`getUpdates failed: ${res.status}`);
        }

        const data = (await res.json()) as {
          ok: boolean;
          result: Array<TelegramRawUpdate>;
        };

        if (!data.ok) {
          throw new Error("getUpdates returned ok=false");
        }

        for (const update of data.result) {
          this.offset = update.update_id + 1;
          if (update.message?.text) {
            const msg = update.message;
            this.onMessage({
              id: String(update.update_id),
              chatId: msg.chat.id,
              chatType: msg.chat.type as "private" | "group" | "supergroup",
              userId: msg.from.id,
              text: msg.text,
            });
          }
        }

        this.attempt = 0;
      } catch (err) {
        if (this.stopped) break;
        if (err instanceof DOMException && err.name === "AbortError") break;

        const delay = Math.min(1000 * 2 ** this.attempt, MAX_BACKOFF_MS);
        this.attempt++;
        this.log(`Poll error, retrying in ${delay}ms (attempt ${this.attempt}): ${err instanceof Error ? err.message : err}`);
        await sleep(delay);
      }
    }
  }
}

type TelegramRawUpdate = {
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
