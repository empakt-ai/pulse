-- 010_webhook_state_columns.sql
-- Columns the Zernio webhook handler writes into when it receives
-- lifecycle events (post.published, post.failed/cancelled,
-- account.disconnected). Without these, the events would only land in
-- inbox_events as opaque pending rows.
--
-- All ADDs are idempotent (IF NOT EXISTS). Safe on a populated DB.

-- ─── posts.published_at ─────────────────────────────────────────────────
-- Set when we get a post.published webhook. Opens the 24h velocity-watch
-- window the live-signals cron uses to detect breakouts.
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- ─── posts.status ───────────────────────────────────────────────────────
-- Tracks scheduler lifecycle. NULL = unknown / legacy row. Values we
-- write: 'published', 'failed', 'cancelled', 'partial', 'recycled'.
-- Not constrained — Zernio may add new states.
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS status text;

CREATE INDEX IF NOT EXISTS idx_posts_status
  ON posts(workspace_id, status) WHERE status IS NOT NULL;

-- ─── connected_accounts.status / disconnected_at ────────────────────────
-- Settings reads `status` to show "Reconnect required" banners and to
-- pause sync for dead accounts. Sync code checks it before pulling.
ALTER TABLE connected_accounts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'connected';

ALTER TABLE connected_accounts
  ADD COLUMN IF NOT EXISTS disconnected_at timestamptz;
