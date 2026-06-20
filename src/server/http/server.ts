import { serve } from "@hono/node-server";
import { migrate, openDatabase } from "../db/migrate.js";
import { createApp } from "./app.js";
import { initFileLogging } from "../log.js";
import { WorkspacePolicy } from "../security/workspace-policy.js";
import { RuntimeAdapterRegistry } from "../runtime/registry.js";
import { RuntimeSupervisor } from "../runtime/supervisor.js";
import { ChannelRegistry } from "../channels/registry.js";
import { RuntimeService } from "../runtime/service.js";
import { DeliveryWorker } from "../services/delivery.js";
import { InboundService } from "../services/inbound.js";
import { SchedulerService } from "../services/scheduler.js";
import { OutboxStore } from "../stores/outbox-store.js";
import { SessionStore } from "../stores/session-store.js";
import { EventStore } from "../stores/event-store.js";

const port = Number(process.env.MINIAGENT_API_PORT ?? 7273);
initFileLogging(process.cwd());

const db = openDatabase();
migrate(db);

// Recover zombie runs left by the previous API instance (process crash / restart)
new SessionStore(db, new EventStore(db)).recoverZombieRuns();

const workspacePolicy = new WorkspacePolicy([process.cwd()]);
const runtimeRegistry = new RuntimeAdapterRegistry();
const outboxStore = new OutboxStore(db);

const runtimeSupervisor = new RuntimeSupervisor({
  db,
  adapterRegistry: runtimeRegistry,
  outboxStore,
});

const runtimeService = new RuntimeService(db, runtimeSupervisor, workspacePolicy);

// Channel registry — connects to external messaging platforms
const channelRegistry = new ChannelRegistry(db, (channelType, msg) => {
  try {
    const inbound = new InboundService(db, channelType, { workspacePolicy });
    const result = inbound.receiveMessage(msg);
    if (result.taskId) {
      // React 👀 to user message to indicate processing
      if (result.action === "message" && msg.providerMessageId && result.session.channelRef) {
        const adapter = channelRegistry.get(channelType);
        if (adapter?.react) {
          adapter.react(result.session.channelRef, msg.providerMessageId, "👀").catch((err) => {
            console.error(`[${channelType}] Reaction 👀 failed:`, err instanceof Error ? err.message : err);
          });
        }
      }
      try { runtimeService.startNextQueuedTask(result.session.id); } catch { /* already active */ }
    }
  } catch (err) {
    console.error(`[${channelType}] Message handling failed:`, err);
  }
});

channelRegistry.startAll().catch((err) => {
  console.error("[Channel] Failed to start channels:", err);
});

// Delivery worker — sends outbox items every 2s
const deliveryWorker = new DeliveryWorker(
  db,
  (channelType) => channelRegistry.get(channelType),
  runtimeService,
);

const deliveryTimer = setInterval(() => {
  deliveryWorker.tick("delivery-worker").catch((err) => {
    console.error("[Delivery] tick failed:", err);
  });
}, 2000);

const schedulerTimer = setInterval(() => {
  try {
    const schedulerService = new SchedulerService(db, runtimeService);
    schedulerService.runDue();
  } catch (err) {
    console.error("[Scheduler] tick failed:", err);
  }
}, 30_000);

const app = createApp(db, {
  workspacePolicy,
  runtimeRegistry,
  runtimeSupervisor,
  channelRegistry,
});

const server = serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port,
});

console.log(`MiniAgent API listening on http://127.0.0.1:${port}`);

// Graceful shutdown: pm2 stop/restart and Ctrl-C send SIGTERM/SIGINT.
// Stop channels (incl. retry timer), clear worker timers, close HTTP + DB.
let shuttingDown = false;
function gracefulShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Server] ${signal} received, shutting down gracefully...`);
  clearInterval(deliveryTimer);
  clearInterval(schedulerTimer);
  channelRegistry.stopAll();
  server.close(() => {
    try { db.close(); } catch { /* ignore */ }
    console.log("[Server] Channels stopped, HTTP closed. Bye.");
    process.exit(0);
  });
  // Hard exit if graceful close stalls (e.g. lingering keep-alive sockets)
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
