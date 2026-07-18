import { Hono } from "hono";
import type { WorkflowOrchestrator } from "./orchestrator.js";
import type { WorkflowDefinition } from "./definition.js";
import { generateWorkflow } from "./generate.js";

/**
 * HTTP surface for the workflow engine. Web frontend subscribes to wf.* events via the
 * existing /api/events/stream (filtering by the workflow's sessionId) and calls resolve here.
 * Auth matches the rest of the API: none, relying on network isolation (TODO).
 */
export function createWorkflowRoutes(orchestrator: WorkflowOrchestrator): Hono {
  const app = new Hono();

  app.post("/generate", async (c) => {
    const body = await c.req.json().catch(() => null) as { prompt?: string } | null;
    if (!body?.prompt?.trim()) return c.json({ error: "prompt required" }, 400);
    try {
      const definition = await generateWorkflow(body.prompt);
      return c.json({ definition }, 200);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "generate failed" }, 500);
    }
  });

  app.post("/runs", async (c) => {
    const body = await c.req.json().catch(() => null) as { definition?: WorkflowDefinition; input?: unknown } | null;
    if (!body?.definition) return c.json({ error: "definition required" }, 400);
    try {
      const { runId, sessionId } = orchestrator.startRun({
        definition: body.definition,
        input: body.input as never,
      });
      return c.json({ runId, sessionId }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "start failed" }, 400);
    }
  });

  app.get("/runs", (c) => {
    return c.json({ runs: orchestrator.listRuns() });
  });

  app.post("/runs/batch-delete", async (c) => {
    const body = await c.req.json().catch(() => null) as { runIds?: string[] } | null;
    if (!Array.isArray(body?.runIds)) return c.json({ error: "runIds required" }, 400);
    const deleted: string[] = [];
    for (const id of body.runIds) {
      if (orchestrator.getRun(id)) {
        orchestrator.deleteRun(id);
        deleted.push(id);
      }
    }
    return c.json({ deleted, count: deleted.length }, 200);
  });

  app.get("/runs/:runId", (c) => {
    const run = orchestrator.getRun(c.req.param("runId"));
    if (!run) return c.json({ error: "not found" }, 404);
    return c.json({ run });
  });

  app.post("/runs/:runId/gates/:nodeId/resolve", async (c) => {
    const runId = c.req.param("runId");
    const nodeId = c.req.param("nodeId");
    const body = await c.req.json().catch(() => ({})) as { decision?: string; note?: string; resolvedBy?: string };
    if (body.decision !== "approve" && body.decision !== "reject") {
      return c.json({ error: "decision must be 'approve' or 'reject'" }, 400);
    }
    try {
      orchestrator.resolveGate({
        runId,
        nodeId,
        decision: body.decision,
        note: body.note,
        resolvedBy: body.resolvedBy,
      });
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "resolve failed" }, 400);
    }
  });

  return app;
}
