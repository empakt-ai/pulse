-- 011_reports.sql
-- Reports table + Supabase Storage bucket for the Reports & Export module.
--
-- Each row tracks a generated PDF report. The actual PDF lives in
-- Supabase Storage (bucket: 'reports') under reports/<workspace_id>/<id>.pdf.
-- We keep summary metadata in jsonb so the dashboard list can render
-- without re-fetching the PDF.

CREATE TABLE IF NOT EXISTS reports (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- 'weekly' | 'on_demand'. Drives email-digest behaviour for weeklies.
  kind          text NOT NULL DEFAULT 'on_demand',
  -- Period the report covers (e.g. '2026-05-05 → 2026-05-12'). Free-text
  -- because it's only used for display; data fidelity isn't structural.
  period        text,
  -- Storage path inside the 'reports' bucket. NULL while still rendering.
  pdf_path      text,
  -- Short verdict + counts cached at render time so the list view doesn't
  -- need a join. Mirrors the brief snapshot the PDF shows on page 1.
  summary       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 'rendering' → 'ready' → 'failed'. Generation is sync from a POST today,
  -- so this is informational, but we'll need it when reports go async.
  status        text NOT NULL DEFAULT 'rendering',
  -- If status='failed', store the error message for support visibility.
  error         text,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  -- When the weekly email was sent (NULL = not sent / on-demand report).
  emailed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_reports_workspace
  ON reports(workspace_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_weekly
  ON reports(workspace_id, kind, generated_at DESC) WHERE kind = 'weekly';

-- ─── workspaces.weekly_digest_enabled / digest_email ─────────────────────
-- Per-workspace opt-in for the Sunday email digest. Default off so we don't
-- email users who didn't ask for it. The Sunday cron pass reads this flag.
-- digest_email lets agencies route reports to a shared inbox instead of the
-- owner's personal email; NULL means "use the owner's auth email".
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS weekly_digest_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS digest_email text;

-- ─── Storage bucket setup (run in Supabase Dashboard) ────────────────────
-- This file can't create storage buckets — they're managed via the dashboard
-- or the storage REST API. After running this migration:
--   1. Go to Supabase Dashboard → Storage → New bucket
--   2. Name: reports
--   3. Public: NO (we use signed URLs from the backend)
--   4. File size limit: 25 MB (more than enough for a multi-page PDF)
-- The service-role key our backend uses bypasses bucket RLS, so no policies
-- needed on the bucket itself. End-users never get direct read access —
-- they only ever see signed URLs we generate for them.
