import type { AgentType } from "../api/types.js";
import type { ChannelInfo } from "../api/channels.js";
import type { WorkspaceAgentHealthStatus, WorkspaceRuntimeKind, WorkspaceScheduleKind, WorkspaceScheduleRunStatus, WorkspaceScheduleStatus } from "../../shared/workspace.js";

export function formatProviderStatus(status: WorkspaceAgentHealthStatus | "unknown"): string {
  if (status === "healthy") return "已就绪";
  if (status === "missing") return "未安装";
  if (status === "auth_required") return "需认证";
  if (status === "failed") return "异常";
  return "未知";
}

export function formatChannelStatus(status: ChannelInfo["status"]): string {
  if (status === "connected") return "已连接";
  if (status === "configured") return "已配置";
  if (status === "available") return "可配置";
  return "离线";
}

export function formatScheduleKind(kind: WorkspaceScheduleKind): string {
  return kind === "once" ? "单次" : "周期";
}

export function formatScheduleStatus(status: WorkspaceScheduleStatus): string {
  if (status === "active") return "启用中";
  if (status === "paused") return "已暂停";
  return "已取消";
}

export function formatScheduleRunStatus(status: WorkspaceScheduleRunStatus): string {
  if (status === "scheduled") return "待执行";
  if (status === "queued") return "排队中";
  if (status === "running") return "执行中";
  if (status === "succeeded") return "成功";
  if (status === "failed") return "失败";
  if (status === "paused") return "已暂停";
  return "已取消";
}

export function formatCapabilityName(value: string): string {
  if (value === "textStreaming") return "文本流式输出";
  if (value === "structuredEvents") return "结构化事件";
  if (value === "nativeCompact") return "原生压缩";
  if (value === "resume") return "续接会话";
  if (value === "sessionExport") return "会话导出";
  if (value === "permissionPrompt") return "权限提示";
  if (value === "imageInput") return "图片输入";
  return splitCamelCase(value);
}

export function formatCapabilityAvailability(enabled: boolean): string {
  return enabled ? "支持" : "不支持";
}

export function formatProviderSubtitle(agentType: AgentType, runtimeKind?: WorkspaceRuntimeKind): string {
  const family = agentType === "codex"
    ? "OpenAI"
    : agentType === "claude"
      ? "Anthropic"
      : "Trae";

  if (!runtimeKind) return `${family} 提供方`;
  return `${family} · ${runtimeKind === "acp" ? "ACP 运行时" : "CLI 运行时"}`;
}

function splitCamelCase(value: string): string {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}
