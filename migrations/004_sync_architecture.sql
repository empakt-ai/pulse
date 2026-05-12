-- 004_sync_architecture.sql
-- Two-layer sync architecture: incremental data refresh + timezone-aware
-- intelligence cron. Run once in Supabase Dashboard → SQL Editor.
--
-- Additive — safe to run on a populated DB. No data is rewritten.

-- ─── workspaces.timezone ──────────────────────────────────────────────────
-- IANA timezone string ("America/Toronto", "Asia/Karachi", "UTC"). Captured
-- automatically from the browser at onboarding. The hourly cron uses this
-- to decide whose local clock just ticked over 6am / 8am / 1pm / 6pm.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';

-- ─── connected_accounts.initial_sync_complete ─────────────────────────────
-- Flips true once the first-connect backfill (90/180/365 days, keyed by
-- workspace.account_age) has finished. Used to short-circuit re-running
-- backfills on every login.
ALTER TABLE connected_accounts
  ADD COLUMN IF NOT EXISTS initial_sync_complete boolean NOT NULL DEFAULT false;

-- ─── connected_accounts.last_incremental_sync_at ──────────────────────────
-- The boundary timestamp used for `?fromDate=` on the next incremental
-- pull. Separate from `last_synced_at` because that field already gets
-- bumped by other write paths (Zernio listAccounts upsert, follower-stats
-- refresh) and shouldn't be misread as "latest post we've seen".
ALTER TABLE connected_accounts
  ADD COLUMN IF NOT EXISTS last_incremental_sync_at timestamptz;

-- ─── signals.is_series ────────────────────────────────────────────────────
-- Optional marker so the UI can render series-comparison signals with a
-- different chrome. Defaults false; populated by the intelligence prompt.
ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS is_series boolean NOT NULL DEFAULT false;

-- ─── Index for hourly cron fan-out ────────────────────────────────────────
-- The morning-brief / live-signals cron iterates every workspace each hour
-- and decides whose local clock matches the trigger window. Index lets that
-- scan complete in single-digit ms even at 10k+ workspaces.
CREATE INDEX IF NOT EXISTS idx_workspaces_timezone ON workspaces(timezone);

-- ─── Index for incremental fetch ──────────────────────────────────────────
-- Per-account incremental sync filters posts by posted_at >= last_synced_at.
-- Composite index keeps that range scan cheap on the hot path.
CREATE INDEX IF NOT EXISTS idx_posts_workspace_platform_posted
  ON posts(workspace_id, platform, posted_at DESC);
