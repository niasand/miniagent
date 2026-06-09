import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createSchedule, fetchScheduleRuns, fetchSchedules, previewSchedule, updateSchedule, updateScheduleStatus } from "../api/schedules.js";
import { localizeAppErrorMessage } from "../lib/error-messages.js";
import { defaultRunAtInput, toDateTimeInput } from "../lib/formatters.js";
import type { AppSection } from "./use-navigation.js";
import type { WorkspaceSchedule, WorkspaceScheduleKind, WorkspaceScheduleRun } from "../../shared/workspace.js";

const SESSION_STORAGE_KEY = "sessionId";

interface UseSchedulesOptions {
  selectedSessionId: string | null;
  activeSection: AppSection;
}

export function useSchedules({ selectedSessionId, activeSection }: UseSchedulesOptions) {
  const queryClient = useQueryClient();
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [scheduleKind, setScheduleKind] = useState<WorkspaceScheduleKind>("once");
  const [scheduleRunAt, setScheduleRunAt] = useState(() => defaultRunAtInput());
  const [scheduleCronExpr, setScheduleCronExpr] = useState("0 9 * * 1-5");
  const [scheduleTimezone, setScheduleTimezone] = useState("Asia/Shanghai");
  const [scheduleText, setScheduleText] = useState("");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editScheduleKind, setEditScheduleKind] = useState<WorkspaceScheduleKind>("once");
  const [editScheduleRunAt, setEditScheduleRunAt] = useState("");
  const [editScheduleCronExpr, setEditScheduleCronExpr] = useState("");
  const [editScheduleTimezone, setEditScheduleTimezone] = useState("Asia/Shanghai");
  const [editScheduleText, setEditScheduleText] = useState("");
  const [editScheduleError, setEditScheduleError] = useState<string | null>(null);

  // Schedule list query
  const { data: schedulesData } = useQuery({
    queryKey: ["schedules", selectedSessionId],
    queryFn: () => selectedSessionId ? fetchSchedules(selectedSessionId) : Promise.resolve({ schedules: [] }),
    enabled: activeSection === "tasks",
    refetchInterval: activeSection === "tasks" ? 10_000 : false,
  });
  const schedules = schedulesData?.schedules ?? [];
  const selectedSchedule = selectedScheduleId ? schedules.find((schedule) => schedule.id === selectedScheduleId) ?? null : null;

  // Create-form preview
  const { data: schedulePreview, error: schedulePreviewError } = useQuery({
    queryKey: ["schedule-preview", scheduleKind, scheduleCronExpr, scheduleRunAt, scheduleTimezone],
    queryFn: () => previewSchedule({
      kind: scheduleKind,
      cronExpr: scheduleKind === "cron" ? scheduleCronExpr.trim() : null,
      runAt: scheduleKind === "once" ? new Date(scheduleRunAt).toISOString() : null,
      timezone: scheduleTimezone,
    }),
    enabled: activeSection === "tasks" && !selectedSchedule && scheduleKind === "cron" && scheduleCronExpr.trim().length > 0,
    retry: false,
    staleTime: 5_000,
  });

  // Edit-form preview
  const { data: editSchedulePreview, error: editSchedulePreviewError } = useQuery({
    queryKey: ["schedule-edit-preview", editingScheduleId, editScheduleKind, editScheduleCronExpr, editScheduleTimezone],
    queryFn: () => previewSchedule({
      kind: editScheduleKind,
      cronExpr: editScheduleKind === "cron" ? editScheduleCronExpr.trim() : null,
      runAt: editScheduleKind === "once" ? new Date(editScheduleRunAt).toISOString() : null,
      timezone: editScheduleTimezone,
    }),
    enabled: activeSection === "tasks" && Boolean(editingScheduleId) && editScheduleKind === "cron" && editScheduleCronExpr.trim().length > 0,
    retry: false,
    staleTime: 5_000,
  });

  // Schedule runs query
  const { data: scheduleRunsData } = useQuery({
    queryKey: ["schedule-runs", selectedScheduleId],
    queryFn: () => selectedScheduleId ? fetchScheduleRuns(selectedScheduleId) : Promise.resolve({ runs: [] }),
    enabled: activeSection === "tasks" && Boolean(selectedScheduleId),
    refetchInterval: activeSection === "tasks" && selectedScheduleId ? 10_000 : false,
  });
  const scheduleRuns: WorkspaceScheduleRun[] = scheduleRunsData?.runs ?? [];

  // Create mutation
  const createScheduleMutation = useMutation({
    mutationFn: () => {
      if (!selectedSessionId) throw new Error("未选择会话");
      const text = scheduleText.trim();
      if (!text) throw new Error("请输入消息内容");
      if (scheduleKind === "once" && !scheduleRunAt) throw new Error("请选择执行时间");
      if (scheduleKind === "cron" && !scheduleCronExpr.trim()) throw new Error("请输入 Cron 表达式");
      return createSchedule({
        sessionId: selectedSessionId,
        kind: scheduleKind,
        runAt: scheduleKind === "once" ? new Date(scheduleRunAt).toISOString() : null,
        cronExpr: scheduleKind === "cron" ? scheduleCronExpr.trim() : null,
        timezone: scheduleTimezone,
        payload: { text },
        actorType: "web_user",
      });
    },
    onMutate: () => {
      setScheduleError(null);
    },
    onSuccess: (data) => {
      setScheduleText("");
      setScheduleRunAt(defaultRunAtInput());
      setSelectedScheduleId(data.schedule.id);
      queryClient.invalidateQueries({ queryKey: ["schedules", selectedSessionId] });
    },
    onError: (error) => {
      setScheduleError(localizeAppErrorMessage(error instanceof Error ? error.message : "Create schedule failed"));
    },
  });

  // Status mutation (pause/resume/cancel)
  const updateScheduleMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" | "cancel" }) =>
      updateScheduleStatus(id, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedules", selectedSessionId] });
      queryClient.invalidateQueries({ queryKey: ["schedule-runs", selectedScheduleId] });
    },
  });

  // Edit mutation
  const editScheduleMutation = useMutation({
    mutationFn: () => {
      if (!editingScheduleId) throw new Error("未选择任务");
      const text = editScheduleText.trim();
      if (!text) throw new Error("请输入消息内容");
      if (editScheduleKind === "once" && !editScheduleRunAt) throw new Error("请选择执行时间");
      if (editScheduleKind === "cron" && !editScheduleCronExpr.trim()) throw new Error("请输入 Cron 表达式");
      return updateSchedule(editingScheduleId, {
        kind: editScheduleKind,
        runAt: editScheduleKind === "once" ? new Date(editScheduleRunAt).toISOString() : null,
        cronExpr: editScheduleKind === "cron" ? editScheduleCronExpr.trim() : null,
        timezone: editScheduleTimezone,
        payload: { text },
        actorType: "web_user",
      });
    },
    onMutate: () => {
      setEditScheduleError(null);
    },
    onSuccess: () => {
      setEditingScheduleId(null);
      setEditScheduleError(null);
      queryClient.invalidateQueries({ queryKey: ["schedules", selectedSessionId] });
      queryClient.invalidateQueries({ queryKey: ["schedule-runs", selectedScheduleId] });
    },
    onError: (error) => {
      setEditScheduleError(localizeAppErrorMessage(error instanceof Error ? error.message : "Update schedule failed"));
    },
  });

  const handleCreateSchedule = () => {
    if (createScheduleMutation.isPending) return;
    createScheduleMutation.mutate();
  };

  const startNewSchedule = () => {
    setSelectedScheduleId(null);
    setEditingScheduleId(null);
    setScheduleError(null);
  };

  const startScheduleEdit = (schedule: WorkspaceSchedule) => {
    setSelectedScheduleId(schedule.id);
    setEditingScheduleId(schedule.id);
    setEditScheduleKind(schedule.kind);
    setEditScheduleRunAt(toDateTimeInput(schedule.runAt ?? schedule.nextRunAt ?? undefined));
    setEditScheduleCronExpr(schedule.cronExpr ?? "");
    setEditScheduleTimezone(schedule.timezone);
    setEditScheduleText(schedule.payloadText ?? "");
    setEditScheduleError(null);
  };

  const submitScheduleEdit = () => {
    if (editScheduleMutation.isPending) return;
    editScheduleMutation.mutate();
  };

  return {
    schedules,
    selectedSchedule,
    selectedScheduleId,
    setSelectedScheduleId,
    setEditingScheduleId,
    startNewSchedule,
    scheduleKind,
    setScheduleKind,
    scheduleRunAt,
    setScheduleRunAt,
    scheduleCronExpr,
    setScheduleCronExpr,
    scheduleTimezone,
    setScheduleTimezone,
    schedulePreview,
    schedulePreviewError,
    scheduleText,
    setScheduleText,
    scheduleError,
    createSchedulePending: createScheduleMutation.isPending,
    handleCreateSchedule,
    editingScheduleId,
    editScheduleKind,
    setEditScheduleKind,
    editScheduleRunAt,
    setEditScheduleRunAt,
    editScheduleCronExpr,
    setEditScheduleCronExpr,
    editScheduleTimezone,
    setEditScheduleTimezone,
    editSchedulePreview,
    editSchedulePreviewError,
    editScheduleText,
    setEditScheduleText,
    editScheduleError,
    editSchedulePending: editScheduleMutation.isPending,
    submitScheduleEdit,
    startScheduleEdit,
    scheduleRuns,
    updateSchedule: (input: { id: string; action: "pause" | "resume" | "cancel" }) => updateScheduleMutation.mutate(input),
  } as const;
}
