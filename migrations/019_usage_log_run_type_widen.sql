-- 019_usage_log_run_type_widen.sql
-- Root cause of the "Monthly data refreshes" counter being stuck at 0/N:
-- the legacy usage_log.run_type CHECK constraint only accepted the
-- pre-rewrite vocabulary (daily_own, daily_competitor, weekly_deep,
-- manual, initial_backfill). Every insert from the current codebase —
-- which writes 'intelligence' (brief generation), 'competitor_scrape',
-- 'backfill', 'manual_sync' — was being rejected by the DB.
--
-- The writers all wrap their inserts in `.catch(e => console.warn(…))`
-- (rightly so — a counter bug shouldn't fail a user-facing brief
-- generation), so the constraint violations went to Vercel logs and
-- nowhere else. End result: usage_log stayed empty, monthly counter
-- stayed at 0, no brief ever counted toward the quota.
--
-- Replace the constraint with the vocabulary the code actually emits.
-- Legacy values are retained too in case any older deploy still writes
-- one of them — the table is currently empty so no rows are affected
-- either way.

ALTER TABLE usage_log
  DROP CONSTRAINT IF EXISTS usage_log_run_type_check;

ALTER TABLE usage_log
  ADD CONSTRAINT usage_log_run_type_check
  CHECK (run_type = ANY (ARRAY[
    -- Current codebase
    'intelligence',         -- morning + manual brief generations
    'competitor_scrape',    -- per-competitor Apify pulls
    'backfill',             -- one-off historic post backfill
    'manual_sync',          -- user-triggered analytics refresh
    -- Legacy vocabulary, kept tolerant in case older code paths run
    'daily_own',
    'daily_competitor',
    'weekly_deep',
    'manual',
    'initial_backfill'
  ]));
