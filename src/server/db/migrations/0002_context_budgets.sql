CREATE TABLE context_budgets (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'healthy'
    CHECK (status IN ('healthy', 'warning', 'critical', 'overflow')),
  token_estimate INTEGER NOT NULL DEFAULT 0 CHECK (token_estimate >= 0),
  budget_tokens INTEGER NOT NULL CHECK (budget_tokens > 0),
  usage_ratio REAL NOT NULL DEFAULT 0 CHECK (usage_ratio >= 0),
  warning_threshold REAL NOT NULL DEFAULT 0.70
    CHECK (warning_threshold > 0 AND warning_threshold < 1),
  critical_threshold REAL NOT NULL DEFAULT 0.85
    CHECK (critical_threshold > warning_threshold AND critical_threshold < 1),
  overflow_threshold REAL NOT NULL DEFAULT 0.95
    CHECK (overflow_threshold > critical_threshold AND overflow_threshold <= 1),
  source_event_start_id TEXT REFERENCES events(id),
  source_event_end_id TEXT REFERENCES events(id),
  source_global_seq INTEGER NOT NULL DEFAULT 0 CHECK (source_global_seq >= 0),
  current_context_pack_id TEXT REFERENCES context_packs(id),
  last_compacted_at TEXT,
  overflow_reason TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_context_budgets_status ON context_budgets(status);
CREATE INDEX idx_context_budgets_pack ON context_budgets(current_context_pack_id);
