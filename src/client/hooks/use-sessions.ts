import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { batchDeleteSessions, createSession, fetchSessions, updateSessionName } from "../api/sessions.js";
import type { AgentType } from "../api/types.js";
import { localizeAppErrorMessage } from "../lib/error-messages.js";
import type { AppSection } from "./use-navigation.js";
import type { WorkspaceSnapshot } from "../../shared/workspace.js";

const SESSION_STORAGE_KEY = "sessionId";

function readStoredSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SESSION_STORAGE_KEY);
}

interface UseSessionsOptions {
  activeSection: AppSection;
  agentType: AgentType;
  onNewSession?: () => void;
}

export function useSessions({ activeSection, agentType, onNewSession }: UseSessionsOptions) {
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(() => readStoredSessionId());
  const [sessionsQuery, setSessionsQuery] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionName, setEditingSessionName] = useState("");
  const [renameSessionError, setRenameSessionError] = useState<string | null>(null);
  const [sessionsPage, setSessionsPage] = useState(1);
  const [sessionsHasMore, setSessionsHasMore] = useState(true);
  const [sessionsLoadingMore, setSessionsLoadingMore] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [extraSessions, setExtraSessions] = useState<WorkspaceSnapshot["sessions"]>([]);
  const sessionsSearchRef = useRef<HTMLInputElement>(null);
  const sessionsSentinelRef = useRef<HTMLDivElement | null>(null);
  const stableSessionOrderRef = useRef<string[]>([]);

  // Workspace query — session list comes from here
  const { data: snapshot } = useQuery({
    queryKey: ["workspace", sessionId],
    queryFn: async () => {
      const qs = sessionId ? `?sessionId=${sessionId}` : "";
      const res = await fetch(`/api/workspace${qs}`);
      if (!res.ok) throw new Error("加载失败");
      return res.json() as Promise<WorkspaceSnapshot>;
    },
    refetchInterval: 3_000,
    // NOTE: do NOT add placeholderData here. Across session switches the
    // previous snapshot belongs to a different session; placeholderData would
    // leak the old session's messages into the new session UI. Same-key
    // refetch (3s poll) keeps its data by default, so there's no flicker to
    // guard against. See ISSUE-009.
  });

  const sessions = snapshot?.sessions ?? [];

  const orderedSessions = useMemo(() => {
    const allSessions = [...sessions];
    const snapshotIds = new Set(sessions.map((s) => s.id));
    for (const extra of extraSessions) {
      if (!snapshotIds.has(extra.id)) allSessions.push(extra);
    }
    const nextIds = allSessions.map((session) => session.id);
    const existing = stableSessionOrderRef.current.filter((id) => nextIds.includes(id));
    const unseen = nextIds.filter((id) => !existing.includes(id));
    // New sessions (unseen) go to the TOP — snapshot already returns them in
    // updated_at DESC order, so the newest lands first. existing keeps its
    // relative order to stop list items jittering on 3s poll. Reversing the
    // old [...existing, ...unseen] (which buried new sessions at the bottom).
    const nextOrder = [...unseen, ...existing];
    stableSessionOrderRef.current = nextOrder;
    return nextOrder
      .map((id) => allSessions.find((session) => session.id === id) ?? null)
      .filter((session): session is NonNullable<typeof session> => session !== null);
  }, [sessions, extraSessions]);

  const selectedSessionId = sessionId ?? snapshot?.selectedSessionId ?? null;
  const selectedSessionName = orderedSessions.find((session) => session.id === selectedSessionId)?.name ?? "当前会话";

  // Auto-select session from server if none selected locally
  useEffect(() => {
    if (!sessionId && snapshot?.selectedSessionId) {
      setSessionId(snapshot.selectedSessionId);
      localStorage.setItem(SESSION_STORAGE_KEY, snapshot.selectedSessionId);
    }
  }, [snapshot?.selectedSessionId, sessionId]);

  // Infinite scroll for session list
  useEffect(() => {
    const sentinel = sessionsSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && sessionsHasMore && !sessionsLoadingMore) {
          setSessionsLoadingMore(true);
          const nextPage = sessionsPage + 1;
          fetchSessions(nextPage).then((data) => {
            setExtraSessions((prev) => [...prev, ...data.sessions]);
            setSessionsPage(nextPage);
            setSessionsHasMore(data.hasMore);
            setSessionsLoadingMore(false);
          }).catch(() => setSessionsLoadingMore(false));
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sessionsHasMore, sessionsLoadingMore, sessionsPage]);

  // Focus sessions search when workspace section is activated
  useEffect(() => {
    if (activeSection === "workspace") {
      requestAnimationFrame(() => sessionsSearchRef.current?.focus());
    }
  }, [activeSection]);

  // Rename mutation
  const renameSession = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateSessionName(id, name),
    onMutate: () => {
      setRenameSessionError(null);
    },
    onSuccess: () => {
      setEditingSessionId(null);
      setEditingSessionName("");
      setRenameSessionError(null);
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (error) => {
      setRenameSessionError(localizeAppErrorMessage(error instanceof Error ? error.message : "Rename failed"));
    },
  });

  // ── Multi-select & batch delete ──
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const deleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || deleting) return;
    setDeleting(true);
    try {
      await batchDeleteSessions(ids);
      // If the currently open session was archived, drop it so the view falls
      // back to server-selected (or empty) instead of a now-hidden session.
      if (sessionId && ids.includes(sessionId)) {
        setSessionId(null);
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
      exitSelectionMode();
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    } finally {
      setDeleting(false);
    }
  };

  const selectSession = (id: string) => {
    setSessionId(id);
    localStorage.setItem(SESSION_STORAGE_KEY, id);
    queryClient.invalidateQueries({ queryKey: ["workspace", id] });
  };

  const handleNewSession = async () => {
    if (isCreatingSession) return;
    setIsCreatingSession(true);
    try {
      const res = await createSession({ agentType });
      setSessionId(res.sessionId);
      localStorage.setItem(SESSION_STORAGE_KEY, res.sessionId);
      setSessionsPage(1);
      setExtraSessions([]);
      setSessionsHasMore(true);
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
      onNewSession?.();
    } finally {
      setIsCreatingSession(false);
    }
  };

  const startSessionRename = (id: string, name: string) => {
    setEditingSessionId(id);
    setEditingSessionName(name);
    setRenameSessionError(null);
  };

  const cancelSessionRename = () => {
    setEditingSessionId(null);
    setEditingSessionName("");
    setRenameSessionError(null);
  };

  const submitSessionRename = (id: string) => {
    const nextName = editingSessionName.trim();
    if (renameSession.isPending) return;
    if (!nextName) {
      setRenameSessionError("名称不能为空");
      return;
    }
    renameSession.mutate({ id, name: nextName });
  };

  /** Reset infinite scroll state (called when a new session is created via send) */
  const resetInfiniteScroll = () => {
    setSessionsPage(1);
    setExtraSessions([]);
    setSessionsHasMore(true);
  };

  return {
    sessionId,
    setSessionId,
    sessions,
    orderedSessions,
    sessionsQuery,
    setSessionsQuery,
    sessionsSearchRef,
    sessionsHasMore,
    sessionsLoadingMore,
    sessionsSentinelRef,
    handleNewSession,
    isCreatingSession,
    resetInfiniteScroll,
    selectionMode,
    setSelectionMode,
    selectedIds,
    toggleSelected,
    exitSelectionMode,
    deleteSelected,
    deleting,
    editingSessionId,
    editingSessionName,
    setEditingSessionName,
    renameSessionError,
    renameSessionPending: renameSession.isPending,
    startSessionRename,
    submitSessionRename,
    cancelSessionRename,
    selectSession,
    selectedSessionId,
    selectedSessionName,
    snapshot,
  } as const;
}
