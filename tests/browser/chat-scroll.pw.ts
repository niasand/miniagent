import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { ChannelInfo } from "../../src/client/api/channels.js";
import type { SkillMeta } from "../../src/client/api/types.js";
import type { WorkspaceSnapshot } from "../../src/shared/workspace.js";

const sessionId = "ses_browser_scroll";

test("message copy button shows copied feedback", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-write"], { origin: "http://127.0.0.1:7274" });
  await mockWorkspaceApis(page, createScrollableSnapshot());

  await page.goto("/");

  const copyButton = page.locator(".chat-bubble-copy").first();
  await expect(copyButton).toBeVisible();
  await copyButton.click();
  await expect(copyButton).toHaveAttribute("title", "已复制");
  await expect(copyButton).toHaveAttribute("data-copied", "true");
  await expect(copyButton).toHaveCSS("color", "rgb(5, 150, 105)");
});

test("header and skill copy buttons show copied feedback", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-write"], { origin: "http://127.0.0.1:7274" });
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);
  await mockWorkspaceApis(page, createScrollableSnapshot(), {
    skills: [
      {
        name: "ship-it",
        description: "Ship the current change safely.",
        source: "project",
        path: "/project/.claude/skills/ship-it",
      },
    ],
  });

  await page.goto("/");

  const sessionNameCopy = page.locator(".chat-header-copy").first();
  await expect(sessionNameCopy).toBeVisible();
  await sessionNameCopy.click();
  await expect(sessionNameCopy).toHaveAttribute("title", "已复制");
  await expect(sessionNameCopy).toHaveAttribute("data-copied", "true");
  await expect(sessionNameCopy).toHaveCSS("color", "rgb(5, 150, 105)");

  await page.getByRole("button", { name: "技能" }).click();
  const skillPathCopy = page.locator(".copy-path-btn").first();
  await expect(skillPathCopy).toBeVisible();
  await skillPathCopy.click();
  await expect(skillPathCopy).toHaveAttribute("title", "已复制");
  await expect(skillPathCopy).toHaveAttribute("data-copied", "true");
  await expect(skillPathCopy).toHaveCSS("color", "rgb(5, 150, 105)");
});

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

  await page.getByRole("button", { name: "回到顶部" }).click();
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
  const search = page.getByPlaceholder("搜索会话...");
  await expect(search).toBeFocused();
  await expect(search).toHaveCSS("border-top-width", "0px");

  const title = page.locator(".session-title").first();
  await expect(title).toHaveText(longName);
  await expect(page.locator(".context-list")).not.toContainText("Claude session");
  await expect(page.locator(".session-meta").first()).toContainText("网页");
  await expect.poll(() => page.locator(".session-meta").first().textContent()).not.toBe("网页");
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
  await page.getByRole("button", { name: "重命名 Browser scroll regression" }).click();

  const input = page.locator(".session-name-input");
  await expect(input).toBeFocused();
  await input.fill("Renamed session");
  await input.press("Enter");

  await expect(page.locator(".session-title")).toHaveText("Renamed session");
});

