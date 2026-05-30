/**
 * Permission policy for agent runtime permission prompts.
 *
 * Web channels have an interactive UI for approving tool calls;
 * non-interactive channels (QQ, Telegram, etc.) auto-approve to avoid
 * timeouts caused by no user being able to respond.
 */

export type PermissionPolicy = "auto_approve" | "wait";

const DEFAULT_POLICIES: Record<string, PermissionPolicy> = {
  web: "wait",
};

/**
 * Resolve the permission policy for a given channel type.
 *
 * @param channelType  The session's channel type (e.g. "web", "qq", "telegram").
 * @param overrides    Optional per-channel overrides (e.g. from DB config or env).
 * @returns The resolved policy — "auto_approve" or "wait".
 */
export function resolvePermissionPolicy(
  channelType: string | null,
  overrides?: Record<string, PermissionPolicy>,
): PermissionPolicy {
  if (overrides && channelType && channelType in overrides) {
    return overrides[channelType];
  }
  if (channelType && channelType in DEFAULT_POLICIES) {
    return DEFAULT_POLICIES[channelType];
  }
  return "auto_approve";
}
