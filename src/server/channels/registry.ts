import type { SqliteDatabase } from "../db/migrate.js";
import { ChannelConfigStore } from "../stores/channel-config-store.js";
import type { ChannelAdapter, ChannelMessage } from "./types.js";
import { FeishuChannel } from "./feishu.js";
import { TelegramChannel } from "./telegram.js";
import { DiscordChannel } from "./discord.js";
import { QQChannel } from "./qq.js";
import { WeChatChannel } from "./wechat.js";
import { WeComChannel } from "./wecom.js";
import { DingTalkChannel } from "./dingtalk.js";

const DEDUP_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEDUP_MAX_SIZE = 1000;

export class ChannelRegistry {
  private adapters = new Map<string, ChannelAdapter>();
  private dedupCache = new Map<string, number>(); // messageId → timestamp

  constructor(
    private readonly db: SqliteDatabase,
    private readonly onMessage: (channelType: string, msg: ChannelMessage) => void,
  ) {}

  async startAll(): Promise<void> {
    const configStore = new ChannelConfigStore(this.db);
    const channels = configStore.listChannels();

    for (const ch of channels) {
      if (ch.channelId === "web") continue; // web uses SSE, no adapter
      if (!ch.configured) continue;

      const adapter = this.createAdapter(ch.channelId, ch.config);
      if (!adapter) continue;

      this.adapters.set(ch.channelId, adapter);
      try {
        await adapter.start((msg) => this.handleChannelMessage(ch.channelId, msg));
        console.log(`[Channel] ${ch.channelId} started`);
      } catch (err) {
        console.error(`[Channel] ${ch.channelId} failed to start:`, err instanceof Error ? err.message : err);
      }
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