test("clicking a session keeps list order stable across workspace refresh", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  const snapshot = createScrollableSnapshot();
  snapshot.sessions.push({
    ...snapshot.sessions[0],
    id: "ses_second",
    name: "Second session",
    title: "Second session",
    updatedAt: "2026-05-18T01:00:00.000Z",
  });

  let workspaceCallCount = 0;
  await page.route("**/api/workspace**", async (route) => {
    workspaceCallCount += 1;
    const orderedSessions = workspaceCallCount === 1
      ? snapshot.sessions
      : [snapshot.sessions[1], snapshot.sessions[0]];
    await route.fulfill({
      json: {
        ...snapshot,
        selectedSessionId: workspaceCallCount === 1 ? sessionId : "ses_second",
        sessions: orderedSessions,
      },
    });
  });
  await page.route("**/api/channels", async (route) => {
    await route.fulfill({ json: { channels: [] } });
  });
  await page.route("**/api/skills", async (route) => {
    await route.fulfill({ json: { skills: [] } });
  });
  await page.route("**/api/agents", async (route) => {
    await route.fulfill({ json: { agents: [] } });
  });
  await page.route("**/api/agent-defaults/resolve", async (route) => {
    await route.fulfill({ status: 404, json: { error: "No default agent found" } });
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

  await page.goto("/");
  await expect(page.locator(".session-title").nth(0)).toHaveText("Browser scroll regression");
  await expect(page.locator(".session-title").nth(1)).toHaveText("Second session");

  await page.getByRole("button", { name: "Second session 网页 May 18" }).click();

  await expect(page.locator(".session-title").nth(0)).toHaveText("Browser scroll regression");
  await expect(page.locator(".session-title").nth(1)).toHaveText("Second session");
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
  await page.getByRole("button", { name: "重命名 Browser scroll regression" }).click();

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
  await expect(page.locator(".side-pane").getByRole("button", { name: /提供方/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "消息通道详情" })).toBeVisible();

  await page.locator(".side-pane").getByRole("button", { name: /提供方/ }).click();
  await expect(page.getByRole("heading", { name: "提供方详情" })).toBeVisible();
  await expect(page.locator(".detail-pane").getByRole("radiogroup", { name: "提供方" })).toBeVisible();
  await expect(page.locator(".detail-pane").getByRole("radio", { name: /Claude/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".provider-toggle-wrap").filter({ hasText: "Claude" })).toContainText("Anthropic · ACP 运行时");
  await expect(page.locator(".provider-capability-card")).toHaveCount(3);
  await expect(page.locator(".provider-capability-card").filter({ hasText: "Claude" }).locator(".provider-status-badge")).toHaveText("已就绪");
  await expect(page.locator(".provider-capability-card").filter({ hasText: "Claude" })).toContainText("文本流式输出：支持");
  await expect(page.locator(".provider-capability-card").filter({ hasText: "Claude" })).toContainText("会话导出：不支持");
  await expect(page.locator(".provider-capability-card").filter({ hasText: "Trae" })).toContainText("traecli 未在 PATH 中找到");
});

test("settings shows and binds default private notification targets", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  await mockWorkspaceApis(page, createScrollableSnapshot(), {
    latestPrivateNotificationTargets: [
      { channelType: "qq", targetRef: "c2c:user1" },
      { channelType: "telegram", targetRef: "private:42" },
    ],
  });

  await page.goto("/#settings/channels");
  await expect(page.getByRole("heading", { name: "默认通知私聊" })).toBeVisible();
  await expect(page.locator(".notification-defaults")).toContainText("定时任务默认发送到你的 QQ/Telegram 私聊。");
  await expect(page.locator(".notification-defaults")).toContainText("自动匹配");
  await expect(page.locator(".notification-target-panel").filter({ hasText: "当前目标" })).toContainText("c2c:user1");
  await page.getByRole("button", { name: "绑定最近私聊" }).click();
  await expect(page.locator(".notification-defaults")).toContainText("已绑定");
});

test("channel cards show localized status labels", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  await mockWorkspaceApis(page, createScrollableSnapshot(), {
    channels: [
      {
        id: "feishu",
        label: "Feishu",
        status: "connected",
        description: "Feishu bot is already connected.",
      },
      {
        id: "telegram",
        label: "Telegram",
        status: "available",
        description: "Configure Telegram delivery with a bot token.",
      },
      {
        id: "wechat",
        label: "WeChat",
        status: "disconnected",
        description: "WeChat bot is offline.",
      },
    ],
  });

  await page.goto("/#settings/channels");
  await expect(page.locator(".channel-card").filter({ hasText: "Feishu" }).locator(".channel-status")).toHaveText("已连接");
  await expect(page.locator(".channel-card").filter({ hasText: "Telegram" }).locator(".channel-status")).toHaveText("可配置");
  await expect(page.locator(".channel-card").filter({ hasText: "WeChat" }).locator(".channel-status")).toHaveText("离线");
});

