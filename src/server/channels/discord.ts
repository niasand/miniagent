import type { ChannelAdapter, ChannelMessage, SendResult } from "./types.js";

const API_BASE = "https://discord.com/api/v10";
const MAX_BACKOFF_MS = 30_000;

export class DiscordChannel implements ChannelAdapter {
  readonly channelType = "discord";
  private ws: WebSocket | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private attempt = 0;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;

  constructor(private readonly config: Record<string, string>) {}

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    this.stopped = false;
    await this.connect(onMessage);
  }

  stop(): void {
    this.stopped = true;
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.ws) this.ws.close();
  }

  async send(targetRef: string, content: string): Promise<SendResult> {
    const channelId = targetRef.replace(/^channel:/, "");
    const res = await fetch(`${API_BASE}/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bot ${this.config.bot_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 2000) }),
    });

    if (res.status === 429) {
      const body = await res.json() as { retry_after?: number };
      await sleep((body.retry_after ?? 1) * 1000);
      return this.send(targetRef, content); // retry
    }

    if (!res.ok) throw new Error(`Discord send failed: ${res.status}`);
    const data = await res.json() as { id?: string };
    return { providerMessageId: data.id ?? "" };
  }

  private async connect(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    // Get gateway URL
    const gatewayRes = await fetch("https://discord.com/api/v10/gateway/bot", {
      headers: { "Authorization": `Bot ${this.config.bot_token}` },
    });
    const gatewayData = await gatewayRes.json() as { url?: string };
    const url = gatewayData.url ?? "wss://gateway.discord.gg";

    this.ws = new WebSocket(`${url}/?v=10&encoding=json`);

    this.ws.onmessage = (event) => {
      const payload = JSON.parse(event.data as string) as DiscordPayload;
      this.handlePayload(payload, onMessage);
    };

    this.ws.onclose = () => {
      if (!this.stopped) {
        const delay = Math.min(1000 * 2 ** this.attempt, MAX_BACKOFF_MS);
        this.attempt++;
        console.log(`[Discord] Reconnecting in ${delay}ms`);
        setTimeout(() => this.connect(onMessage), delay);
      }
    };

    this.ws.onerror = (err) => {
      console.error("[Discord] WebSocket error:", err);
    };

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error("No WebSocket"));
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("Connection failed"));
    });
  }

  private handlePayload(payload: DiscordPayload, onMessage: (msg: ChannelMessage) => void): void {
    if (payload.s) this.seq = payload.s;

    switch (payload.op) {
      case 10: { // HELLO
        const d = payload.d as { heartbeat_interval: number };
        this.startHeartbeat(d.heartbeat_interval);
        this.identify();
        break;
      }
      case 11: // HEARTBEAT_ACK
        break;
      case 0: { // DISPATCH
        if (payload.t === "MESSAGE_CREATE") {
          const msg = payload.d as DiscordMessage;
          // Ignore own messages
          if (msg.author.bot) return;
          onMessage({
            messageId: msg.id,
            chatId: `channel:${msg.channel_id}`,
            userId: msg.author.id,
            text: msg.content,
            chatType: msg.guild_id ? "group" : "private",
          });
        }
        break;
      }
      case 7: // RECONNECT
        this.ws?.close();
        break;
      case 9: // INVALID_SESSION
        this.sessionId = null;
        setTimeout(() => this.identify(), 1000);
        break;
    }
  }

  private identify(): void {
    if (!this.ws) return;
    const intents = (1 << 9) | (1 << 15); // GUILD_MESSAGES + MESSAGE_CONTENT
    this.ws.send(JSON.stringify({
      op: 2,
      d: { token: this.config.bot_token, intents, properties: { os: "linux", browser: "miniagent", device: "miniagent" } },
    }));
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      this.ws?.send(JSON.stringify({ op: 1, d: this.seq }));
    }, intervalMs);
  }
}

type DiscordPayload = { op: number; t?: string; s?: number; d: unknown };
type DiscordMessage = { id: string; channel_id: string; guild_id?: string; author: { id: string; bot?: boolean }; content: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
