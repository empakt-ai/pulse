-- 009_signals_is_series_patch.sql
-- Re-apply the signals.is_series column. Migration 004 was supposed to
-- add it but the column is missing in production (verified via
-- information_schema). Either 004 errored partway or was only partially
-- applied. IF NOT EXISTS makes this safe to run regardless.
--
-- Without this column, persist() in intelligence.js fails because the
-- insert references signals.is_series — surfaces to the UI as
-- "persist_failed".

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS is_series boolean NOT NULL DEFAULT false;
