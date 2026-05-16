import type { ChannelAdapter, ChannelMessage, SendResult } from "./types.js";

const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const API_BASE = "https://api.sgroup.qq.com";
const GATEWAY_URL = API_BASE + "/gateway/bot";

const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RECONNECT = 7;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

const INTENTS_PUBLIC_MESSAGES = 1 << 25;
const REFRESH_BUFFER_MS = 300_000;

type TokenInfo = { accessToken: string; expiresAt: number };
type WsPayload = { op: number; d?: unknown; s?: number; t?: string };

export class QQChannel implements ChannelAdapter {
  readonly channelType = "qq";
  private token: TokenInfo | null = null;
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string | null = null;
  private lastSeq: number | null = null;
  private attempt = 0;
  private stopped = false;
  private msgSeqCounters = new Map<string, number>();

  constructor(private readonly config: Record<string, string>) {}

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    this.stopped = false;
    await this.connect(onMessage);
  }

  stop(): void {
    this.stopped = true;
    this.cleanup();
  }

  async send(targetRef: string, content: string): Promise<SendResult> {
    const token = await this.getToken();
    const headers = { Authorization: `QQBot ${token}`, "Content-Type": "application/json" };

    if (targetRef.startsWith("c2c:")) {
      const openid = targetRef.slice(4);
      const res = await fetch(`${API_BASE}/v2/users/${openid}/messages`, {
        method: "POST", headers,
        body: JSON.stringify({ markdown: { content }, msg_type: 2, msg_seq: this.nextSeq(openid) }),
      });
      if (!res.ok) throw new Error(`QQ C2C send failed: ${res.status}`);
    } else if (targetRef.startsWith("group:")) {
      const openid = targetRef.slice(6);
      const res = await fetch(`${API_BASE}/v2/groups/${openid}/messages`, {
        method: "POST", headers,
        body: JSON.stringify({ markdown: { content }, msg_type: 2, msg_seq: this.nextSeq(openid) }),
      });
      if (!res.ok) throw new Error(`QQ group send failed: ${res.status}`);
    }

    return { providerMessageId: "" };
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - REFRESH_BUFFER_MS) {
      return this.token.accessToken;
    }
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: this.config.app_id, clientSecret: this.config.app_secret }),
    });
    if (!res.ok) throw new Error(`QQ token fetch failed: ${res.status}`);
    const data = await res.json() as { access_token: string; expires_in: number };
    this.token = { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000 };
    return this.token.accessToken;
  }

  private nextSeq(target: string): number {
    const seq = (this.msgSeqCounters.get(target) ?? 0) + 1;
    this.msgSeqCounters.set(target, seq);
    return seq;
  }

  private async connect(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    if (this.stopped) return;
    try {
      const token = await this.getToken();
      const gatewayRes = await fetch(GATEWAY_URL, { headers: { Authorization: `QQBot ${token}` } });
      if (!gatewayRes.ok) throw new Error(`Gateway fetch failed: ${gatewayRes.status}`);
      const { url } = await gatewayRes.json() as { url: string };

      this.ws = new WebSocket(url);
      this.ws.addEventListener("message", (ev) => this.handleMessage(ev.data, onMessage));
      this.ws.addEventListener("close", () => { this.cleanup(); this.scheduleReconnect(onMessage); });
      this.ws.addEventListener("error", () => {});
    } catch (err) {
      console.error(`[QQ] Connect failed: ${err instanceof Error ? err.message : err}`);
      this.scheduleReconnect(onMessage);
    }
  }

  private handleMessage(raw: string, onMessage: (msg: ChannelMessage) => void): void {
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
        this.handleDispatch(payload.t, payload.d as Record<string, unknown>, onMessage);
        break;
      }
      case OP_RECONNECT: {
        this.cleanup();
        this.scheduleReconnect(onMessage);
        break;
      }
      case OP_HEARTBEAT_ACK:
        break;
    }
  }

  private handleDispatch(type: string | undefined, data: Record<string, unknown>, onMessage: (msg: ChannelMessage) => void): void {
    if (!type) return;

    if (type === "READY") {
      this.sessionId = data.session_id as string;
      this.attempt = 0;
      console.log(`[QQ] Ready, session=${this.sessionId}`);
      return;
    }
    if (type === "RESUMED") {
      this.attempt = 0;
      return;
    }
    if (type === "C2C_MESSAGE_CREATE") {
      const author = data.author as Record<string, string>;
      onMessage({
        messageId: data.id as string,
        chatId: `c2c:${author?.user_openid ?? ""}`,
        userId: author?.user_openid ?? "",
        text: this.stripAtBot(data.content as string ?? ""),
        chatType: "private",
      });
      return;
    }
    if (type === "GROUP_AT_MESSAGE_CREATE") {
      const author = data.author as Record<string, string>;
      onMessage({
        messageId: data.id as string,
        chatId: `group:${data.group_openid}`,
        userId: author?.user_openid ?? author?.member_openid ?? "",
        text: this.stripAtBot(data.content as string ?? ""),
        chatType: "group",
        isMentioned: true, // QQ gateway only sends group messages when bot is @mentioned
      });
      return;
    }
  }

  private stripAtBot(content: string): string {
    return content.replace(/<@!\d+>\s*/, "").trim();
  }

  private sendIdentify(): void {
    this.getToken().then((t) => {
      this.sendWs({ op: OP_IDENTIFY, d: { token: `QQBot ${t}`, intents: INTENTS_PUBLIC_MESSAGES, shard: [0, 1] } });
    }).catch(() => { this.cleanup(); });
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => this.sendWs({ op: OP_HEARTBEAT, d: this.lastSeq }), intervalMs);
  }

  private sendWs(payload: WsPayload): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  private scheduleReconnect(onMessage: (msg: ChannelMessage) => void): void {
    if (this.stopped) return;
    const delay = Math.min(1000 * 2 ** this.attempt, 30_000);
    this.attempt++;
    console.log(`[QQ] Reconnecting in ${delay}ms (attempt ${this.attempt})`);
    this.reconnectTimer = setTimeout(() => this.connect(onMessage), delay);
  }

  private cleanup(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } this.ws = null; }
  }
}
