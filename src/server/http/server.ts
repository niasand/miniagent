import { serve } from "@hono/node-server";
import { migrate, openDatabase } from "../db/migrate.js";
import { createApp } from "./app.js";
import { WorkspacePolicy } from "../security/workspace-policy.js";
import { RuntimeAdapterRegistry } from "../runtime/registry.js";
import { RuntimeSupervisor } from "../runtime/supervisor.js";
import { ChannelRegistry } from "../channels/registry.js";
import { RuntimeService } from "../runtime/service.js";
import { DeliveryWorker } from "../services/delivery.js";
import { InboundService } from "../services/inbound.js";

const port = Number(process.env.MINIAGENT_API_PORT ?? 7273);
const db = openDatabase();
migrate(db);

const workspacePolicy = new WorkspacePolicy([process.cwd()]);
const runtimeRegistry = new RuntimeAdapterRegistry();
const runtimeSupervisor = new RuntimeSupervisor({
  db,
  adapterRegistry: runtimeRegistry,
});

const runtimeService = new RuntimeService(db, runtimeSupervisor, workspacePolicy);

// Channel registry — connects to external messaging platforms
const channelRegistry = new ChannelRegistry(db, (channelType, msg) => {
  try {
    const inbound = new InboundService(db, channelType, { workspacePolicy });
    const result = inbound.receiveMessage(msg);
    if (result.action === "message" && result.taskId) {
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

const app = createApp(db, {
  workspacePolicy,
  runtimeRegistry,
  runtimeSupervisor,
  channelRegistry,
});

serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port,
});

console.log(`MiniAgent API listening on http://127.0.0.1:${port}`);
