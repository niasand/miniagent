import type { ReactElement } from "react";
import type { WorkspaceSnapshot } from "../../shared/workspace.js";

/**
 * Format a date string for display in chat bubbles and session lists.
 * Shows time-only for today, date+time for older messages.
 */
export function formatMessageTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const sameDay = date.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(undefined, {
    month: sameDay ? undefined : "short",
    day: sameDay ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Format a date with timezone display (for schedules). */
export function formatZonedTime(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(date);
}

/** Thin wrapper — session updated-at uses the same format as message time. */
export const formatSessionUpdatedAt = formatMessageTime;

/** Map channel type enum to display label. */
export function formatSessionChannel(
  channelType: WorkspaceSnapshot["sessions"][number]["channelType"],
): string {
  const map: Record<string, string> = {
    feishu: "Feishu",
    qq: "QQ",
    telegram: "Telegram",
    discord: "Discord",
    wechat: "WeChat",
    wecom: "WeCom",
    dingtalk: "DingTalk",
    web: "网页",
  };
  return map[channelType as string] ?? "本地";
}

/**
 * Highlight search matches in a session name.
 * Returns an array of strings and <mark> elements.
 */
export function renderHighlightedSessionName(text: string, query: string) {
  const needle = query.trim();
  if (!needle) return text;

  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const parts: (string | ReactElement)[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerNeedle);

  while (matchIndex !== -1) {
    if (matchIndex > cursor) parts.push(text.slice(cursor, matchIndex));
    const end = matchIndex + needle.length;
    parts.push(
      <mark key={`${matchIndex}-${end}`} className="session-highlight">
        {text.slice(matchIndex, end)}
      </mark>,
    );
    cursor = end;
    matchIndex = lowerText.indexOf(lowerNeedle, cursor);
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length > 0 ? parts : text;
}

/** Produce a datetime-local input value from a date (for schedule forms). */
export function toDateTimeInput(value?: string | Date): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return defaultRunAtInput();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Default "run at" time: 1 hour from now. */
export function defaultRunAtInput(): string {
  return toDateTimeInput(new Date(Date.now() + 60 * 60 * 1000));
}
