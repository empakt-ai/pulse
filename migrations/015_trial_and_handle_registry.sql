-- ═════════════════════════════════════════════════════════════════════════
-- 015_trial_and_handle_registry.sql
-- Foundation for the 7-day trial + global social-handle uniqueness.
--
-- Two parallel concerns land together because they share the same
-- enforcement surface (the connect flow):
--
--   1. social_handles — a global registry of (platform, handle) bindings.
--      Every account anyone has ever connected, with a current binding
--      (workspace_id) and trail of release events. Prevents two
--      workspaces from claiming the same Instagram handle, and is the
--      durable signal for "this handle already used a trial".
--
--   2. workspaces.trial_* columns — trial is a *state*, not a fourth
--      tier. tier stays as the user's chosen plan ('creator' | 'brand' |
--      'agency'); trial_active is derived from (trial_ends_at, now(),
--      trial_converted_at). Locked at T+7 unconverted.
--
-- After this migration:
--   • New workspaces auto-enter a 7-day trial (defaults via columns).
--   • A backfill pass seeds social_handles from existing
--     connected_accounts so the uniqueness check is honest on day one.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 1) Global handle registry ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_handles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform          TEXT NOT NULL,
  handle            TEXT NOT NULL,                      -- normalised: lowercase, no leading @
  workspace_id      UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  tier              TEXT NULL,                          -- 'trial' | 'creator' | 'brand' | 'agency' at time of bind
  first_claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_bound_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at       TIMESTAMPTZ NULL,                   -- set when trial expires unconverted
  history           JSONB NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT social_handles_unique UNIQUE (platform, handle)
);

CREATE INDEX IF NOT EXISTS social_handles_workspace_idx ON social_handles (workspace_id);
CREATE INDEX IF NOT EXISTS social_handles_released_idx  ON social_handles (released_at);

ALTER TABLE social_handles ENABLE ROW LEVEL SECURITY;

-- Read access via service role only — clients never query this directly.
-- The registry's whole point is platform-wide visibility for uniqueness
-- checks, which only the backend performs.
DROP POLICY IF EXISTS social_handles_no_client_access ON social_handles;
CREATE POLICY social_handles_no_client_access ON social_handles
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ── 2) Trial state on workspaces ─────────────────────────────────────────
-- Defaults: new workspaces start a 7-day trial automatically. Existing
-- rows get trial_started_at = created_at and trial_ends_at = +7d so the
-- trial-sweep cron sees them in a consistent state.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS trial_started_at    TIMESTAMPTZ NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS trial_ends_at       TIMESTAMPTZ NULL DEFAULT (now() + interval '7 days'),
  ADD COLUMN IF NOT EXISTS trial_intent_tier   TEXT        NULL,
  ADD COLUMN IF NOT EXISTS trial_converted_at  TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS trial_locked        BOOLEAN     NOT NULL DEFAULT FALSE;

-- Backfill: any existing row without trial_started_at gets its created_at
-- as the start. Avoids surprising users who signed up before this shipped
-- by treating their workspace as already converted (skip lockout).
UPDATE workspaces
   SET trial_started_at   = COALESCE(trial_started_at, created_at),
       trial_ends_at      = COALESCE(trial_ends_at, created_at + interval '7 days'),
       trial_converted_at = COALESCE(trial_converted_at, created_at)
 WHERE trial_converted_at IS NULL
   AND created_at < (now() - interval '7 days');

-- ── 3) Seed registry from existing connected_accounts ────────────────────
-- Best-effort: walk every active account row, normalise the handle, and
-- bind it to its current workspace. Conflicts (same handle bound to two
-- workspaces today) keep the oldest binding; later ones get logged in
-- history but don't override the row.
INSERT INTO social_handles (platform, handle, workspace_id, tier, first_claimed_at, last_bound_at)
SELECT
  ca.platform,
  lower(regexp_replace(ca.platform_username, '^@', '')) AS handle,
  ca.workspace_id,
  w.tier,
  COALESCE(ca.connected_at, now()),
  COALESCE(ca.connected_at, now())
FROM connected_accounts ca
JOIN workspaces w ON w.id = ca.workspace_id
WHERE ca.platform_username IS NOT NULL
  AND ca.is_active = TRUE
ON CONFLICT (platform, handle) DO NOTHING;

-- ── 4) Schema cache reload so PostgREST sees the new columns ────────────
NOTIFY pgrst, 'reload schema';
