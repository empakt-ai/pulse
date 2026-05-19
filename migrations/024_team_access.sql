-- ═════════════════════════════════════════════════════════════════════════
-- 024_team_access.sql
-- Team access for Brand and Agency tiers — workspace members + invitations.
--
--   workspace_members  — one row per (user, workspace, role). Owners
--                        get a row backfilled below so the access check
--                        is uniform: "do you have a workspace_members
--                        row for this workspace?" rather than two
--                        separate paths (owner vs invited).
--
--   team_invitations   — one row per outstanding invite. Status moves
--                        pending → accepted | expired | revoked. The
--                        token is a 32-byte hex string emailed to the
--                        invitee; accepting it creates the matching
--                        workspace_members row.
--
-- Permission enforcement lives in api/_lib/permissions.js (role hierarchy:
-- viewer < member < admin < owner) and is applied by api/_lib/auth.js
-- on every authenticated request, plus per-endpoint assertRole calls
-- on write/admin routes.
-- ═════════════════════════════════════════════════════════════════════════

-- ── workspace_members ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_members (
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  -- invited_by is NULL for the owner backfill rows (no inviter).
  invited_by   UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  -- accepted_at is the moment the user picked up the invite. For owner
  -- backfill rows this is the workspace.created_at so audit reports
  -- have a real timestamp to display.
  accepted_at  TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user      ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_role      ON workspace_members(workspace_id, role);

-- ── team_invitations ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  -- Owners are minted on workspace create; you can't invite someone as
  -- 'owner'. Use the admin role for full-access invitees.
  role         TEXT NOT NULL CHECK (role IN ('admin','member','viewer')),
  token        TEXT NOT NULL UNIQUE,
  invited_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ NOT NULL,
  accepted_at  TIMESTAMPTZ NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','expired','revoked')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_invitations_workspace ON team_invitations(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_team_invitations_email     ON team_invitations(LOWER(email));

-- ── Owner backfill ──────────────────────────────────────────────────────
-- Every existing workspace gets a workspace_members row for its owner
-- so the membership check is uniform across owned + invited workspaces.
-- ON CONFLICT DO NOTHING so re-running this migration is safe.
INSERT INTO workspace_members (user_id, workspace_id, role, accepted_at, created_at)
SELECT owner_id, id, 'owner', created_at, created_at
FROM workspaces
WHERE owner_id IS NOT NULL
ON CONFLICT (user_id, workspace_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
