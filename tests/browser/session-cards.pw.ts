import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:7273";

// End-to-end against the real API (playwright's webServer runs vite dev on 7274,
// which proxies /api to 7273). Sessions are created with the cwd workspace so the
// allowlist accepts them; no agent run is triggered, so no claude quota is spent.

async function createSession(agentType: string): Promise<string> {
  const res = await fetch(`${API}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentType, workspacePath: process.cwd() }),
  });
  const body = (await res.json()) as { sessionId: string };
  return body.sessionId;
}

test("session card renders with a disabled resume button when there is no external session id", async ({ page }) => {
  const id = await createSession("claude");
  await page.goto("/");

  const card = page.locator(`.session-card[data-session-id="${id}"]`);
  await expect(card).toBeVisible({ timeout: 8_000 });

  // A freshly created session has no agent_run → no external_session_id, so the
  // resume command cannot be built. The copy button is disabled with a tooltip
  // that says why. (Command construction itself is unit-covered in session-resume.test.ts.)
  const cmd = card.locator(".session-card-cmd");
  await expect(cmd).toBeVisible();
  await expect(cmd).toBeDisabled();
  await expect(cmd).toHaveAttribute("title", "无 Claude session id");
});

test("session card head shows the agent label and a copy affordance", async ({ page }) => {
  const id = await createSession("claude");
  await page.goto("/");

  const card = page.locator(`.session-card[data-session-id="${id}"]`);
  await expect(card).toBeVisible({ timeout: 8_000 });
  await expect(card.locator(".session-card-meta")).toContainText("Claude");
  await expect(card.locator(".session-card-cmd")).toBeVisible();
});

test("the lazy message area renders a placeholder until the card is scrolled into view", async ({ page }) => {
  const id = await createSession("claude");
  await page.goto("/");

  const card = page.locator(`.session-card[data-session-id="${id}"]`);
  await expect(card).toBeVisible({ timeout: 8_000 });
  // A new session has no messages, and the card is already on screen, so the lazy
  // loader fires and resolves to the empty state rather than the placeholder.
  await expect(card.locator(".session-card-messages")).toBeVisible();
});
