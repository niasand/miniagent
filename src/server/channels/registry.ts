import type { SqliteDatabase } from "../db/migrate.js";
import { ChannelConfigStore } from "../stores/channel-config-store.js";
import type { ChannelAdapter, ChannelMessage } from "./types.js";
import { FeishuChannel } from "./feishu.js";
import { TelegramChannel } from "./telegram.js";
import { DiscordChannel } from "./discord.js";
import { QQChannel } from "./qq.js";

export class ChannelRegistry {
  private adapters = new Map<string, ChannelAdapter>();

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
        await adapter.start((msg) => this.onMessage(ch.channelId, msg));
        console.log(`[Channel] ${ch.channelId} started`);
      } catch (err) {
        console.error(`[Channel] ${ch.channelId} failed to start:`, err instanceof Error ? err.message : err);
      }
    }
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
      default: return null;
    }
  }
}
