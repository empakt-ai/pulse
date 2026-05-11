-- 003_unique_constraints.sql
-- Adds the UNIQUE constraints that the codebase's upsert/ON CONFLICT paths
-- expect. Without these, /api/accounts/sync (Zernio account upsert) and
-- /api/analytics/refresh (post upsert) both fail with Postgres 42P10:
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
--
-- Run once in Supabase Dashboard → SQL Editor.

-- 1) Defensive: drop any existing duplicate rows so the ADD CONSTRAINT can succeed.
--    On a clean DB these DELETEs are no-ops.

DELETE FROM connected_accounts a USING connected_accounts b
  WHERE a.id > b.id
    AND a.workspace_id = b.workspace_id
    AND a.zernio_account_id = b.zernio_account_id;

DELETE FROM posts a USING posts b
  WHERE a.id > b.id
    AND a.workspace_id = b.workspace_id
    AND a.platform = b.platform
    AND a.platform_post_id = b.platform_post_id;

-- 2) Add the unique constraints.

ALTER TABLE connected_accounts
  ADD CONSTRAINT connected_accounts_workspace_zernio_unique
  UNIQUE (workspace_id, zernio_account_id);

ALTER TABLE posts
  ADD CONSTRAINT posts_workspace_platform_postid_unique
  UNIQUE (workspace_id, platform, platform_post_id);
