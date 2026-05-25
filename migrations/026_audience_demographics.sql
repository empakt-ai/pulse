-- ═════════════════════════════════════════════════════════════════════════
-- 026_audience_demographics.sql
--
-- Audience demographics per connected account. Each row is one bucket of
-- one dimension for one account on one snapshot date — e.g. ("instagram
-- account #abc, age, 25-34, 32.4%, 2026-05-25"). We store every refresh
-- as a new snapshot rather than overwriting, so we can show audience
-- drift over time later without a schema change.
--
-- Dimensions we accept today:
--   age      — age brackets (13-17, 18-24, 25-34, 35-44, 45-54, 55-64, 65+)
--   gender   — male, female, other / unknown
--   country  — ISO-3166-1 alpha-2 country codes (US, IN, SA, …)
--   city     — free-text city label as the platform returns it
--   language — ISO 639-1 language codes (en, ar, ur, hi, fr, …)
--
-- Tier-gated upstream — only Brand and Agency workspaces ever get rows
-- written (the sync hook skips Creator + trial accounts entirely). The
-- table itself doesn't enforce this; the constraint lives in code.
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audience_demographics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id    UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,
  dimension     TEXT NOT NULL
                  CHECK (dimension IN ('age','gender','country','city','language')),
  bucket        TEXT NOT NULL,
  share_pct     NUMERIC(5,2) NOT NULL,
  followers     INTEGER NULL,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  raw_json      JSONB NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per (account, dimension, bucket, day). Re-running sync on the same
-- day overwrites today's snapshot rather than stacking duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS audience_demographics_unique_day
  ON audience_demographics (account_id, dimension, bucket, snapshot_date);

-- The dashboard reads "latest snapshot per account+dimension" — this index
-- supports the typical query (workspace_id + dimension + recent-first).
CREATE INDEX IF NOT EXISTS audience_demographics_lookup
  ON audience_demographics (workspace_id, dimension, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS audience_demographics_account
  ON audience_demographics (account_id, snapshot_date DESC);

NOTIFY pgrst, 'reload schema';
