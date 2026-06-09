/**
 * Filter out non-displayable messages (empty agent responses,
 * thinking-only content, and most system messages).
 */
export function isMessageDisplayable(message: { role: string; markdown: string }): boolean {
  if (message.role === "user") return true;
  if (message.role === "system" && message.markdown.startsWith("Run succeeded")) return true;
  if (message.role === "system") return false;
  if (message.role === "agent" || message.role === "assistant") {
    const content = message.markdown.trim();
    if (!content) return false;
    if (/^<thinking>[\s\S]*<\/thinking>$/.test(content)) return false;
  }
  return true;
}
