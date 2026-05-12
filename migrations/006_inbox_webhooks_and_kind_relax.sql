-- 006_inbox_webhooks_and_kind_relax.sql
-- Two changes:
--
-- 1. inbox_events table — destination for Zernio webhook deliveries
--    (comments, DMs, mentions, reactions). Real-time stream that
--    powers the engagement_velocity / "reply now" Brief signals.
--
-- 2. Relax signals.kind constraint — the new cross-platform-intelligence
--    kinds (cross_platform_gap, missed_crosspost, series_arc,
--    hook_pattern, collaboration_multiplier, engagement_velocity,
--    caption_language_split) may be rejected by an old CHECK on
--    signals.kind. Drop the constraint if it exists; the application
--    already validates kinds at write time.
--
-- Additive — safe to run on a populated DB.

-- ─── Relax signals.kind ──────────────────────────────────────────────────
-- The CHECK constraint name varies by how the table was originally created.
-- Drop both common names. Either one missing is a no-op (IF EXISTS).
ALTER TABLE signals DROP CONSTRAINT IF EXISTS signals_kind_check;
ALTER TABLE signals DROP CONSTRAINT IF EXISTS signals_kind_fkey;

-- ─── inbox_events ────────────────────────────────────────────────────────
-- Receives Zernio webhook deliveries. Schema is intentionally generic so
-- new event kinds don't require migrations — kind + payload jsonb cover
-- comments, DMs, mentions, reactions, etc.
CREATE TABLE IF NOT EXISTS inbox_events (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- The connected account this event is about (null when we can't resolve).
  account_id    uuid REFERENCES connected_accounts(id) ON DELETE SET NULL,
  -- Zernio's external account ID — useful when the local row hasn't synced
  -- yet but the webhook beat us to it.
  zernio_account_id text,
  platform      text,
  -- Event taxonomy: 'comment_created', 'dm_received', 'mention',
  -- 'reaction_added', etc. Don't constrain — Zernio adds new kinds.
  kind          text NOT NULL,
  -- The post this event is about, when applicable. NULL for DMs.
  post_id       uuid REFERENCES posts(id) ON DELETE SET NULL,
  platform_post_id text,
  -- Author of the event (commenter / DM sender).
  author_handle text,
  body          text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Webhook delivery id from Zernio — used for idempotency. UNIQUE so
  -- replayed deliveries dedupe instead of double-inserting.
  delivery_id   text,
  received_at   timestamptz NOT NULL DEFAULT now(),
  -- 'pending' until processed by the signal detector; 'processed' after.
  status        text NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_inbox_events_workspace
  ON inbox_events(workspace_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_events_post
  ON inbox_events(post_id) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbox_events_status
  ON inbox_events(workspace_id, status) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_events_delivery
  ON inbox_events(delivery_id) WHERE delivery_id IS NOT NULL;
