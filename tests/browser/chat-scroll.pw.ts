import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { WorkspaceSnapshot } from "../../src/shared/workspace.js";

const sessionId = "ses_browser_scroll";

test("clicking back to top after refresh is not overridden by initial auto-scroll", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);

    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const delay = timeout === 80 ? 500 : timeout;
      return nativeSetTimeout(handler, delay, ...args);
    }) as typeof window.setTimeout;
  }, sessionId);

  await mockWorkspaceApis(page, createScrollableSnapshot());

  await page.goto("/");

  const messages = page.locator(".chat-messages");
  await expect.poll(() => messages.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect.poll(() => messages.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Back to top" }).click();
  await expect.poll(() => messages.evaluate((el) => el.scrollTop)).toBeLessThan(20);

  await page.waitForTimeout(650);

  const afterDelayedAutoScroll = await messages.evaluate((el) => ({
    scrollTop: el.scrollTop,
    distanceFromBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
  }));

  expect(afterDelayedAutoScroll.scrollTop).toBeLessThan(50);
  expect(afterDelayedAutoScroll.distanceFromBottom).toBeGreaterThan(200);
});

test("composer input sits below the toolbar and grows on Shift+Enter", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  await mockWorkspaceApis(page, createScrollableSnapshot());

  await page.goto("/");

  const toolbar = page.locator(".chat-bar-left");
  const input = page.locator(".chat-input");

  await expect(toolbar).toBeVisible();
  await expect(input).toBeVisible();

  const toolbarBox = await toolbar.boundingBox();
  const inputBox = await input.boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  expect(inputBox!.y).toBeGreaterThan(toolbarBox!.y + toolbarBox!.height - 1);

  const initialHeight = inputBox!.height;
  await input.click();
  await page.keyboard.type("first line");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("second line");

  await expect(input).toHaveValue("first line\nsecond line");
  await expect.poll(async () => (await input.boundingBox())?.height ?? 0).toBeGreaterThan(initialHeight + 4);
});

async function mockWorkspaceApis(page: Page, snapshot: WorkspaceSnapshot) {
  await page.route("**/api/workspace**", async (route) => {
    await route.fulfill({ json: snapshot });
  });
  await page.route("**/api/channels", async (route) => {
    await route.fulfill({ json: { channels: [] } });
  });
  await page.route("**/api/skills", async (route) => {
    await route.fulfill({ json: { skills: [] } });
  });
  await page.route("**/api/events/stream**", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "cache-control": "no-cache",
        "content-type": "text/event-stream",
      },
      body: "",
    });
  });
}

function createScrollableSnapshot(): WorkspaceSnapshot {
  const longParagraph = Array.from(
    { length: 20 },
    (_, index) => `Line ${index + 1}: refresh scroll regression coverage.`,
  ).join("\n\n");

  return {
    selectedSessionId: sessionId,
    sessions: [
      {
        id: sessionId,
        title: "Browser scroll regression",
        agentType: "claude",
        agent: "Claude",
        initials: "CL",
        workspace: "/tmp/miniagent",
        status: "idle",
      },
    ],
    messages: Array.from({ length: 18 }, (_, index) => ({
      id: `msg_${index}`,
      role: index % 2 === 0 ? "user" : "agent",
      author: index % 2 === 0 ? "You" : "Agent",
      createdAt: "2026-05-19T01:00:00.000Z",
      markdown: `Message ${index + 1}\n\n${longParagraph}`,
    })),
    runStats: { durationSeconds: null, tokensUsed: null, tokensTotal: null },
    outboxRows: [],
    keyEvents: [],
    contextBudget: {
      status: "healthy",
      tokenEstimate: 0,
      budgetTokens: 100_000,
      usagePercent: 0,
      warningPercent: 70,
      criticalPercent: 85,
      overflowPercent: 100,
      currentContextPackId: null,
      lastCompactedAt: null,
    },
    runtime: {
      activeRunId: null,
      status: "idle",
      pid: null,
      agentType: null,
      runtimeKind: null,
      startedAt: null,
    },
  };
}
