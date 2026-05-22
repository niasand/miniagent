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
  await expect.poll(() => messages.evaluate((el) => el.scrollTop), { timeout: 5_000 }).toBeLessThan(20);

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

test("composer input stays in the workspace detail pane and grows for multiline input", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  await mockWorkspaceApis(page, createScrollableSnapshot());

  await page.goto("/");

  const detailPane = page.locator(".detail-pane--workspace");
  const input = page.locator(".chat-input");

  await expect(detailPane).toBeVisible();
  await expect(input).toBeVisible();

  const detailBox = await detailPane.boundingBox();
  const inputBox = await input.boundingBox();
  expect(detailBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  expect(inputBox!.y).toBeGreaterThan(detailBox!.y);

  const initialHeight = inputBox!.height;
  await input.fill("first line\nsecond line\nthird line\nfourth line");

  await expect(input).toHaveValue("first line\nsecond line\nthird line\nfourth line");
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
  const search = page.getByPlaceholder("Search history...");
  await expect(search).toBeFocused();

  const title = page.locator(".session-title").first();
  await expect(title).toHaveText(longName);
  await expect(page.locator(".context-list")).not.toContainText("Claude session");
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
  await page.getByRole("button", { name: "Rename Browser scroll regression" }).click();

  const input = page.locator(".session-name-input");
  await input.fill("Broken name");
  await input.press("Enter");

  await expect(page.locator(".session-edit-error")).toHaveText("Cannot rename session");
  await expect(input).toHaveAttribute("aria-invalid", "true");
});

test("settings separates channel and provider details", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  await mockWorkspaceApis(page, createScrollableSnapshot());

  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.locator(".side-pane").getByRole("button", { name: /消息通道/ })).toBeVisible();
  await expect(page.locator(".side-pane").getByRole("button", { name: /Provider/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "消息通道详情" })).toBeVisible();

  await page.locator(".side-pane").getByRole("button", { name: /Provider/ }).click();
  await expect(page.getByRole("heading", { name: "Provider 详情" })).toBeVisible();
  await expect(page.locator(".detail-pane").getByRole("button", { name: "Provider" })).toContainText("Claude");
});

test("tasks section creates, opens, and pauses a scheduled message", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  const schedules: Array<Record<string, unknown>> = [];
  await page.route((url) => url.pathname === "/api/schedules" || url.pathname.startsWith("/api/schedules/"), async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname === "/api/schedules/preview") {
      await route.fulfill({ json: { nextRunAt: "2026-05-19T09:00:00.000+08:00", timezone: route.request().postDataJSON().timezone } });
      return;
    }
    if (route.request().method() === "GET" && url.pathname === "/api/schedules/sch_test/runs") {
      await route.fulfill({ json: { runs: [{
        id: "shr_test",
        scheduleId: "sch_test",
        sessionId,
        taskId: "tsk_test",
        runId: "run_test",
        scheduledFor: "2026-05-19T09:00:00.000+08:00",
        payloadSummary: "Send a scheduled summary",
        status: "succeeded",
        error: null,
        createdAt: "2026-05-19T09:00:01.000+08:00",
      }] } });
      return;
    }
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { schedules } });
      return;
    }
    if (route.request().method() === "POST" && url.pathname === "/api/schedules") {
      const body = route.request().postDataJSON() as { sessionId: string; kind: string; runAt?: string; cronExpr?: string; timezone?: string };
      schedules.push({
        id: "sch_test",
        sessionId: body.sessionId,
        status: "active",
        kind: body.kind,
        cronExpr: body.cronExpr ?? null,
        runAt: body.runAt ?? null,
        timezone: body.timezone ?? "Asia/Shanghai",
        payloadText: "Send a scheduled summary",
        payloadSummary: "Send a scheduled summary",
        nextRunAt: "2026-05-19T02:00:00.000Z",
        lastRunAt: null,
      });
      await route.fulfill({ status: 201, json: { schedule: schedules[0] } });
      return;
    }
    if (route.request().method() === "PATCH" && url.pathname === "/api/schedules/sch_test") {
      const body = route.request().postDataJSON() as { kind: string; cronExpr?: string; timezone?: string; payload?: { text?: string } };
      schedules[0] = {
        ...schedules[0],
        kind: body.kind,
        cronExpr: body.cronExpr ?? null,
        timezone: body.timezone ?? schedules[0].timezone,
        payloadText: body.payload?.text ?? null,
        payloadSummary: body.payload?.text ?? null,
      };
      await route.fulfill({ json: { schedule: schedules[0] } });
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
  await page.getByRole("button", { name: "任务" }).click();
  await page.getByRole("button", { name: "Cron" }).click();
  await expect(page.locator(".schedule-preview")).toContainText("Next");
  await page.getByRole("button", { name: "Timezone" }).click();
  await page.getByRole("option", { name: /^UTC\b/ }).click();
  await expect(page.getByRole("button", { name: "Timezone" })).toContainText("UTC");
  await page.getByPlaceholder("Message to send...").fill("Send a scheduled summary");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.locator(".schedule-item")).toHaveCount(1);
  await expect(page.locator(".schedule-item-title .schedule-status")).toHaveText("active");
  await expect(page.locator(".schedule-item-meta")).toContainText("UTC");
  await expect(page.locator(".schedule-item-summary")).toHaveText("Send a scheduled summary");
  await expect(page.locator(".schedule-run-item")).toContainText("succeeded");
  await expect(page.locator(".schedule-run-item")).toContainText("Send a scheduled summary");
  await expect(page.getByRole("button", { name: "Open session for tsk_test" })).toBeVisible();
  await page.getByRole("button", { name: "Open task output tsk_test" }).click();
  await expect(page.locator('[data-run-id="run_test"]')).toHaveClass(/chat-bubble--focused-run/);
  await page.getByRole("button", { name: "任务" }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.locator(".schedule-edit-form .schedule-preview")).toContainText("Next");
  await page.getByLabel("Edit message").fill("Updated scheduled summary");
  await page.getByLabel("Edit cron expression").fill("15 10 * * 1-5");
  await expect(page.locator(".schedule-edit-form .schedule-preview")).toContainText("Next");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".schedule-item-title")).toContainText("15 10 * * 1-5");
  await expect(page.locator(".schedule-item-summary")).toHaveText("Updated scheduled summary");
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.locator(".schedule-item-title .schedule-status")).toHaveText("paused");
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
      runId: index === 3 ? "run_test" : null,
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
