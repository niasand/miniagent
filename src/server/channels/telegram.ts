import type { ChannelMessage, SendResult, TestResult } from "./types.js";
import { BaseChannel } from "./base-channel.js";

const API_BASE = "https://api.telegram.org";
const POLL_TIMEOUT_S = 30;
const MAX_BACKOFF_MS = 30_000;

export class TelegramChannel extends BaseChannel {
  readonly channelType = "telegram";
  private abortController: AbortController | null = null;
  private offset = 0;
  private botUsername: string | null = null;

  constructor(private readonly config: Record<string, string>) {
    super();
  }

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

  async test(): Promise<TestResult> {
    const token = this.config.bot_token;
    if (!token) return { ok: false, message: "Bot token is empty" };
    return this.safeTest(async () => {
      const res = await fetch(`${API_BASE}/bot${token}/getMe`);
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
      const data = await res.json() as { result?: { username?: string; first_name?: string } };
      const name = data.result?.first_name ?? data.result?.username ?? "Bot";
      return { ok: true, message: `Connected: ${name} (@${data.result?.username})` };
    });
  }

  stop(): void {
    super.stop();
    this.abortController?.abort();
  }

  async send(targetRef: string, content: string): Promise<SendResult> {
    const chatId = targetRef.replace(/^(private|group|supergroup):/, "");
    const url = `${API_BASE}/bot${this.config.bot_token}/sendMessage`;

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: markdownToTelegramHtml(content), parse_mode: "HTML" }),
      });

      if (res.ok) {
        const data = await res.json() as { result?: { message_id?: number } };
        return { providerMessageId: String(data.result?.message_id ?? "") };
      }

      // If HTML parse fails, retry as plain text
      if (res.status === 400 && attempt === 0) {
        const plainRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: content }),
        });
        if (plainRes.ok) {
          const data = await plainRes.json() as { result?: { message_id?: number } };
          return { providerMessageId: String(data.result?.message_id ?? "") };
        }
      }

      if (res.status === 429) {
        const body = await res.json() as { parameters?: { retry_after?: number } };
        await BaseChannel.sleep((body.parameters?.retry_after ?? 1) * 1000);
        continue;
      }

      throw new Error(`Telegram send failed: ${res.status}`);
    }
    throw new Error("Telegram send failed after retries");
  }

  async react(targetRef: string, providerMessageId: string, emoji: string): Promise<void> {
    const chatId = targetRef.replace(/^(private|group|supergroup):/, "");
    const url = `${API_BASE}/bot${this.config.bot_token}/setMessageReaction`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: Number(providerMessageId),
        reaction: [{ type: "emoji", emoji }],
        is_big: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[Telegram] setMessageReaction failed (${res.status}):`, body);
    }
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
              providerMessageId: String(msg.message_id),
            });
          }
        }
        this.attempt = 0;
      } catch (err) {
        if (this.stopped) break;
        if (err instanceof DOMException && err.name === "AbortError") break;
        const delay = this.nextBackoffMs(MAX_BACKOFF_MS);
        console.error(`[Telegram] Poll error, retrying in ${delay}ms:`, err instanceof Error ? err.message : err);
        await BaseChannel.sleep(delay);
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

/**
 * Convert agent markdown output to Telegram HTML.
 * Telegram HTML supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a>
 */
function markdownToTelegramHtml(md: string): string {
  let html = md;

  // Escape HTML special chars in the raw text first
  html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Code blocks: ```lang\n...\n``` → <pre><code>...</code></pre>
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => `<pre><code>${code.trim()}</code></pre>`);

  // Inline code: `...` → <code>...</code>
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");

  // Bold: **...** or __...__ → <b>...</b>
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  html = html.replace(/__(.+?)__/g, "<b>$1</b>");

  // Italic: *...* or _..._ → <i>...</i>
  html = html.replace(/(?<!\w)\*([^\s*](?:[^*]*[^\s*])?)\*(?!\w)/g, "<i>$1</i>");
  html = html.replace(/(?<!\w)_([^\s_](?:[^_]*[^\s_])?)_(?!\w)/g, "<i>$1</i>");

  // Strikethrough: ~~...~~ → <s>...</s>
  html = html.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Links: [text](url) → <a href="url">text</a>
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  return html;
}
