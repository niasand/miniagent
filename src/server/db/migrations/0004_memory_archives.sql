CREATE TABLE memory_archives (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  archive_date TEXT NOT NULL,
  source_event_start_id TEXT NOT NULL REFERENCES events(id),
  source_event_end_id TEXT NOT NULL REFERENCES events(id),
  source_global_seq_start INTEGER NOT NULL CHECK (source_global_seq_start > 0),
  source_global_seq_end INTEGER NOT NULL CHECK (source_global_seq_end >= source_global_seq_start),
  raw_events_json TEXT NOT NULL DEFAULT '[]',
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (session_id, archive_date),
  CHECK (json_valid(raw_events_json)),
  CHECK (json_valid(summary_json))
);

CREATE INDEX idx_memory_archives_session_date ON memory_archives(session_id, archive_date);
