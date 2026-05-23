import { describe, expect, it } from "vitest";
import { localizeAppErrorMessage, localizeChannelErrorMessage, localizeProviderErrorMessage } from "../src/client/lib/error-messages.js";
import {
  formatCapabilityAvailability,
  formatCapabilityName,
  formatChannelStatus,
  formatProviderStatus,
  formatProviderSubtitle,
  formatScheduleKind,
  formatScheduleRunStatus,
  formatScheduleStatus,
} from "../src/client/lib/status-labels.js";

describe("status labels", () => {
  it("formats provider statuses", () => {
    expect(formatProviderStatus("healthy")).toBe("已就绪");
    expect(formatProviderStatus("missing")).toBe("未安装");
    expect(formatProviderStatus("auth_required")).toBe("需认证");
    expect(formatProviderStatus("failed")).toBe("异常");
    expect(formatProviderStatus("unknown")).toBe("未知");
  });

  it("formats channel statuses", () => {
    expect(formatChannelStatus("connected")).toBe("已连接");
    expect(formatChannelStatus("available")).toBe("可配置");
    expect(formatChannelStatus("disconnected")).toBe("离线");
  });

  it("formats schedule labels", () => {
    expect(formatScheduleKind("once")).toBe("单次");
    expect(formatScheduleKind("cron")).toBe("周期");
    expect(formatScheduleStatus("active")).toBe("启用中");
    expect(formatScheduleStatus("paused")).toBe("已暂停");
    expect(formatScheduleStatus("cancelled")).toBe("已取消");
  });

  it("formats schedule run statuses", () => {
    expect(formatScheduleRunStatus("scheduled")).toBe("待执行");
    expect(formatScheduleRunStatus("queued")).toBe("排队中");
    expect(formatScheduleRunStatus("running")).toBe("执行中");
    expect(formatScheduleRunStatus("succeeded")).toBe("成功");
    expect(formatScheduleRunStatus("failed")).toBe("失败");
    expect(formatScheduleRunStatus("paused")).toBe("已暂停");
    expect(formatScheduleRunStatus("cancelled")).toBe("已取消");
  });

  it("formats provider capability labels", () => {
    expect(formatCapabilityName("textStreaming")).toBe("文本流式输出");
    expect(formatCapabilityName("structuredEvents")).toBe("结构化事件");
    expect(formatCapabilityName("sessionExport")).toBe("会话导出");
    expect(formatCapabilityName("fooBarBaz")).toBe("Foo Bar Baz");
    expect(formatCapabilityAvailability(true)).toBe("支持");
    expect(formatCapabilityAvailability(false)).toBe("不支持");
  });

  it("formats provider subtitles", () => {
    expect(formatProviderSubtitle("codex", "acp")).toBe("OpenAI · ACP 运行时");
    expect(formatProviderSubtitle("claude", "cli")).toBe("Anthropic · CLI 运行时");
    expect(formatProviderSubtitle("trae")).toBe("Trae 提供方");
  });
});

describe("error message localization", () => {
  it("localizes provider errors", () => {
    expect(localizeProviderErrorMessage("Agents API failed: 503")).toBe("提供方列表加载失败：503");
    expect(localizeProviderErrorMessage("codex is not installed on this machine")).toBe("codex 未安装在当前机器上");
    expect(localizeProviderErrorMessage("traecli was not found on PATH")).toBe("traecli 未在 PATH 中找到");
    expect(localizeProviderErrorMessage("Claude requires authentication")).toBe("Claude 需要先完成认证");
  });

  it("localizes channel errors", () => {
    expect(localizeChannelErrorMessage("Channels API failed: 500")).toBe("通道列表加载失败：500");
    expect(localizeChannelErrorMessage("Save config failed: 400")).toBe("保存通道配置失败：400");
    expect(localizeChannelErrorMessage("Connection ok")).toBe("连接正常");
    expect(localizeChannelErrorMessage("Connected")).toBe("已连接");
    expect(localizeChannelErrorMessage("Gateway fetch failed: 502")).toBe("网关获取失败：502");
    expect(localizeChannelErrorMessage("QQ token fetch failed: 401")).toBe("QQ 令牌获取失败：401");
    expect(localizeChannelErrorMessage("Telegram send failed: 503")).toBe("Telegram 发送失败：503");
    expect(localizeChannelErrorMessage("Telegram send failed after retries")).toBe("Telegram 发送失败，已达到重试上限");
    expect(localizeChannelErrorMessage("WeChat send error: ret=-14 errcode=40001 expired")).toBe("WeChat 发送异常：业务码异常：ret=-14 errcode=40001 expired");
    expect(localizeChannelErrorMessage("ret=-14 errcode=40001 expired")).toBe("业务码异常：ret=-14 errcode=40001 expired");
  });

  it("localizes app-level api errors", () => {
    expect(localizeAppErrorMessage("Workspace API failed: 500")).toBe("工作区加载失败：500");
    expect(localizeAppErrorMessage("Skills API failed: 503")).toBe("技能列表加载失败：503");
    expect(localizeAppErrorMessage("Update session API failed: 409")).toBe("更新会话失败：409");
    expect(localizeAppErrorMessage("Create schedule API failed: 500")).toBe("创建任务失败：500");
    expect(localizeAppErrorMessage("Preview schedule API failed: 422")).toBe("任务预览失败：422");
    expect(localizeAppErrorMessage("Runtime permissions API failed: 500")).toBe("加载运行权限失败：500");
    expect(localizeAppErrorMessage("Compact failed: 500")).toBe("压缩上下文失败：500");
    expect(localizeAppErrorMessage("Restart from ContextPack failed: 500")).toBe("从 ContextPack 重启失败：500");
    expect(localizeAppErrorMessage("No default agent found")).toBe("未找到默认提供方");
    expect(localizeAppErrorMessage("Failed")).toBe("请求失败");
  });
});
