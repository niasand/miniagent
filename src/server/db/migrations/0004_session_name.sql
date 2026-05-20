-- Persist user-facing session names separately from legacy titles.

ALTER TABLE sessions ADD COLUMN name TEXT NOT NULL DEFAULT '';
