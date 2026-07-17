import { useQuery } from "@tanstack/react-query";
import type { WorkspaceMessage } from "../../shared/workspace.js";

/**
 * Lazy-load one session's messages for the read-only card stream.
 *
 * Keyed per-session so each card fetches and caches independently. The caller
 * gates `sessionId` with an IntersectionObserver — pass `null` until the card
 * is in the viewport, so off-screen cards never fire a request.
 */
export function useSessionMessages(sessionId: string | null, opts?: { limit?: number }) {
  const limit = opts?.limit ?? 200;
  return useQuery({
    queryKey: ["session-messages", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId!)}/messages?limit=${limit}`,
      );
      if (!res.ok) throw new Error("加载消息失败");
      return ((await res.json()) as { messages: WorkspaceMessage[] }).messages;
    },
    refetchInterval: 5_000,
    staleTime: 3_000,
  });
}
