-- 029_comment_automations.sql
-- Engage module — comment→DM automation rules (Step 2).
--
-- Mashal OWNS the rule config; execution is delegated to Zernio's hosted
-- comment-automations (POST /v1/comment-automations) — Zernio watches for the
-- keyword comment, sends the private reply (+ optional public comment), and
-- tracks stats. We store the mapping (zernio_automation_id) and a cached copy
-- of Zernio's stats so the UI reads fast without hitting Zernio every render.
--
-- Designed as a SUPERSET of Zernio's model (extra columns like platform_post_id,
-- provenance, sync-error) so execution can later be swapped to our own engine
-- without a UI/data-model rebuild.
--
-- Additive + idempotent — safe to run (or re-run) on a populated DB.
-- Run in Supabase Dashboard → SQL Editor (or applied via the platform tooling).

CREATE TABLE IF NOT EXISTS comment_automations (
  id                    uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- The connected account this automation runs on. SET NULL on disconnect so
  -- the row survives (zernio_account_id still addresses Zernio for cleanup).
  account_id            uuid REFERENCES connected_accounts(id) ON DELETE SET NULL,
  zernio_account_id     text NOT NULL,
  -- The hosted automation id returned by POST /comment-automations — our handle
  -- for update/delete. NULL only if a create somehow returned no id.
  zernio_automation_id  text,
  -- ── Rule config (superset of Zernio's model) ──
  name                  text NOT NULL,
  keywords              text[] NOT NULL DEFAULT ARRAY[]::text[],
  match_mode            text NOT NULL DEFAULT 'contains',   -- 'contains' | 'exact'
  dm_message            text NOT NULL,
  comment_reply         text,                                -- optional public reply
  platform              text,                                -- 'instagram' | 'facebook'
  platform_post_id      text,                                -- reserved: null = all posts
  is_active             boolean NOT NULL DEFAULT true,
  -- ── Cached stats (read-through from Zernio; refreshed on list) ──
  stat_triggered        integer NOT NULL DEFAULT 0,
  stat_dms_sent         integer NOT NULL DEFAULT 0,
  stat_dms_failed       integer NOT NULL DEFAULT 0,
  stat_unique_contacts  integer NOT NULL DEFAULT 0,
  stats_synced_at       timestamptz,
  -- ── Provenance / sync health ──
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_sync_error       text,                                -- last Zernio sync failure, for the UI
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comment_automations_workspace
  ON comment_automations(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comment_automations_account
  ON comment_automations(account_id) WHERE account_id IS NOT NULL;
-- One local row per hosted Zernio automation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_comment_automations_zernio
  ON comment_automations(zernio_automation_id) WHERE zernio_automation_id IS NOT NULL;

ALTER TABLE comment_automations ENABLE ROW LEVEL SECURITY;

-- Service-role only — the API layer (service key) authorizes per workspace;
-- the browser never queries this table directly. Mirrors social_handles.
DROP POLICY IF EXISTS comment_automations_no_client_access ON comment_automations;
CREATE POLICY comment_automations_no_client_access ON comment_automations
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- Let PostgREST see the new table immediately.
NOTIFY pgrst, 'reload schema';
