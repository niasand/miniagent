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
  await expect.poll(() => messages.evaluate((el) => el.scrollHeight > el.clientHeight), { timeout: 5_000 }).toBe(true);
  await expect.poll(() => messages.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => distanceFromBottom(messages)).toBeLessThanOrEqual(1);
  await expect(messages).not.toHaveClass(/chat-messages--settling/);

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

test("refresh keeps the scrollbar pinned through late content growth", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  await mockWorkspaceApis(page, createScrollableSnapshot());

  await page.goto("/");

  const messages = page.locator(".chat-messages");
  await expect.poll(() => messages.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect.poll(() => distanceFromBottom(messages)).toBeLessThanOrEqual(1);

  await page.waitForTimeout(120);
  await messages.evaluate((el) => {
    const lateContent = document.createElement("div");
    lateContent.style.height = "240px";
    lateContent.dataset.testid = "late-content";
    el.append(lateContent);
  });

  await expect.poll(() => distanceFromBottom(messages)).toBeLessThanOrEqual(1);
});

test("reload ignores the browser-restored message scroll position", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  await mockWorkspaceApis(page, createScrollableSnapshot());

  await page.goto("/");

  const messages = page.locator(".chat-messages");
  await expect.poll(() => messages.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect.poll(() => distanceFromBottom(messages)).toBeLessThanOrEqual(1);
  await expect(messages).not.toHaveClass(/chat-messages--settling/);

  await messages.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect.poll(() => messages.evaluate((el) => el.scrollTop)).toBeLessThan(20);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(() => messages.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect.poll(() => distanceFromBottom(messages)).toBeLessThanOrEqual(1);
});

test("initial load corrects non-user scroll restoration during settling", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  await mockWorkspaceApis(page, createScrollableSnapshot());

  await page.goto("/");

  const messages = page.locator(".chat-messages");
  await expect.poll(() => messages.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect.poll(() => distanceFromBottom(messages)).toBeLessThanOrEqual(1);

  await page.waitForTimeout(120);
  await expect(messages).toHaveClass(/chat-messages--settling/);
  await messages.evaluate((el) => {
    el.scrollTop = 0;
  });

  await expect.poll(() => distanceFromBottom(messages)).toBeLessThanOrEqual(1);
  await expect(messages).not.toHaveClass(/chat-messages--settling/);
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

test("history shows the session name and truncates long labels", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  const longName = "Please summarize this repository and identify the next three highest impact implementation tasks";
  const snapshot = createScrollableSnapshot();
  snapshot.sessions[0].name = longName;
  snapshot.sessions[0].title = "Claude session";
  snapshot.sessions.push({
    ...snapshot.sessions[0],
    id: "ses_other",
    name: "Deploy checklist",
    title: "Deploy checklist",
  });
  await mockWorkspaceApis(page, snapshot);

  await page.goto("/");
  await page.locator(".chat-bar").getByRole("button", { name: "History" }).click();
  const search = page.getByPlaceholder("Search history...");
  await expect(search).toBeFocused();

  const title = page.locator(".session-title").first();
  await expect(title).toHaveText(longName);
  await expect(page.locator(".drawer-list")).not.toContainText("Claude session");
  await expect(page.locator(".session-meta").first()).toContainText("Web");
  await expect.poll(() => page.locator(".session-meta").first().textContent()).not.toBe("Web");
  await expect.poll(() => title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

  await search.fill("next three");
  await expect(page.locator(".session-item")).toHaveCount(1);
  await expect(title).toHaveText(longName);
  await expect(page.locator(".session-highlight")).toHaveText("next three");
});

test("history renames sessions inline", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  const snapshot = createScrollableSnapshot();
  await page.route(`**/api/sessions/${sessionId}`, async (route) => {
    const body = route.request().postDataJSON() as { name?: string };
    snapshot.sessions[0].name = body.name ?? snapshot.sessions[0].name;
    await route.fulfill({ json: { sessionId, workspace: snapshot } });
  });
  await mockWorkspaceApis(page, snapshot);

  await page.goto("/");
  await page.locator(".chat-bar").getByRole("button", { name: "History" }).click();
  await page.getByRole("button", { name: "Rename Browser scroll regression" }).click();

  const input = page.locator(".session-name-input");
  await expect(input).toBeFocused();
  await input.fill("Renamed session");
  await input.press("Enter");

  await expect(page.locator(".session-title")).toHaveText("Renamed session");
});

test("history shows rename errors inline", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  const snapshot = createScrollableSnapshot();
  await page.route(`**/api/sessions/${sessionId}`, async (route) => {
    await route.fulfill({ status: 500, json: { error: "Cannot rename session" } });
  });
  await mockWorkspaceApis(page, snapshot);

  await page.goto("/");
  await page.locator(".chat-bar").getByRole("button", { name: "History" }).click();
  await page.getByRole("button", { name: "Rename Browser scroll regression" }).click();

  const input = page.locator(".session-name-input");
  await input.fill("Broken name");
  await input.press("Enter");

  await expect(page.locator(".session-edit-error")).toHaveText("Cannot rename session");
  await expect(input).toHaveAttribute("aria-invalid", "true");
});

test("schedules drawer creates and pauses a scheduled message", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  const schedules: Array<Record<string, unknown>> = [];
  await page.route((url) => url.pathname === "/api/schedules" || url.pathname.startsWith("/api/schedules/"), async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { schedules } });
      return;
    }
    if (route.request().method() === "POST" && url.pathname === "/api/schedules") {
      const body = route.request().postDataJSON() as { sessionId: string; kind: string; runAt?: string; cronExpr?: string };
      schedules.push({
        id: "sch_test",
        sessionId: body.sessionId,
        status: "active",
        kind: body.kind,
        cronExpr: body.cronExpr ?? null,
        runAt: body.runAt ?? null,
        timezone: "Asia/Shanghai",
        nextRunAt: "2026-05-19T02:00:00.000Z",
        lastRunAt: null,
      });
      await route.fulfill({ status: 201, json: { schedule: schedules[0] } });
      return;
    }
    if (route.request().method() === "POST" && url.pathname === "/api/schedules/sch_test/pause") {
      schedules[0].status = "paused";
      await route.fulfill({ json: { schedule: schedules[0] } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await mockWorkspaceApis(page, createScrollableSnapshot());

  await page.goto("/");
  await page.locator(".chat-bar").getByRole("button", { name: "Schedules" }).click();
  await page.getByPlaceholder("Message to send...").fill("Send a scheduled summary");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.locator(".schedule-item")).toHaveCount(1);
  await expect(page.locator(".schedule-status")).toHaveText("active");
  await page.getByRole("button", { name: "Pause schedule" }).click();
  await expect(page.locator(".schedule-status")).toHaveText("paused");
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

function distanceFromBottom(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
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
        name: "Browser scroll regression",
        title: "Browser scroll regression",
        agentType: "claude",
        agent: "Claude",
        initials: "CL",
        workspace: "/tmp/miniagent",
        channelType: "web",
        status: "idle",
        updatedAt: "2026-05-19T01:00:00.000Z",
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