test("workspace and skills pages show localized copy", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  await mockWorkspaceApis(page, createScrollableSnapshot(), {
    skills: [
      {
        name: "ship-it",
        description: "Ship the current change safely.",
        source: "project",
        path: "/project/.claude/skills/ship-it",
      },
    ],
  });

  await page.goto("/");

  await expect(page.getByPlaceholder("搜索会话...")).toBeVisible();
  await expect(page.getByPlaceholder("输入消息...")).toBeVisible();
  await page.getByRole("button", { name: "技能" }).click();
  await expect(page.getByPlaceholder("搜索技能...")).toBeVisible();
  await expect(page.getByRole("button", { name: "使用技能" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "说明" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "调用方式" })).toBeVisible();
});

test("settings hash survives reload and restores provider detail", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  await mockWorkspaceApis(page, createScrollableSnapshot());

  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();
  await page.locator(".side-pane").getByRole("button", { name: /提供方/ }).click();

  await expect(page).toHaveURL(/#settings\/provider$/);
  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(/#settings\/provider$/);
  await expect(page.getByRole("heading", { name: "提供方详情" })).toBeVisible();
});

test("provider selection persists across reload", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  await mockWorkspaceApis(page, createScrollableSnapshot());

  await page.goto("/#settings/provider");
  const codexOption = page.locator(".detail-pane").getByRole("radio", { name: /Codex/ });
  const claudeOption = page.locator(".detail-pane").getByRole("radio", { name: /Claude/ });
  await codexOption.click();

  await expect(codexOption).toHaveAttribute("aria-checked", "true");
  await expect(claudeOption).toHaveAttribute("aria-checked", "false");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "提供方详情" })).toBeVisible();
  await expect(page.locator(".detail-pane").getByRole("radio", { name: /Codex/ })).toHaveAttribute("aria-checked", "true");
});

test("provider selector is mutually exclusive", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  await mockWorkspaceApis(page, createScrollableSnapshot());

  await page.goto("/#settings/provider");
  const claudeOption = page.locator(".detail-pane").getByRole("radio", { name: /Claude/ });
  const codexOption = page.locator(".detail-pane").getByRole("radio", { name: /Codex/ });
  const traeOption = page.locator(".detail-pane").getByRole("radio", { name: /Trae/ });

  await expect(claudeOption).toHaveAttribute("aria-checked", "true");
  await expect(codexOption).toHaveAttribute("aria-checked", "false");
  await expect(traeOption).toHaveAttribute("aria-checked", "false");

  await codexOption.click();

  await expect(claudeOption).toHaveAttribute("aria-checked", "false");
  await expect(codexOption).toHaveAttribute("aria-checked", "true");
  await expect(traeOption).toHaveAttribute("aria-checked", "false");
});

test("provider selector disables unavailable runtimes with a reason", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  await mockWorkspaceApis(page, createScrollableSnapshot());

  await page.goto("/#settings/provider");
  const traeOption = page.locator(".detail-pane").getByRole("radio", { name: /Trae/ });
  await expect(traeOption).toBeDisabled();
  await expect(traeOption).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator(".provider-toggle-wrap").filter({ hasText: "Trae" })).toContainText("traecli 未在 PATH 中找到");
});

