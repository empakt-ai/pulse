-- ═════════════════════════════════════════════════════════════════════════
-- 025_support_tickets.sql
-- User-facing suggestions / bug reports / questions. Submitted from
-- Settings → Suggestions, reviewed by an admin via /api/admin tickets
-- actions, and surfaced back to the user via email + the Settings panel.
--
-- Status workflow:
--   open       — user just submitted, no action yet
--   in_review  — admin has seen it and is thinking
--   accepted   — feature suggestion accepted into the build queue
--   in_progress — bug fix or build is underway
--   resolved   — shipped / answered / fixed
--   declined   — won't be done (out of scope, duplicate, etc.)
--
-- founder_note is an optional message attached when status changes. It's
-- included in the email notification and shown on the user's ticket
-- card so the reasoning travels with the status update.
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS support_tickets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id  UUID NULL REFERENCES workspaces(id) ON DELETE SET NULL,
  type          TEXT NOT NULL CHECK (type IN ('bug','suggestion','question')),
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','in_review','accepted','in_progress','resolved','declined')),
  founder_note  TEXT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user   ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status, created_at DESC);

NOTIFY pgrst, 'reload schema';
