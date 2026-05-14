-- 020_usage_log_run_type_auto.sql
-- Distinguish brief runs the user initiated from brief runs the system
-- initiated (Agency session-start auto-regen, first-brief auto-generation
-- for new workspaces, morning cron). All of them legitimately generate
-- a brief, all should leave an audit row in usage_log — but only the
-- user-initiated ones should count toward the monthly quota.
--
-- getMonthlyUsage filters to run_type = 'intelligence' exactly, so adding
-- 'intelligence_auto' as a separate value keeps the counter clean while
-- preserving the audit trail.

ALTER TABLE usage_log
  DROP CONSTRAINT IF EXISTS usage_log_run_type_check;

ALTER TABLE usage_log
  ADD CONSTRAINT usage_log_run_type_check
  CHECK (run_type = ANY (ARRAY[
    -- User-initiated brief — counts toward quota
    'intelligence',
    -- System-initiated brief (cron, agency session auto-regen, first-brief
    -- bootstrap) — leaves an audit row but is excluded from the counter
    'intelligence_auto',
    -- Operational runs — never counted toward the brief quota
    'competitor_scrape',
    'backfill',
    'manual_sync',
    -- Legacy vocabulary, retained tolerantly
    'daily_own',
    'daily_competitor',
    'weekly_deep',
    'manual',
    'initial_backfill'
  ]));