test("provider capability cards wrap long command paths without horizontal overflow", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);

  await mockWorkspaceApis(page, createScrollableSnapshot(), {
    agentCommands: {
      claude: "/Users/zhiwei/projects/MiniAgent/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js",
    },
  });

  await page.goto("/#settings/provider");

  const claudeCard = page.locator(".provider-capability-card").filter({ hasText: "Claude" }).first();
  const command = claudeCard.locator(".provider-capability-header p");

  await expect(command).toContainText("@agentclientprotocol/claude-agent-acp");
  await expect.poll(() => claudeCard.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect.poll(() => command.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

test("channel settings wrap long test failure messages without horizontal overflow", async ({ page }) => {
  await page.addInitScript((id) => {
    localStorage.setItem("sessionId", id);
  }, sessionId);
  await page.setViewportSize({ width: 390, height: 844 });

  const longMessage = "https://hooks.example.com/services/telegram/bot_token/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  await mockWorkspaceApis(page, createScrollableSnapshot(), {
    channels: [
      {
        id: "telegram",
        label: "Telegram",
        status: "available",
        description: "Configure Telegram delivery with a bot token.",
      },
    ],
    channelTestResults: {
      telegram: {
        ok: false,
        message: longMessage,
      },
    },
  });

  await page.goto("/#settings/channels");

  const card = page.locator(".channel-card").filter({ hasText: "Telegram" }).first();
  await card.getByRole("button", { name: "测试连接" }).click();

  const result = card.locator(".channel-test-result");
  await expect(result).toContainText(longMessage);
  await expect.poll(() => card.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect.poll(() => result.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
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
  await expect(page.getByPlaceholder(/QQ targetRef/)).toHaveCount(0);
  await expect(page.getByPlaceholder(/Telegram targetRef/)).toHaveCount(0);
  await page.getByRole("button", { name: "周期" }).click();
  await expect(page.locator(".schedule-preview")).toContainText("下次执行");
  await page.getByRole("button", { name: "时区" }).click();
  await page.getByRole("option", { name: /^UTC\b/ }).click();
  await expect(page.getByRole("button", { name: "时区" })).toContainText("UTC");
  await page.getByPlaceholder("输入要发送的消息...").fill("Send a scheduled summary");
  await page.getByRole("button", { name: "创建" }).click();

  await expect(page.locator(".schedule-item")).toHaveCount(1);
  await expect(page.locator(".schedule-item-title")).toContainText("启用中");
  await expect(page.locator(".schedule-item-meta")).toContainText("UTC");
  await expect(page.locator(".schedule-item-summary")).toHaveText("Send a scheduled summary");
  await expect(page.locator(".schedule-run-item")).toContainText("成功");
  await expect(page.locator(".schedule-run-item")).toContainText("Send a scheduled summary");
  await expect(page.getByRole("button", { name: "打开会话 tsk_test" })).toBeVisible();
  await page.getByRole("button", { name: "打开任务输出 tsk_test" }).click();
  await expect(page.locator('[data-run-id="run_test"]')).toHaveClass(/chat-bubble--focused-run/);
  await page.getByRole("button", { name: "任务" }).click();
  await page.getByRole("button", { name: "编辑" }).click();
  await expect(page.getByPlaceholder(/QQ targetRef/)).toHaveCount(0);
  await expect(page.getByPlaceholder(/Telegram targetRef/)).toHaveCount(0);
  await expect(page.locator(".schedule-edit-form .schedule-preview")).toContainText("下次执行");
  await page.getByLabel("编辑消息").fill("Updated scheduled summary");
  await page.getByLabel("编辑 Cron 表达式").fill("15 10 * * 1-5");
  await expect(page.locator(".schedule-edit-form .schedule-preview")).toContainText("下次执行");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.locator(".schedule-item-title")).toContainText("15 10 * * 1-5");
  await expect(page.locator(".schedule-item-summary")).toHaveText("Updated scheduled summary");
  await page.getByRole("button", { name: "暂停" }).click();
  await expect(page.locator(".schedule-item-title")).toContainText("已暂停");
});

async function mockWorkspaceApis(
  page: Page,
  snapshot: WorkspaceSnapshot,
  options?: {
    agentCommands?: Partial<Record<"claude" | "codex" | "trae", string>>;
    channels?: ChannelInfo[];
    channelTestResults?: Record<string, { ok: boolean; message: string }>;
    latestPrivateNotificationTargets?: Array<{ channelType: "qq" | "telegram"; targetRef: string }>;
    skills?: SkillMeta[];
  },
) {
  let defaultAgentType: "claude" | "codex" | "trae" = "claude";
  let boundNotificationTargets: Array<{ channelType: "qq" | "telegram"; targetRef: string }> = [];

  await page.route("**/api/workspace**", async (route) => {
    await route.fulfill({ json: snapshot });
  });
  await page.route("**/api/agents", async (route) => {
    await route.fulfill({
      json: {
        agents: [
          {
            agentType: "claude",
            runtimeKind: "acp",
            label: "Claude",
            status: "healthy",
            command: options?.agentCommands?.claude ?? "claude-agent-acp",
            version: null,
            message: null,
            checkedAt: "2026-05-19T01:00:00.000Z",
            capabilities: {
              textStreaming: true,
              structuredEvents: true,
              nativeCompact: false,
              resume: true,
              sessionExport: false,
              permissionPrompt: true,
              imageInput: false,
            },
          },
          {
            agentType: "codex",
            runtimeKind: "acp",
            label: "Codex",
            status: "healthy",
            command: options?.agentCommands?.codex ?? "codex",
            version: null,
            message: null,
            checkedAt: "2026-05-19T01:00:00.000Z",
            capabilities: {
              textStreaming: true,
              structuredEvents: true,
              nativeCompact: false,
              resume: true,
              sessionExport: false,
              permissionPrompt: true,
              imageInput: false,
            },
          },
          {
            agentType: "trae",
            runtimeKind: "acp",
            label: "Trae",
            status: "missing",
            command: options?.agentCommands?.trae ?? "traecli",
            version: null,
            message: "traecli was not found on PATH",
            checkedAt: "2026-05-19T01:00:00.000Z",
            capabilities: {
              textStreaming: true,
              structuredEvents: true,
              nativeCompact: false,
              resume: true,
              sessionExport: false,
              permissionPrompt: true,
              imageInput: false,
            },
          },
        ],
      },
    });
  });
  await page.route("**/api/agent-defaults/resolve", async (route) => {
    await route.fulfill({
      json: {
        default: {
          id: "agd_default",
          scopeType: "system",
          scopeRef: "default",
          agentType: defaultAgentType,
          params: {},
          updatedAt: "2026-05-19T01:00:00.000Z",
        },
      },
    });
  });
  await page.route("**/api/agent-defaults", async (route) => {
    const body = route.request().postDataJSON() as { agentType: "claude" | "codex" | "trae" };
    defaultAgentType = body.agentType;
    await route.fulfill({
      status: 201,
      json: {
        default: {
          id: "agd_default",
          scopeType: "system",
          scopeRef: "default",
          agentType: defaultAgentType,
          params: {},
          updatedAt: "2026-05-19T01:00:00.000Z",
        },
      },
    });
  });
  await page.route("**/api/notification-preferences/default", async (route) => {
    await route.fulfill({
      json: {
        preference: {
          id: boundNotificationTargets.length ? "ntp_default" : null,
          scopeType: "user",
          scopeRef: "default",
          targets: boundNotificationTargets,
          updatedAt: boundNotificationTargets.length ? "2026-05-19T01:00:00.000Z" : null,
        },
        latestPrivateTargets: options?.latestPrivateNotificationTargets ?? [],
      },
    });
  });
  await page.route("**/api/notification-preferences/default/bind-latest-private", async (route) => {
    boundNotificationTargets = options?.latestPrivateNotificationTargets ?? [];
    await route.fulfill({
      json: {
        preference: {
          id: "ntp_default",
          scopeType: "user",
          scopeRef: "default",
          targets: boundNotificationTargets,
          updatedAt: "2026-05-19T01:00:00.000Z",
        },
      },
    });
  });
  await page.route((url) => url.pathname === "/api/channels" || /^\/api\/channels\/[^/]+\/(?:config|test)$/.test(url.pathname), async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET" && url.pathname === "/api/channels") {
      await route.fulfill({ json: { channels: options?.channels ?? [] } });
      return;
    }
    const testMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/test$/);
    if (route.request().method() === "POST" && testMatch) {
      const channelId = decodeURIComponent(testMatch[1]);
      await route.fulfill({ json: options?.channelTestResults?.[channelId] ?? { ok: true, message: "连接正常" } });
      return;
    }
    const configMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/config$/);
    if (route.request().method() === "PUT" && configMatch) {
      await route.fulfill({ json: { config: route.request().postDataJSON() } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await page.route("**/api/skills", async (route) => {
    await route.fulfill({ json: { skills: options?.skills ?? [] } });
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
