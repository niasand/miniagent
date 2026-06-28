import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:7273";

// End-to-end against the real API (playwright's webserver runs vite dev on 7274,
// which proxies /api to 7273). Uses a gate-only workflow so no claude quota is spent.

async function createGateWorkflow(name: string, prompt: string): Promise<string> {
  const res = await fetch(`${API}/api/workflows/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      definition: {
        name,
        nodes: [
          { id: "a", type: "echo", message: "start" },
          { id: "g", type: "human_gate", prompt, dependsOn: ["a"] },
          { id: "b", type: "echo", message: "end", dependsOn: ["g"] },
        ],
      },
    }),
  });
  const body = (await res.json()) as { runId: string };
  return body.runId;
}

test("workflow list renders, gate card approves, run completes", async ({ page }) => {
  const runId = await createGateWorkflow("e2e-gate", "e2e: approve this gate?");

  await page.goto("/#workflows");

  // List shows the run with 待审批 badge (polls every 2s).
  await expect(page.getByText("e2e-gate").first()).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("待审批").first()).toBeVisible({ timeout: 8_000 });

  // Open the run detail.
  await page.getByText("e2e-gate").first().click();

  // Gate card renders an approve button (unique to the gate card; the prompt also
  // appears in the node list as a span, so locate by the approve button instead).
  const approveBtn = page.getByRole("button", { name: /通过/ });
  await expect(approveBtn).toBeVisible({ timeout: 5_000 });

  // Approve it.
  await approveBtn.click();

  // Status flips to 成功 (polls). Allow time for the b echo + run_completed.
  await expect(page.getByText("成功").first()).toBeVisible({ timeout: 8_000 });

  // Confirm the backend agrees.
  const runRes = await fetch(`${API}/api/workflows/runs/${runId}`);
  const runBody = (await runRes.json()) as { run: { status: string } };
  expect(runBody.run.status).toBe("succeeded");
});

test("rejecting a gate fails the run", async ({ page }) => {
  const runId = await createGateWorkflow("e2e-reject", "e2e: reject this gate?");

  await page.goto("/#workflows");
  await expect(page.getByText("e2e-reject").first()).toBeVisible({ timeout: 8_000 });
  await page.getByText("e2e-reject").first().click();

  await expect(page.getByRole("button", { name: /拒绝/ })).toBeVisible();
  await page.getByRole("button", { name: /拒绝/ }).click();

  await expect(page.getByText("失败").first()).toBeVisible({ timeout: 8_000 });

  const runRes = await fetch(`${API}/api/workflows/runs/${runId}`);
  const runBody = (await runRes.json()) as { run: { status: string } };
  expect(runBody.run.status).toBe("failed");
});
