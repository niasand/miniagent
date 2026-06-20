import type { SqliteDatabase } from "../db/migrate.js";
import { ChannelConfigStore } from "../stores/channel-config-store.js";
import type { ChannelAdapter, ChannelMessage, TestResult } from "./types.js";
import { FeishuChannel } from "./feishu.js";
import { TelegramChannel } from "./telegram.js";
import { DiscordChannel } from "./discord.js";
import { QQChannel } from "./qq.js";
import { WeChatChannel } from "./wechat.js";
import { WeComChannel } from "./wecom.js";
import { DingTalkChannel } from "./dingtalk.js";

const DEDUP_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEDUP_MAX_SIZE = 1000;
const RETRY_INTERVAL_MS = 60_000; // retry failed channel startups every minute

export type StartChannelResult = { ok: boolean; message: string };

export class ChannelRegistry {
  private adapters = new Map<string, ChannelAdapter>();
  private dedupCache = new Map<string, number>(); // messageId → timestamp
  private failedChannels = new Map<string, Record<string, string>>(); // channelId → config (startup failed, pending retry)
  private retryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly onMessage: (channelType: string, msg: ChannelMessage) => void,
    private readonly retryIntervalMs: number = RETRY_INTERVAL_MS,
  ) {}

  async startAll(): Promise<void> {
    const configStore = new ChannelConfigStore(this.db);
    const channels = configStore.listChannels();

    for (const ch of channels) {
      if (ch.channelId === "web") continue; // web uses SSE, no adapter
      if (!ch.configured) continue;

      const result = await this.startChannel(ch.channelId, ch.config);
      if (!result.ok) {
        console.error(`[Channel] ${ch.channelId} failed to start:`, result.message);
        this.failedChannels.set(ch.channelId, ch.config);
      }
    }
    this.scheduleRetry();
  }

  /** Schedule a background timer to retry channels that failed during startAll. */
  private scheduleRetry(): void {
    if (this.retryTimer || this.failedChannels.size === 0) return;
    this.retryTimer = setInterval(() => { void this.retryFailed(); }, this.retryIntervalMs);
    console.log(`[Channel] Will retry ${this.failedChannels.size} failed channel(s) every ${this.retryIntervalMs}ms`);
  }

  /** Retry every failed channel; drop the timer once all recover. */
  private async retryFailed(): Promise<void> {
    for (const [channelId, config] of [...this.failedChannels]) {
      const result = await this.startChannel(channelId, config);
      if (result.ok) {
        this.failedChannels.delete(channelId);
        console.log(`[Channel] ${channelId} recovered on retry`);
      }
      // Stay silent on continued failure — startAll already logged the cause.
    }
    if (this.failedChannels.size === 0 && this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
      console.log("[Channel] All channels running, retry timer stopped");
    }
  }

  private handleChannelMessage(channelType: string, msg: ChannelMessage): void {
    const dedupKey = `${channelType}:${msg.messageId}`;
    const now = Date.now();

    // Evict stale entries if cache is full
    if (this.dedupCache.size >= DEDUP_MAX_SIZE) {
      for (const [key, ts] of this.dedupCache) {
        if (now - ts > DEDUP_TTL_MS) this.dedupCache.delete(key);
      }
      // If still full after eviction, clear oldest half
      if (this.dedupCache.size >= DEDUP_MAX_SIZE) {
        const entries = [...this.dedupCache.entries()].sort((a, b) => a[1] - b[1]);
        for (let i = 0; i < entries.length / 2; i++) this.dedupCache.delete(entries[i][0]);
      }
    }

    // Skip duplicate
    if (this.dedupCache.has(dedupKey)) {
      console.log(`[Channel] Dedup: skipping duplicate message ${dedupKey}`);
      return;
    }

    this.dedupCache.set(dedupKey, now);
    this.onMessage(channelType, msg);
  }

  stopAll(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    for (const [name, adapter] of this.adapters) {
      try {
        adapter.stop();
        console.log(`[Channel] ${name} stopped`);
      } catch { /* ignore */ }
    }
    this.adapters.clear();
  }

  get(channelType: string): ChannelAdapter | null {
    return this.adapters.get(channelType) ?? null;
  }

  async startChannel(channelId: string, config: Record<string, string>): Promise<StartChannelResult> {
    const adapter = this.createAdapter(channelId, config);
    if (!adapter) return { ok: false, message: `Unknown channel: ${channelId}` };

    if (adapter.test) {
      const testResult = await adapter.test();
      if (!testResult.ok) return testResult;
    }

    try {
      await adapter.start((msg) => this.handleChannelMessage(channelId, msg));
      const existing = this.adapters.get(channelId);
      if (existing) {
        try { existing.stop(); } catch { /* ignore */ }
      }
      this.adapters.set(channelId, adapter);
      console.log(`[Channel] ${channelId} started`);
      return { ok: true, message: "Started" };
    } catch (err) {
      try { adapter.stop(); } catch { /* ignore */ }
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Channel] ${channelId} failed to start:`, message);
      return { ok: false, message };
    }
  }

  async testChannel(channelId: string): Promise<TestResult> {
    const configStore = new ChannelConfigStore(this.db);
    const config = configStore.get(channelId);
    const adapter = this.createAdapter(channelId, config);
    if (!adapter) return { ok: false, message: `Unknown channel: ${channelId}` };
    if (!adapter.test) return { ok: false, message: "Test not supported for this channel" };
    return adapter.test();
  }

  private createAdapter(channelId: string, config: Record<string, string>): ChannelAdapter | null {
    switch (channelId) {
      case "feishu": return new FeishuChannel(config);
      case "telegram": return new TelegramChannel(config);
      case "discord": return new DiscordChannel(config);
      case "qq": return new QQChannel(config);
      case "wechat": return new WeChatChannel(config);
      case "wecom": return new WeComChannel(config);
      case "dingtalk": return new DingTalkChannel(config);
      default: return null;
    }
  }
}
