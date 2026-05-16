// Discord Bot API client — REST sender, WebSocket gateway receiver

const API_BASE = "https://discord.com/api/v10";
const GATEWAY_URL = API_BASE + "/gateway/bot";

const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RECONNECT = 7;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

const INTENT_GUILD_MESSAGES = 1 << 9;
const INTENT_MESSAGE_CONTENT = 1 << 15;

export type DiscordMessageEvent = {
  id: string;
  channelId: string;
  guildId?: string;
  authorId: string;
  content: string;
  isDm: boolean;
};

export type DiscordMessageHandler = (msg: DiscordMessageEvent) => void;

// ── REST Client (send messages) ──

export class DiscordRestClient {
  constructor(private readonly botToken: string) {}

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bot ${this.botToken}`, "Content-Type": "application/json" };
  }

  async sendMessage(channelId: string, content: string): Promise<void> {
    const res = await fetch(`${API_BASE}/channels/${channelId}/messages`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({ content }),
    });
    if (res.status === 429) {
      const data = (await res.json()) as { retry_after?: number };
      const delay = (data.retry_after ?? 5) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.sendMessage(channelId, content);
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Discord send failed: ${res.status} ${body}`);
    }
  }
}

// ── WebSocket Client (receive messages) ──

type WsPayload = { op: number; d?: unknown; s?: number; t?: string };

export class DiscordGatewayClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = false;

  constructor(
    private readonly botToken: string,
    private readonly onMessage: DiscordMessageHandler,
    private readonly log = (msg: string) => console.log(`[Discord WS] ${msg}`),
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.cleanup();
    this.log("Stopped");
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    try {
      const gatewayRes = await fetch(GATEWAY_URL, {
        headers: { Authorization: `Bot ${this.botToken}` },
      });
      if (!gatewayRes.ok) throw new Error(`Gateway fetch failed: ${gatewayRes.status}`);
      const { url } = (await gatewayRes.json()) as { url: string };

      this.ws = new WebSocket(url);
      this.ws.addEventListener("open", () => this.log("Connected"));
      this.ws.addEventListener("message", (ev) => this.handleMessage(ev.data));
      this.ws.addEventListener("close", (ev) => {
        this.log(`Closed: code=${ev.code} reason=${ev.reason}`);
        this.cleanup();
        this.scheduleReconnect();
      });
      this.ws.addEventListener("error", () => {
        this.log("Error");
      });
    } catch (err) {
      this.log(`Connect failed: ${err instanceof Error ? err.message : err}`);
      this.scheduleReconnect();
    }
  }

  private handleMessage(raw: string): void {
    const payload: WsPayload = JSON.parse(raw as string);

    switch (payload.op) {
      case OP_HELLO: {
        const d = payload.d as { heartbeat_interval: number };
        this.startHeartbeat(d.heartbeat_interval);
        this.sendIdentify();
        break;
      }
      case OP_DISPATCH: {
        this.handleDispatch(payload.t, payload.d as Record<string, unknown>);
        break;
      }
      case OP_RECONNECT: {
        this.log("Server requested reconnect");
        this.cleanup();
        this.scheduleReconnect();
        break;
      }
      case OP_HEARTBEAT_ACK:
        break;
      default:
        this.log(`Unknown OP: ${payload.op}`);
    }
  }

  private handleDispatch(type: string | undefined, data: Record<string, unknown>): void {
    if (!type) return;

    if (type === "READY") {
      this.attempt = 0;
      this.log(`Ready, user=${(data.user as Record<string, unknown>)?.id ?? "unknown"}`);
      return;
    }
    if (type === "MESSAGE_CREATE") {
      const author = data.author as Record<string, string> | undefined;
      const guildId = data.guild_id as string | undefined;
      this.onMessage({
        id: data.id as string,
        channelId: data.channel_id as string,
        guildId,
        authorId: author?.id ?? "",
        content: (data.content as string) ?? "",
        isDm: !guildId,
      });
      return;
    }
  }

  private sendIdentify(): void {
    this.send({
      op: OP_IDENTIFY,
      d: {
        token: this.botToken,
        intents: INTENT_GUILD_MESSAGES | INTENT_MESSAGE_CONTENT,
        properties: { os: "linux", browser: "miniagent", device: "miniagent" },
      },
    });
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.send({ op: OP_HEARTBEAT, d: null });
    }, intervalMs);
  }

  private send(payload: WsPayload): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = Math.min(1000 * 2 ** this.attempt, 30_000);
    this.attempt++;
    this.log(`Reconnecting in ${delay}ms (attempt ${this.attempt})`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private cleanup(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
  }
}
