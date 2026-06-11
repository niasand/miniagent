import type { SqliteDatabase } from "../db/migrate.js";
import { SessionStore } from "../stores/session-store.js";
import { OutboxStore, type OutboxChannel } from "../stores/outbox-store.js";
import { AuditLogStore } from "../stores/audit-log-store.js";
import { EventStore } from "../stores/event-store.js";
import type { ChannelAdapter } from "../channels/types.js";

export class DeliveryWorker {
  private sessions: SessionStore;
  private outbox: OutboxStore;
  private auditLogs: AuditLogStore;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly getChannel: (channelType: string) => ChannelAdapter | null,
    private readonly runtimeService?: { startNextQueuedTask(sessionId: string): unknown },
  ) {
    const events = new EventStore(db);
    this.sessions = new SessionStore(db, events);
    this.outbox = new OutboxStore(db);
    this.auditLogs = new AuditLogStore(db);
  }

  async tick(workerId: string): Promise<void> {
    await this.deliverDue(workerId);
    this.startQueuedTasks();
  }

  private async deliverDue(workerId: string): Promise<void> {
    const items = this.outbox.claimDue({ workerId, limit: 20 });
    for (const item of items) {
      const channel = this.getChannel(item.channelType);
      if (!channel) {
        this.outbox.markFailed(item.id, `No adapter for channel: ${item.channelType}`);
        continue;
      }
      try {
        const viewModel = item.viewModel as { text?: string; content?: string };
        const text = viewModel.text ?? viewModel.content ?? JSON.stringify(item.viewModel);
        const result = await channel.send(item.targetRef, text);
        this.outbox.markSent(item.id, result.providerMessageId);
        this.auditLogs.insert({
          actorType: "system",
          action: "message_delivered",
          resourceType: "outbox",
          resourceId: item.id,
          payload: { channelType: item.channelType, targetRef: item.targetRef },
        });
        // React ✅ on the user's original message after successful delivery
        await this.reactOnOriginalMessage(channel, item.sessionId);
      } catch (err) {
        this.outbox.markFailed(item.id, err instanceof Error ? err.message : String(err));
      }
    }
  }

  /** Find the latest user message in this session and react ✅ to it */
  private async reactOnOriginalMessage(channel: ChannelAdapter, sessionId: string): Promise<void> {
    if (!channel.react) return;
    // Get session's channel_ref and latest user message's providerMessageId
    const row = this.db.prepare(
      `SELECT s.channel_ref, m.metadata_json
       FROM sessions s, messages m
       WHERE s.id = ? AND m.session_id = s.id AND m.role = 'user'
       ORDER BY m.created_at DESC LIMIT 1`
    ).get(sessionId) as { channel_ref: string | null; metadata_json: string } | undefined;
    if (!row?.channel_ref) return;
    try {
      const meta = JSON.parse(row.metadata_json) as { providerMessageId?: string };
      if (meta.providerMessageId) {
        await channel.react(row.channel_ref, meta.providerMessageId, "✅");
      }
    } catch { /* ignore parse errors */ }
  }

  private startQueuedTasks(): void {
    if (!this.runtimeService) return;
    const sessionIds = this.sessions.getSessionIdsWithQueuedTasks();
    for (const sessionId of sessionIds) {
      try {
        this.runtimeService.startNextQueuedTask(sessionId);
      } catch {
        // Already started — skip
      }
    }
  }
}
