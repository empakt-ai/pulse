-- ═════════════════════════════════════════════════════════════════════════
-- 028_workspace_webhooks.sql
--
-- Webhook-out delivery — workspaces can register URLs that receive a POST
-- body when key events happen (brief generated, signal detected, weekly
-- digest sent). Designed for Slack / Microsoft Teams / Zapier targets:
-- one event = one POST = one payload. Receivers verify the signature
-- header against their secret to confirm authenticity.
--
-- Cap per workspace: enforced in code (api/workspace/webhooks.js) at
-- 5 active webhooks per workspace. The table itself doesn't constrain
-- count; the limit lives where the tier-aware policy is easy to evolve.
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS workspace_webhooks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- URL the dispatcher POSTs to. Validated as https:// at write time.
  url             TEXT NOT NULL,
  -- Human-readable label so admins recognise the row in the UI list.
  label           TEXT NULL,
  -- HMAC-SHA256 secret. Generated server-side on create; returned to the
  -- caller once (during POST) and never re-exposed. Length: 64 hex chars
  -- (256-bit entropy). Receivers compare against
  -- X-Mashal-Signature: sha256=<hex digest of raw body using this secret>.
  secret          TEXT NOT NULL,
  -- Subscribed events. JSONB array of strings — e.g.
  -- ["brief_generated", "weekly_digest_sent"]. Empty = subscribe to all.
  events          JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  -- Diagnostic columns updated by the dispatcher on every send attempt.
  last_delivery_at  TIMESTAMPTZ NULL,
  last_status       TEXT NULL,
  last_error        TEXT NULL,
  failure_count     INTEGER NOT NULL DEFAULT 0,
  created_by      UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS workspace_webhooks_workspace_active
  ON workspace_webhooks (workspace_id, is_active);

NOTIFY pgrst, 'reload schema';
