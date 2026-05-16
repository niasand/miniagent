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
      } catch (err) {
        this.outbox.markFailed(item.id, err instanceof Error ? err.message : String(err));
      }
    }
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
