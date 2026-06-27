import type { NodeHandler } from "./types.js";

/** Trivial node that succeeds immediately, emitting its message as output. Validates DAG wiring. */
export const echoHandler: NodeHandler = {
  execute(ctx) {
    ctx.emit("wf.node_succeeded", {
      nodeId: ctx.node.id,
      output: { message: ctx.node.message ?? "" },
    });
  },
};
