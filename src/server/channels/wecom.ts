import type { ChannelMessage, SendResult, TestResult } from "./types.js";
import { BaseChannel } from "./base-channel.js";

const GATEWAY_URL = "wss://openws.work.weixin.qq.com";
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEALTH_CHECK_MS = 90_000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const MAX_TEXT_LEN = 4096;

export class WeComChannel extends BaseChannel {
  readonly channelType = "wecom";
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPongAt = 0;
  private pendingRequests = new Map<string, string>(); // req_id → from userid

  constructor(private readonly config: Record<string, string>) {
    super();
  }

  async test(): Promise<TestResult> {
    const { bot_id, secret } = this.config;
    if (!bot_id || !secret) return { ok: false, message: "bot_id or secret is empty" };
    return this.safeTest(async () => {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(GATEWAY_URL);
        const timer = setTimeout(() => { ws.close(); reject(new Error("Timeout")); }, 5000);
        ws.addEventListener("open", () => {
          clearTimeout(timer);
          ws.close();
          resolve();
        });
        ws.addEventListener("error", (e) => { clearTimeout(timer); reject(e); });
      });
      return { ok: true, message: "Gateway reachable" };
    });
  }

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    this.stopped = false;
    await this.connect(onMessage);
  }

  stop(): void {
    super.stop();
    this.cleanup();
  }

  async send(targetRef: string, content: string): Promise<SendResult> {
    // WeCom replies use req_id correlation, not direct send
    // Find pending req_id for this user
    const userId = targetRef.replace(/^wecom:/, "");
    const reqId = this.pendingRequests.get(userId);
    if (!reqId) {
      console.warn(`[WeCom] No pending req_id for ${userId}, cannot send proactive message`);
      return { providerMessageId: "" };
    }

    const chunks = BaseChannel.splitText(content, MAX_TEXT_LEN);
    for (const chunk of chunks) {
      this.sendWs({
        cmd: "aibot_respond_msg",
        headers: { req_id: reqId },
        body: { msgtype: "markdown", markdown: { content: chunk } },
      });
    }

    this.pendingRequests.delete(userId);
    return { providerMessageId: "" };
  }

  private async connect(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    if (this.stopped) return;

    try {
      this.ws = new WebSocket(GATEWAY_URL);

      this.ws.addEventListener("open", () => {
        this.lastPongAt = Date.now();
        this.subscribe();
        this.startHeartbeat();
        this.startHealthCheck(onMessage);
      });

      this.ws.addEventListener("message", (ev) => {
        try {
          const data = JSON.parse(ev.data as string) as WeComPayload;
          this.handleMessage(data, onMessage);
        } catch (err) {
          console.error("[WeCom] Failed to parse message:", err);
        }
      });

      this.ws.addEventListener("close", () => {
        this.cleanup();
        this.scheduleReconnect(onMessage);
      });

      this.ws.addEventListener("error", () => {
        // Error handled by close event
      });
    } catch (err) {
      console.error(`[WeCom] Connect failed: ${err instanceof Error ? err.message : err}`);
      this.scheduleReconnect(onMessage);
    }
  }

  private subscribe(): void {
    this.sendWs({
      cmd: "aibot_subscribe",
      headers: { req_id: crypto.randomUUID() },
      body: { bot_id: this.config.bot_id, secret: this.config.secret },
    });
  }

  private handleMessage(payload: WeComPayload, onMessage: (msg: ChannelMessage) => void): void {
    const { cmd, headers, body } = payload;

    switch (cmd) {
      case "aibot_subscribe":
        if (body?.retcode === 0) {
          this.attempt = 0;
          console.log("[WeCom] Subscribed successfully");
        } else {
          console.error("[WeCom] Subscribe failed:", body);
        }
        break;

      case "ping":
        this.lastPongAt = Date.now();
        this.sendWs({ cmd: "pong", headers: { req_id: headers?.req_id ?? crypto.randomUUID() } });
        break;

      case "aibot_msg_callback": {
        const msg = body as WeComMessage;
        const userId = msg.from?.userid ?? "";
        const text = msg.text?.content?.trim() ?? "";
        if (!text) return;

        // Cache req_id for reply
        if (headers?.req_id) {
          this.pendingRequests.set(userId, headers.req_id);
        }

        const chatType = msg.chattype === "single" ? "private" : "group";
        onMessage({
          messageId: msg.msgid ?? `${userId}:${Date.now()}`,
          chatId: `wecom:${userId}`,
          userId,
          text,
          chatType,
          isMentioned: true, // WeCom smart robot only receives directed messages
        });
        break;
      }

      default:
        break;
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.sendWs({ cmd: "ping", headers: { req_id: crypto.randomUUID() } });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private startHealthCheck(onMessage: (msg: ChannelMessage) => void): void {
    if (this.healthTimer) clearTimeout(this.healthTimer);
    this.healthTimer = setTimeout(() => {
      if (Date.now() - this.lastPongAt > HEALTH_CHECK_MS) {
        console.warn("[WeCom] No pong received, reconnecting");
        this.ws?.close();
      }
    }, HEALTH_CHECK_MS);
  }

  private sendWs(payload: WeComPayload): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private scheduleReconnect(onMessage: (msg: ChannelMessage) => void): void {
    if (this.stopped) return;
    const delay = this.nextBackoffMs(MAX_BACKOFF_MS);
    console.log(`[WeCom] Reconnecting in ${delay}ms (attempt ${this.attempt})`);
    setTimeout(() => this.connect(onMessage), delay);
  }

  private cleanup(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.healthTimer) { clearTimeout(this.healthTimer); this.healthTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } this.ws = null; }
  }
}

type WeComPayload = {
  cmd: string;
  headers?: { req_id?: string };
  body?: Record<string, unknown>;
};

type WeComMessage = {
  msgid?: string;
  msgtype?: string;
  chattype?: string;
  from?: { userid?: string; name?: string };
  chatid?: string;
  text?: { content?: string };
};
