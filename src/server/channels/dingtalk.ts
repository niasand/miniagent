import type { ChannelMessage, SendResult, TestResult } from "./types.js";
import { BaseChannel } from "./base-channel.js";

const TOKEN_URL = "https://oapi.dingtalk.com/gettoken";
const C2C_SEND_URL = "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend";
const GROUP_SEND_URL = "https://api.dingtalk.com/v1.0/robot/groupMessages/send";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

type TokenInfo = { accessToken: string; expiresAt: number };

export class DingTalkChannel extends BaseChannel {
  readonly channelType = "dingtalk";
  private token: TokenInfo | null = null;
  // Cache senderStaffId for C2C replies (keyed by senderId)
  private senderStaffIds = new Map<string, string>();

  constructor(private readonly config: Record<string, string>) {
    super();
  }

  async test(): Promise<TestResult> {
    const { client_id, client_secret } = this.config;
    if (!client_id || !client_secret) return { ok: false, message: "client_id or client_secret is empty" };
    return this.safeTest(async () => {
      const url = `${TOKEN_URL}?appkey=${client_id}&appsecret=${client_secret}`;
      const res = await fetch(url);
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
      const data = await res.json() as { access_token?: string; errcode?: number };
      if (!data.access_token) return { ok: false, message: `Error code: ${data.errcode}` };
      return { ok: true, message: "Connected" };
    });
  }

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    this.stopped = false;
    // DingTalk uses HTTP callback (webhook) for receiving messages.
    // The webhook route is registered in app.ts.
    // This start() validates credentials by fetching an access token.
    try {
      await this.getAccessToken();
      console.log("[DingTalk] Ready (webhook mode)");
    } catch (err) {
      console.error("[DingTalk] Failed to initialize:", err instanceof Error ? err.message : err);
    }
  }

  // stop() inherited from BaseChannel

  async send(targetRef: string, content: string): Promise<SendResult> {
    const token = await this.getAccessToken();
    const robotCode = this.config.client_id;
    const dingtalkMd = markdownToDingTalk(content);

    if (targetRef.startsWith("dingtalk:c2c:")) {
      const senderId = targetRef.replace("dingtalk:c2c:", "");
      const staffId = this.senderStaffIds.get(senderId);
      if (!staffId) throw new Error(`No staffId cached for sender ${senderId}`);

      const res = await fetch(C2C_SEND_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-acs-dingtalk-access-token": token,
        },
        body: JSON.stringify({
          robotCode,
          userIds: [staffId],
          msgKey: "sampleMarkdown",
          msgParam: JSON.stringify({ title: "Agent", text: dingtalkMd }),
        }),
      });
      if (!res.ok) throw new Error(`DingTalk C2C send failed: ${res.status}`);
      return { providerMessageId: "" };
    }

    if (targetRef.startsWith("dingtalk:group:")) {
      const openConversationId = targetRef.replace("dingtalk:group:", "");

      const res = await fetch(GROUP_SEND_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-acs-dingtalk-access-token": token,
        },
        body: JSON.stringify({
          openConversationId,
          robotCode,
          msgKey: "sampleMarkdown",
          msgParam: JSON.stringify({ title: "Agent", text: dingtalkMd }),
        }),
      });
      if (!res.ok) throw new Error(`DingTalk group send failed: ${res.status}`);
      return { providerMessageId: "" };
    }

    throw new Error(`Unknown DingTalk targetRef format: ${targetRef}`);
  }

  /** Called by the webhook route when a DingTalk callback arrives. */
  handleCallback(data: DingTalkCallback): void {
    // This is called from app.ts webhook route
    // The actual message processing is done there
    if (data.senderStaffId && data.senderId) {
      this.senderStaffIds.set(data.senderId, data.senderStaffId);
    }
  }

  /** Parse a DingTalk callback into a ChannelMessage. */
  static parseCallback(data: DingTalkCallback): ChannelMessage | null {
    const msgtype = data.msgtype;
    let text = "";

    if (msgtype === "text") {
      text = data.text?.content?.trim() ?? "";
    } else if (msgtype === "richText") {
      const parts = data.content?.richText ?? [];
      text = parts.map((p) => p.text ?? "").join("").trim();
    } else {
      return null; // Skip unsupported message types for now
    }
    if (!text) return null;

    const isGroup = data.conversationType === "2";
    const chatId = isGroup
      ? `dingtalk:group:${data.conversationId ?? ""}`
      : `dingtalk:c2c:${data.senderId ?? ""}`;

    return {
      messageId: data.msgId ?? `${data.senderId}:${Date.now()}`,
      chatId,
      userId: data.senderId ?? "",
      text,
      chatType: isGroup ? "group" : "private",
      isMentioned: true, // Webhook only fires when bot is mentioned
    };
  }

  private async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.token.accessToken;
    }
    const url = `${TOKEN_URL}?appkey=${this.config.client_id}&appsecret=${this.config.client_secret}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`DingTalk token fetch failed: ${res.status}`);
    const data = await res.json() as { access_token?: string; expires_in?: number; errcode?: number };
    if (!data.access_token) throw new Error(`DingTalk token error: ${data.errcode}`);
    this.token = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
    };
    return this.token.accessToken;
  }
}

/**
 * Convert standard markdown to DingTalk-compatible markdown.
 * DingTalk differences:
 * - No strikethrough (~~text~~)
 * - Tables need a blank line before the separator row (|---|)
 * - Code blocks: no language hint support
 * - Bold, italic, links, lists: standard markdown works
 */
function markdownToDingTalk(md: string): string {
  let out = md;

  // Remove strikethrough (not supported) — keep inner text
  out = out.replace(/~~(.+?)~~/g, "$1");

  // Remove language hints from code blocks (not supported)
  out = out.replace(/```(\w+)\n/g, "```\n");

  // Add blank line before table separator row if missing
  // DingTalk requires: header row, blank line, separator row, data rows
  out = out.replace(/((?:^\|.+\|[ \t]*\n)+)(\|[ \t]*[-:]+[-| :]*\n)/gm, "$1\n$2");

  return out;
}

export type DingTalkCallback = {
  msgtype?: string;
  msgId?: string;
  conversationId?: string;
  conversationType?: string; // "1" = C2C, "2" = group
  senderId?: string;
  senderNick?: string;
  senderStaffId?: string;
  sessionWebhook?: string;
  robotCode?: string;
  text?: { content?: string };
  content?: {
    richText?: Array<{ text?: string }>;
  };
  isInAtList?: boolean;
};
