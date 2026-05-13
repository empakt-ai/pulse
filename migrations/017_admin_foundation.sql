-- ═════════════════════════════════════════════════════════════════════════
-- 017_admin_foundation.sql
-- Foundation for the admin console — kept in its own migration so the
-- module can ship as a self-contained Phase 0 with zero PULSE-side
-- changes. Three concerns land together because they share the same
-- "admin reads from / writes to a privileged surface" pattern:
--
--   1. admin_audit_log — every sensitive admin action with actor, target,
--      before/after, and a mandatory reason string. Built first so every
--      admin write from day one carries provenance.
--
--   2. platform_settings — single-row K/V config (jsonb values). Admin
--      flips a key, every PULSE call sees the change on the next request
--      (post-cache TTL). No deploy required to switch AI provider, toggle
--      a feature flag, or adjust a global cap.
--
--   3. user_sign_in_log — append-only history of every sign-in event with
--      IP + UA. Supabase keeps only `last_sign_in_at`; this gives the
--      audit story the full timeline.
--
--   4. profiles additions — admin-only knobs that live on the user row:
--      tier_override (run-as a tier), is_disabled (soft-block at auth),
--      disabled_at / disabled_reason (provenance for the disable).
--
-- Every new table has RLS on with deny-all-clients — only the service-role
-- backend ever touches them.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 1) Admin audit log ────────────────────────────────────────────────────
-- before/after are jsonb so we can capture mixed shapes (a workspace row,
-- a single field, a key/value pair) without a per-action schema.
-- reason is NOT NULL — every admin write must justify itself. The
-- requireReason() helper enforces this at the API layer; the NOT NULL is
-- the belt-and-suspenders fallback.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  action         TEXT        NOT NULL,                 -- e.g. 'trial.extend', 'workspace.disable'
  target_type    TEXT        NOT NULL,                 -- workspace|user|handle|platform_settings|...
  target_id      TEXT        NULL,                     -- uuid or composite key as text
  before         JSONB       NULL,
  after          JSONB       NULL,
  reason         TEXT        NOT NULL CHECK (length(trim(reason)) > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx       ON admin_audit_log (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx      ON admin_audit_log (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_action_idx      ON admin_audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx     ON admin_audit_log (created_at DESC);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_audit_log_no_client_access ON admin_audit_log;
CREATE POLICY admin_audit_log_no_client_access ON admin_audit_log
  FOR ALL TO authenticated USING (false) WITH CHECK (false);


-- ── 2) Platform settings (single-row K/V) ────────────────────────────────
-- jsonb values mean adding a new lever (rate cap, kill switch, model
-- temperature) is an INSERT, not a migration. Defaults are seeded below
-- so a missing row never causes a silent fallback at read time.
CREATE TABLE IF NOT EXISTS platform_settings (
  key         TEXT        PRIMARY KEY,
  value       JSONB       NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_settings_no_client_access ON platform_settings;
CREATE POLICY platform_settings_no_client_access ON platform_settings
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- Seed expected keys. ON CONFLICT preserves any value an admin has
-- already set, so re-running the migration is safe.
INSERT INTO platform_settings (key, value) VALUES
  ('ai_provider',          '"gemini"'::jsonb),
  ('feature_flags',        '{}'::jsonb),
  ('brief_prompt_version', '"v1"'::jsonb),
  ('caps',                 '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;


-- ── 3) User sign-in log ──────────────────────────────────────────────────
-- One row per successful sign-in event, written by /api/auth-log when the
-- SPA detects a fresh session. We deliberately don't insert from a
-- Supabase auth trigger — Edge Function setup adds operational surface we
-- don't need yet. SPA-driven works because the user_id + token come from
-- a freshly-validated Supabase session.
CREATE TABLE IF NOT EXISTS user_sign_in_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signed_in_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip            INET        NULL,
  user_agent    TEXT        NULL,
  session_id    TEXT        NULL,                     -- best-effort dedup key (e.g., JWT iat)
  method        TEXT        NULL                      -- 'magic_link' | 'password' | 'oauth' | 'restored'
);

CREATE INDEX IF NOT EXISTS user_sign_in_log_user_idx       ON user_sign_in_log (user_id, signed_in_at DESC);
CREATE INDEX IF NOT EXISTS user_sign_in_log_signed_at_idx  ON user_sign_in_log (signed_in_at DESC);

ALTER TABLE user_sign_in_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_sign_in_log_no_client_access ON user_sign_in_log;
CREATE POLICY user_sign_in_log_no_client_access ON user_sign_in_log
  FOR ALL TO authenticated USING (false) WITH CHECK (false);


-- ── 4) Profile additions for admin-only knobs ─────────────────────────────
-- tier_override is honoured by auth.js only when the row's is_admin=true,
-- so a non-admin with a bogus value in their row gets ignored. Disabled
-- users hit a 403 at authenticate() time; the reason gets surfaced in the
-- error so support can explain why.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS tier_override    TEXT        NULL,
  ADD COLUMN IF NOT EXISTS is_disabled      BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS disabled_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS disabled_reason  TEXT        NULL;

-- Constrain tier_override to the same set the tiers module knows about.
-- NULL means "no override" and is the default; the named values map to
-- TIERS keys in api/_lib/tiers.js.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_tier_override_valid'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_tier_override_valid
      CHECK (tier_override IS NULL OR tier_override IN ('creator', 'brand', 'agency'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
