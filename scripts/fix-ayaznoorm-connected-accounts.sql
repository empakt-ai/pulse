-- ============================================================================
-- One-off remediation — ayaznoorm@gmail.com
--
-- Error reported in the app:
--   "DB upsert failed: duplicate key value violates unique constraint
--    \"connected_accounts_workspace_id_platform_key\""
--
-- ── Cause ───────────────────────────────────────────────────────────────────
-- connected_accounts carries a UNIQUE (workspace_id, platform) constraint
-- (the auto-named ..._workspace_id_platform_key) — one account per platform
-- per workspace. But every write path keys on zernio_account_id instead:
--   • api/accounts.js          → upsert ON CONFLICT (workspace_id, zernio_account_id)
--   • api/connect/callback.js  → select-then-insert by (workspace_id, zernio_account_id)
-- The DELETE path is a SOFT delete (api/accounts.js: is_active=false,
-- status='disconnected', row stays). So when the user reconnects and Zernio
-- hands back a NEW zernio_account_id, ON CONFLICT finds no match → it tries to
-- INSERT a second row for the same (workspace_id, platform) → the stale
-- disconnected row is still holding that slot → unique-constraint violation.
--
-- ── Fix (model: one account per platform) ───────────────────────────────────
-- Free the platform slot by deleting the DEAD (is_active=false) row(s) for this
-- user's workspace(s). Live connections are never touched. After cleanup the
-- next connect/sync inserts cleanly.
--
-- ── FK safety ────────────────────────────────────────────────────────────────
--   • audience_demographics.account_id → ON DELETE CASCADE  (re-synced on next sync)
--   • inbox_events.account_id          → ON DELETE SET NULL
--   • posts are NOT FK-bound to connected_accounts.id (keyed by
--     workspace_id + platform + platform_post_id) → post history is untouched.
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor.
--   1. Run STEP 1 (read-only) and eyeball the rows.
--   2. Run STEP 2 (transaction). Check the AFTER counts, then COMMIT
--      (or ROLLBACK to abort — flip the last two lines).
-- ============================================================================


-- ── STEP 1 — DIAGNOSTIC (read-only) ─────────────────────────────────────────
-- Confirm the user, their workspace(s), and every connected_accounts row.
-- Note: scoped to workspaces the user OWNS. If they only belong to a workspace
-- via team_access (migration 024), widen the `ws` CTE accordingly.

WITH usr AS (
  SELECT id AS user_id, email
  FROM auth.users
  WHERE lower(email) = lower('ayaznoorm@gmail.com')
),
ws AS (
  SELECT w.id AS workspace_id, w.name
  FROM workspaces w
  JOIN usr u ON w.owner_id = u.user_id
)
SELECT
  ca.workspace_id,
  ca.platform,
  ca.id,
  ca.zernio_account_id,
  ca.platform_username,
  ca.is_active,
  ca.status,
  ca.connected_at,
  ca.disconnected_at,
  ca.last_synced_at
FROM connected_accounts ca
JOIN ws ON ws.workspace_id = ca.workspace_id
ORDER BY ca.platform, ca.is_active DESC, ca.connected_at DESC NULLS LAST;

-- Optional: inspect the global handle registry for these handles. A dead
-- connected_accounts row should already have had its handle released on
-- disconnect; this just confirms nothing is left bound that would block a
-- re-claim on reconnect.
--
-- WITH usr AS (SELECT id FROM auth.users WHERE lower(email)=lower('ayaznoorm@gmail.com')),
--      ws  AS (SELECT w.id FROM workspaces w JOIN usr u ON w.owner_id = u.id)
-- SELECT sh.platform, sh.handle, sh.workspace_id, sh.released_at, sh.last_bound_at
-- FROM social_handles sh
-- WHERE sh.workspace_id IN (SELECT id FROM ws)
-- ORDER BY sh.platform, sh.handle;


-- ── STEP 2 — REPAIR (transactional) ─────────────────────────────────────────
-- Deletes ONLY dead rows (is_active = false) for this user's workspace(s),
-- freeing any platform slot held hostage by a stale disconnected record.
-- Live connections (is_active = true) are left exactly as they are.

BEGIN;

WITH usr AS (
  SELECT id AS user_id
  FROM auth.users
  WHERE lower(email) = lower('ayaznoorm@gmail.com')
),
ws AS (
  SELECT w.id AS workspace_id
  FROM workspaces w
  JOIN usr u ON w.owner_id = u.user_id
)
DELETE FROM connected_accounts ca
USING ws
WHERE ca.workspace_id = ws.workspace_id
  AND ca.is_active = false;          -- dead rows only; never removes a live account

-- AFTER state — verify the slot is now free (expect at most one ACTIVE row
-- per platform, and no is_active=false rows remaining for this workspace).
WITH usr AS (
  SELECT id AS user_id FROM auth.users WHERE lower(email) = lower('ayaznoorm@gmail.com')
),
ws AS (
  SELECT w.id AS workspace_id FROM workspaces w JOIN usr u ON w.owner_id = u.user_id
)
SELECT ca.platform,
       count(*)                              AS rows_remaining,
       count(*) FILTER (WHERE ca.is_active)  AS active_remaining
FROM connected_accounts ca
JOIN ws ON ws.workspace_id = ca.workspace_id
GROUP BY ca.platform
ORDER BY ca.platform;

-- Happy with the AFTER counts? Keep COMMIT. To abort, comment COMMIT and
-- uncomment ROLLBACK.
COMMIT;
-- ROLLBACK;

-- ============================================================================
-- NOTE — this clears the symptom for this user. The underlying mismatch
-- (UNIQUE(workspace_id, platform) vs. upserts keyed on zernio_account_id, plus
-- soft-delete leaving the slot occupied) will recur for anyone who reconnects a
-- platform and gets a fresh zernio_account_id. The durable fix is a code change
-- so the connect/sync path overwrites the existing per-platform row on
-- reconnect (or hard-clears the dead row first). Not included here per request.
-- ============================================================================
