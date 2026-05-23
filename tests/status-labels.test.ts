import { describe, expect, it } from "vitest";
import { localizeChannelErrorMessage, localizeProviderErrorMessage } from "../src/client/lib/error-messages.js";
import {
  formatChannelStatus,
  formatProviderStatus,
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
    expect(localizeChannelErrorMessage("Gateway fetch failed: 502")).toBe("网关获取失败");
  });
});
