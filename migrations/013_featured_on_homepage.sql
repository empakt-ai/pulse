-- 013_featured_on_homepage.sql
-- Workspace-level opt-in to be featured in the "Trusted by" marquee on
-- the public landing page. Default false so signing up never auto-
-- exposes a workspace name. The owner has to flip it on from Settings.
--
-- We never publish anything beyond the workspace name (no handles,
-- no follower counts, no platform data). The endpoint behind this is
-- a deliberate sub-resource so we can never accidentally leak more.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS featured_on_homepage boolean NOT NULL DEFAULT false;

-- Tiny index so the public /api/featured endpoint can read the list
-- without scanning the whole workspaces table.
CREATE INDEX IF NOT EXISTS idx_workspaces_featured
  ON workspaces(featured_on_homepage)
  WHERE featured_on_homepage = true;
