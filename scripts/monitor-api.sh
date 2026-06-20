#!/bin/bash
# MiniAgent API health monitor.
# Probes /api/health each run; alerts via lark-cli DM (to MONITOR_OPEN_ID) when
# the API goes DOWN (after FAIL_THRESHOLD consecutive failures — debounces the
# launchd restart blip) and again when it RECOVERS. State is persisted to avoid
# duplicate alerts. Designed to run under launchd com.miniagent.monitor every ~20s.
#
# Override via env (set in the launchd plist): MONITOR_API_URL, MONITOR_OPEN_ID,
# MONITOR_FAIL_THRESHOLD, MONITOR_STATE_FILE.
set -uo pipefail

API_URL="${MONITOR_API_URL:-http://127.0.0.1:7273/api/health}"
OPEN_ID="${MONITOR_OPEN_ID:-ou_c4d77609d5fba99f3edb9a2fba1e14bc}"
FAIL_THRESHOLD="${MONITOR_FAIL_THRESHOLD:-3}"
STATE_FILE="${MONITOR_STATE_FILE:-/tmp/miniagent-monitor-state}"

# Load previous state: "<up|down>|<fail_count>"
state="up"; fail_count=0
if [[ -f "$STATE_FILE" ]]; then
  IFS='|' read -r state fail_count < "$STATE_FILE" 2>/dev/null || true
fi

# Probe (5s timeout; non-zero exit or non-2xx HTTP = down)
if curl -fsS --max-time 5 "$API_URL" >/dev/null 2>&1; then
  probe="up"
else
  probe="down"
fi

send_alert() {
  # Best-effort: a lark-cli failure must never crash the monitor itself.
  lark-cli im +messages-send --user-id "$OPEN_ID" --text "$1" >/dev/null 2>&1 || true
}

now=$(date '+%m-%d %H:%M:%S')

if [[ "$probe" == "down" ]]; then
  fail_count=$((fail_count + 1))
  if [[ "$fail_count" -ge "$FAIL_THRESHOLD" && "$state" != "down" ]]; then
    send_alert "🔴 MiniAgent API DOWN — health check failed ${fail_count}x at ${API_URL} (${now}). launchd 应在自动重启；持续未恢复请查 logs/api-error.log。"
    state="down"
  fi
else
  if [[ "$state" == "down" ]]; then
    send_alert "🟢 MiniAgent API RECOVERED — health check OK at ${API_URL} (${now})."
  fi
  state="up"
  fail_count=0
fi

echo "${state}|${fail_count}" > "$STATE_FILE"
