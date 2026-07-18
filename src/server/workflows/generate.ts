import { spawnSync } from "node:child_process";
import { validateWorkflow, type WorkflowDefinition } from "./definition.js";

/**
 * Generate a workflow definition from a natural-language description by asking
 * the claude CLI (one-shot --print). The result is validated with the same
 * `validateWorkflow` the run path uses; on illegal JSON or structural errors we
 * feed the error back to claude and retry, up to MAX_ATTEMPTS times.
 */

const MAX_ATTEMPTS = 3;
const CLAUDE_TIMEOUT_MS = 90_000;

const SYSTEM_PROMPT = `你是 MiniAgent workflow 配置生成器。根据用户的自然语言描述，生成一个 workflow JSON 定义。

只能用以下 3 种节点类型：
- echo：输出一条固定消息。字段：id, type:"echo", message:"消息内容", dependsOn:["父节点id"]（可选）
- human_gate：人工审批门，暂停等人批准/拒绝。字段：id, type:"human_gate", prompt:"给审批人看的问题", dependsOn（可选）
- agent_task：启动 CLI agent 执行任务。字段：id, type:"agent_task", agentType:"claude", prompt:"给 agent 的明确指令", dependsOn（可选）

规则：
- 每个 node 必须有唯一且简短的 id（英文，如 a/b/g/check/run/report）
- dependsOn 只能引用已经定义过的 node id，整体必须是有向无环图（DAG）
- human_gate 和 agent_task 必须有 prompt
- name 是 workflow 的名字（中文或英文，简短）

输出要求：只输出一个 JSON 对象，不要任何解释、不要 markdown 代码围栏、不要前后多余文字。格式严格为：
{"name":"...","nodes":[...]}`;

export async function generateWorkflow(userPrompt: string): Promise<WorkflowDefinition> {
  const trimmed = userPrompt.trim();
  if (!trimmed) throw new Error("描述不能为空");

  let lastError = "无有效输出";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt =
      attempt === 1
        ? `${SYSTEM_PROMPT}\n\n用户描述：${trimmed}`
        : `${SYSTEM_PROMPT}\n\n用户描述：${trimmed}\n\n你上次的输出校验失败：${lastError}\n请修正问题，重新输出一个合法的 JSON 对象。`;

    let raw: string;
    try {
      raw = runClaudeOnce(prompt);
    } catch (err) {
      // claude invocation itself failed — not a JSON issue, no point retrying.
      throw err instanceof Error ? err : new Error("claude 调用失败");
    }

    const parsed = tryParseWorkflowJson(raw);
    if (!parsed.ok) {
      lastError = parsed.error;
      continue;
    }
    const validation = validateWorkflow(parsed.value);
    if (!validation.ok) {
      lastError = validation.errors.join("; ");
      continue;
    }
    return parsed.value;
  }
  throw new Error(`生成失败（已重试 ${MAX_ATTEMPTS} 次），最后问题：${lastError}`);
}

/** Spawn claude --print with a PATH that includes common user-bin locations — the
 *  API runs under launchd whose default PATH usually omits ~/.local/bin. */
function runClaudeOnce(prompt: string): string {
  const extraPath = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    process.env.HOME ? `${process.env.HOME}/.local/bin` : "",
  ].filter(Boolean);
  const path = [...extraPath, process.env.PATH].filter(Boolean).join(":");

  const result = spawnSync("claude", ["--print", prompt], {
    cwd: process.env.HOME ?? process.cwd(),
    encoding: "utf8",
    timeout: CLAUDE_TIMEOUT_MS,
    env: { ...process.env, PATH: path },
  });

  if (result.error) {
    throw new Error(`claude 调用失败：${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`claude 退出码 ${result.status}：${(result.stderr || "").slice(0, 200)}`);
  }
  return result.stdout || "";
}

/** Extract the first {...} block (claude sometimes wraps output in markdown) and
 *  validate it has the WorkflowDefinition shape. Pure — unit-tested. */
export function tryParseWorkflowJson(raw: string):
  | { ok: true; value: WorkflowDefinition }
  | { ok: false; error: string } {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, error: "输出未包含 JSON 对象" };
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch (err) {
    return { ok: false, error: `JSON 解析失败：${err instanceof Error ? err.message : String(err)}` };
  }
  if (!obj || typeof obj !== "object") return { ok: false, error: "输出不是 JSON 对象" };
  const def = obj as Partial<WorkflowDefinition>;
  if (typeof def.name !== "string" || !def.name.trim()) {
    return { ok: false, error: "JSON 缺少 name 字段" };
  }
  if (!Array.isArray(def.nodes)) return { ok: false, error: "JSON 缺少 nodes 数组" };
  return { ok: true, value: { name: def.name, nodes: def.nodes, input: def.input } };
}
