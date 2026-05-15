// QQ Bot API client — token management, REST sender, WebSocket receiver

const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const API_BASE = "https://api.sgroup.qq.com";
const GATEWAY_URL = API_BASE + "/gateway/bot";

const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RESUME = 6;
const OP_RECONNECT = 7;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

const INTENTS_PUBLIC_MESSAGES = 1 << 25;
const REFRESH_BUFFER_MS = 300_000; // refresh 5 min before expiry

type TokenInfo = { accessToken: string; expiresAt: number };

export type QQMessageEvent = {
  id: string;
  content: string;
  author: { user_openid: string; member_openid: string };
  group_openid?: string;
  chatType: "c2c" | "group";
};

export type QQMessageHandler = (msg: QQMessageEvent) => void;

// ── Token Manager ──

export class QQTokenManager {
  private token: TokenInfo | null = null;
  private refreshPromise: Promise<string> | null = null;

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
  ) {}

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - REFRESH_BUFFER_MS) {
      return this.token.accessToken;
    }
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.fetchToken();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async fetchToken(): Promise<string> {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: this.appId, clientSecret: this.appSecret }),
    });
    if (!res.ok) throw new Error(`QQ token fetch failed: ${res.status}`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
    };
    return this.token.accessToken;
  }
}

// ── REST Client (send messages) ──

export class QQRestClient {
  private msgSeqCounters = new Map<string, number>();

  constructor(private readonly tokenManager: QQTokenManager) {}

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.tokenManager.getToken();
    return { Authorization: `QQBot ${token}`, "Content-Type": "application/json" };
  }

  private nextSeq(target: string): number {
    const seq = (this.msgSeqCounters.get(target) ?? 0) + 1;
    this.msgSeqCounters.set(target, seq);
    return seq;
  }

  async sendC2CMessage(openid: string, content: string): Promise<void> {
    const headers = await this.authHeaders();
    const res = await fetch(`${API_BASE}/v2/users/${openid}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ markdown: { content }, msg_type: 2, msg_seq: this.nextSeq(openid) }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`QQ C2C send failed: ${res.status} ${body}`);
    }
  }

  async sendGroupMessage(groupOpenid: string, content: string): Promise<void> {
    const headers = await this.authHeaders();
    const res = await fetch(`${API_BASE}/v2/groups/${groupOpenid}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ markdown: { content }, msg_type: 2, msg_seq: this.nextSeq(groupOpenid) }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`QQ group send failed: ${res.status} ${body}`);
    }
  }
}

// ── WebSocket Client (receive messages) ──

type WsPayload = { op: number; d?: unknown; s?: number; t?: string };

export class QQWebSocketClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string | null = null;
  private lastSeq: number | null = null;
  private attempt = 0;
  private stopped = false;

  constructor(
    private readonly tokenManager: QQTokenManager,
    private readonly onMessage: QQMessageHandler,
    private readonly log = (msg: string) => console.log(`[QQ WS] ${msg}`),
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
      const token = await this.tokenManager.getToken();
      const gatewayRes = await fetch(GATEWAY_URL, {
        headers: { Authorization: `QQBot ${token}` },
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

    if (payload.s != null) this.lastSeq = payload.s;

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
      this.sessionId = data.session_id as string;
      this.attempt = 0;
      this.log(`Ready, session=${this.sessionId}`);
      return;
    }
    if (type === "RESUMED") {
      this.attempt = 0;
      this.log("Resumed");
      return;
    }
    if (type === "C2C_MESSAGE_CREATE") {
      const author = data.author as Record<string, string>;
      this.onMessage({
        id: data.id as string,
        content: this.stripAtBot(data.content as string ?? ""),
        author: { user_openid: author?.user_openid ?? "", member_openid: author?.member_openid ?? "" },
        chatType: "c2c",
      });
      return;
    }
    if (type === "GROUP_AT_MESSAGE_CREATE") {
      const author = data.author as Record<string, string>;
      this.onMessage({
        id: data.id as string,
        content: this.stripAtBot(data.content as string ?? ""),
        author: { user_openid: author?.user_openid ?? "", member_openid: author?.member_openid ?? "" },
        group_openid: data.group_openid as string,
        chatType: "group",
      });
      return;
    }
  }

  private stripAtBot(content: string): string {
    // Remove @bot prefix like "<@!123456>" or just trim
    return content.replace(/<@!\d+>\s*/, "").trim();
  }

  private sendIdentify(): void {
    const token = this.tokenManager.getToken().catch(() => "");
    // token is cached, so this is sync-ish, but we handle it in the next tick
    this.tokenManager.getToken().then((t) => {
      this.send({ op: OP_IDENTIFY, d: { token: `QQBot ${t}`, intents: INTENTS_PUBLIC_MESSAGES, shard: [0, 1] } });
    });
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.send({ op: OP_HEARTBEAT, d: this.lastSeq });
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
