import { serve } from "@hono/node-server";
import { migrate, openDatabase } from "../db/migrate.js";
import { startProjectorLoop } from "../events/projector-runner.js";
import { createApp } from "./app.js";
import { QQGatewayService } from "../channels/qq-gateway-service.js";
import { TelegramGatewayService } from "../channels/telegram-gateway-service.js";
import { DiscordGatewayService } from "../channels/discord-gateway-service.js";
import { FeishuGatewayService } from "../channels/feishu-gateway-service.js";
import { WorkspacePolicy } from "../security/workspace-policy.js";
import { RuntimeAdapterRegistry } from "../runtime/registry.js";
import { RuntimeSupervisor } from "../runtime/runtime-supervisor.js";
import { EventStore } from "../events/event-store.js";
import { SessionStore } from "../sessions/session-store.js";
import { PermissionRequestStore } from "../runtime/permission-request-store.js";

const port = Number(process.env.MINIAGENT_API_PORT ?? 7273);
const db = openDatabase();
migrate(db);
startProjectorLoop(db, {
  onError: (error) => {
    console.error("Projector loop failed", error);
  },
});

const workspacePolicy = new WorkspacePolicy([process.cwd()]);
const runtimeRegistry = new RuntimeAdapterRegistry();
const eventStore = new EventStore(db);
const sessionStore = new SessionStore(db, eventStore);
const permissionRequests = new PermissionRequestStore(db);
const runtimeSupervisor = new RuntimeSupervisor({
  adapterRegistry: runtimeRegistry,
  eventStore,
  sessionStore,
  permissionRequestStore: permissionRequests,
});

const app = createApp(db, { workspacePolicy, runtimeRegistry, runtimeSupervisor });

// Channel gateways run as background services alongside HTTP
const qqGateway = new QQGatewayService(db, workspacePolicy, runtimeSupervisor);
qqGateway.start();

const telegramGateway = new TelegramGatewayService(db, workspacePolicy, runtimeSupervisor);
telegramGateway.start();

const discordGateway = new DiscordGatewayService(db, workspacePolicy, runtimeSupervisor);
discordGateway.start();

const feishuGateway = new FeishuGatewayService(db, workspacePolicy, runtimeSupervisor);
feishuGateway.start();

serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port,
});

console.log(`MiniAgent API listening on http://127.0.0.1:${port}`);
