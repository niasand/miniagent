import type { NodeHandler } from "./types.js";

/** Opens a human approval gate and waits for an external resolve (Web approve/reject). */
export const humanGateHandler: NodeHandler = {
  execute(ctx) {
    ctx.emit("wf.gate_opened", {
      nodeId: ctx.node.id,
      prompt: ctx.node.prompt ?? "Approve?",
    });
  },
};
