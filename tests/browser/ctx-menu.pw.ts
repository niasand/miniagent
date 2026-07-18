import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:7273";

async function createSession(): Promise<string> {
  const res = await fetch(`${API}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentType: "claude", workspacePath: process.cwd() }),
  });
  return (await res.json()).sessionId;
}

async function openWithSession(page: Page, id: string) {
  await page.addInitScript((sid) => localStorage.setItem("sessionId", sid), id);
  await page.goto("/");
}

test("right-click a session row reveals the context menu with a delete action", async ({ page }) => {
  const id = await createSession();
  await openWithSession(page, id);

  const item = page.locator(".session-item").first();
  await expect(item).toBeVisible({ timeout: 12_000 });
  await item.click({ button: "right" });

  const menu = page.locator(".ctx-menu");
  await expect(menu).toBeVisible({ timeout: 3_000 });
  await expect(menu.locator(".ctx-menu-item")).toHaveText("删除");

  // Clicking elsewhere dismisses it.
  await page.locator("body").click();
  await expect(menu).toHaveCount(0);
});
