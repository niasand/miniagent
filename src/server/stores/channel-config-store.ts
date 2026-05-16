import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";

export type ChannelConfig = Record<string, string>;

export type ChannelInfo = {
  channelId: string;
  label: string;
  configured: boolean;
  config: ChannelConfig;
};

const KNOWN_CHANNELS: Array<{ id: string; label: string; configKeys: string[] }> = [
  { id: "feishu", label: "Feishu", configKeys: ["app_id", "app_secret"] },
  { id: "qq", label: "QQ", configKeys: ["app_id", "app_secret"] },
  { id: "telegram", label: "Telegram", configKeys: ["bot_token"] },
  { id: "discord", label: "Discord", configKeys: ["bot_token", "application_id"] },
  { id: "wechat", label: "WeChat", configKeys: ["bot_token"] },
  { id: "wecom", label: "WeCom", configKeys: ["bot_id", "secret"] },
  { id: "dingtalk", label: "DingTalk", configKeys: ["client_id", "client_secret"] },
];

export class ChannelConfigStore {
  constructor(private readonly db: SqliteDatabase) {}

  get(channelId: string): ChannelConfig {
    const rows = this.db.prepare("SELECT key, value FROM channel_configs WHERE channel_id = ?").all(channelId) as Array<{ key: string; value: string }>;
    const config: ChannelConfig = {};
    for (const row of rows) config[row.key] = row.value;
    return config;
  }

  set(channelId: string, config: ChannelConfig): ChannelConfig {
    const now = nowIso();
    const upsert = this.db.prepare(
      `INSERT INTO channel_configs (id, channel_id, key, value, updated_at)
       VALUES (@id, @channelId, @key, @value, @updatedAt)
       ON CONFLICT (channel_id, key) DO UPDATE SET value = @value, updated_at = @updatedAt`
    );
    const tx = this.db.transaction(() => {
      for (const [key, value] of Object.entries(config)) {
        upsert.run({ id: createId("cnf"), channelId, key, value, updatedAt: now });
      }
    });
    tx();
    return this.get(channelId);
  }

  listChannels(): ChannelInfo[] {
    const channels: ChannelInfo[] = [{ channelId: "web", label: "Web", configured: true, config: {} }];
    for (const ch of KNOWN_CHANNELS) {
      const config = this.get(ch.id);
      const configured = ch.configKeys.every((k) => config[k]?.trim());
      channels.push({ channelId: ch.id, label: ch.label, configured, config });
    }
    return channels;
  }
}
