-- 030_automation_engine.sql
-- Engage Automation Engine — P0 (runtime foundation).
-- See docs/specs/automation-engine.md.
--
-- A general Trigger → Condition → Action engine that runs Mashal's own
-- comment/DM automations (replacing Zernio's instant hosted automations so we
-- can add a randomized send delay, a verified follow-gate, and — later —
-- buttons, tags, branching, sequences, broadcasts). Every future capability is
-- a new step TYPE interpreted over `automation_flows.definition`; the tables
-- here never change to add one.
--
-- Five tables:
--   automation_flows     — the rules (trigger + step definition)
--   automation_contacts  — the subscriber (isFollower, tags, custom fields)
--   automation_runs      — one in-flight execution of a flow for a contact
--   automation_jobs      — the timed-work scheduler (delays / waits / sweeps)
--   automation_events    — append-only audit + analytics feed
--
-- Additive + idempotent — safe to run (or re-run) on a populated DB.
-- Service-role only (RLS denies the browser; the API layer authorizes per ws).

-- ── automation_flows ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_flows (
  id                    uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id            uuid REFERENCES connected_accounts(id) ON DELETE SET NULL,
  zernio_account_id     text NOT NULL,
  platform              text,                                 -- 'instagram' | 'facebook'
  name                  text NOT NULL,
  is_active             boolean NOT NULL DEFAULT true,
  -- Trigger: { type:'comment', keywords:[], match_mode:'contains'|'exact',
  --            post_scope:'all'|'post'|'next', platform_post_id?:text }
  trigger               jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Ordered step list (the flow). Step types: send_dm, comment_reply, delay,
  -- condition, wait_for_reply, set_tag, set_field, fire_webhook, goto…
  definition            jsonb NOT NULL DEFAULT '[]'::jsonb,
  version               integer NOT NULL DEFAULT 1,
  -- Provenance: 'flow' (native) or 'comment_automation' (migrated from 029).
  source                text NOT NULL DEFAULT 'flow',
  comment_automation_id uuid REFERENCES comment_automations(id) ON DELETE SET NULL,
  -- Cached counters (append-only truth lives in automation_events).
  stat_triggered        integer NOT NULL DEFAULT 0,
  stat_dms_sent         integer NOT NULL DEFAULT 0,
  stat_dms_failed       integer NOT NULL DEFAULT 0,
  stat_completed        integer NOT NULL DEFAULT 0,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_flows_workspace
  ON automation_flows(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_flows_active
  ON automation_flows(zernio_account_id) WHERE is_active;

-- ── automation_contacts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_contacts (
  id                    uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id            uuid REFERENCES connected_accounts(id) ON DELETE SET NULL,
  zernio_account_id     text NOT NULL,
  platform              text NOT NULL,
  platform_user_id      text NOT NULL,                        -- IGSID / PSID
  handle                text,
  name                  text,
  conversation_id       text,
  is_follower           boolean,                              -- IG: instagramProfile.isFollower
  is_following          boolean,
  follower_checked_at   timestamptz,
  tags                  text[] NOT NULL DEFAULT ARRAY[]::text[],
  fields                jsonb NOT NULL DEFAULT '{}'::jsonb,
  automation_paused     boolean NOT NULL DEFAULT false,       -- human took over in the inbox
  last_seen_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
-- One contact row per (workspace, Zernio account, platform user).
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_contacts_identity
  ON automation_contacts(workspace_id, zernio_account_id, platform_user_id);
CREATE INDEX IF NOT EXISTS idx_automation_contacts_convo
  ON automation_contacts(conversation_id) WHERE conversation_id IS NOT NULL;

-- ── automation_runs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_runs (
  id                    uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  flow_id               uuid NOT NULL REFERENCES automation_flows(id) ON DELETE CASCADE,
  contact_id            uuid NOT NULL REFERENCES automation_contacts(id) ON DELETE CASCADE,
  status                text NOT NULL DEFAULT 'active',       -- active|waiting|done|failed|expired
  current_step          integer NOT NULL DEFAULT 0,
  wait_kind             text,                                 -- 'reply' | 'delay' | null
  context               jsonb NOT NULL DEFAULT '{}'::jsonb,   -- run variables (comment_id, conversation_id…)
  trigger_ref           text,                                 -- the comment/message id that started it (dedup)
  started_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz
);
-- At most one in-flight run per (flow, contact) — idempotency for repeat comments.
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_runs_one_active
  ON automation_runs(flow_id, contact_id) WHERE status IN ('active', 'waiting');
CREATE INDEX IF NOT EXISTS idx_automation_runs_waiting_reply
  ON automation_runs(contact_id) WHERE status = 'waiting' AND wait_kind = 'reply';

-- ── automation_jobs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_jobs (
  id                    uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id                uuid REFERENCES automation_runs(id) ON DELETE CASCADE,
  flow_id               uuid REFERENCES automation_flows(id) ON DELETE CASCADE,
  run_at                timestamptz NOT NULL,
  kind                  text NOT NULL,                        -- resume | send | sweep | timeout
  payload               jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                text NOT NULL DEFAULT 'pending',      -- pending|processing|done|failed|canceled
  attempts              integer NOT NULL DEFAULT 0,
  locked_at             timestamptz,
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
-- The worker's claim query: due + pending, oldest first.
CREATE INDEX IF NOT EXISTS idx_automation_jobs_due
  ON automation_jobs(run_at) WHERE status = 'pending';

-- ── automation_events ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_events (
  id                    uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  flow_id               uuid REFERENCES automation_flows(id) ON DELETE SET NULL,
  run_id                uuid REFERENCES automation_runs(id) ON DELETE SET NULL,
  contact_id            uuid REFERENCES automation_contacts(id) ON DELETE SET NULL,
  kind                  text NOT NULL,                        -- triggered|dm_sent|reply|follow_verified|gate_prompt|failed…
  meta                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  at                    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_events_flow
  ON automation_events(workspace_id, flow_id, at DESC);

-- ── RLS: service-role only (mirrors comment_automations) ───────────────────
ALTER TABLE automation_flows    ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_jobs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_events   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS automation_flows_no_client    ON automation_flows;
DROP POLICY IF EXISTS automation_contacts_no_client ON automation_contacts;
DROP POLICY IF EXISTS automation_runs_no_client     ON automation_runs;
DROP POLICY IF EXISTS automation_jobs_no_client     ON automation_jobs;
DROP POLICY IF EXISTS automation_events_no_client   ON automation_events;
CREATE POLICY automation_flows_no_client    ON automation_flows    FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY automation_contacts_no_client ON automation_contacts FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY automation_runs_no_client     ON automation_runs     FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY automation_jobs_no_client     ON automation_jobs     FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY automation_events_no_client   ON automation_events   FOR ALL TO authenticated USING (false) WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
