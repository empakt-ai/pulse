-- ═════════════════════════════════════════════════════════════════════════
-- 021_ads_intelligence.sql
--
-- Adds the Ad Intelligence module:
--   - workspace_ad_settings : per-workspace goal/category/regions/opt-in
--   - ad_benchmarks         : shared benchmark pool (seeded + network rollups)
--   - competitor_ads        : ad transparency library data (Phase 2 — Apify)
--   - workspaces.ad_intel_network_id : anonymous write key for the pool
--
-- Idempotent. Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS workspace_ad_settings (
  workspace_id   UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  goal           TEXT,
  category       TEXT,
  regions        TEXT[],
  network_opt_in BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ad_benchmarks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform    TEXT NOT NULL,
  format      TEXT,
  category    TEXT NOT NULL,
  region      TEXT NOT NULL,
  week_start  DATE NOT NULL,
  sample_size INT  NOT NULL DEFAULT 1,
  avg_ctr     NUMERIC(6,4),
  avg_cpm     NUMERIC(10,2),
  avg_cpa     NUMERIC(10,2),
  avg_roas    NUMERIC(6,2),
  p25_ctr     NUMERIC(6,4),
  p75_ctr     NUMERIC(6,4),
  source      TEXT NOT NULL DEFAULT 'network',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The format column is nullable, so an ordinary UNIQUE constraint would
-- treat NULL as distinct on every row. A partial unique index plus a
-- distinct one for the format-IS-NULL case keeps upserts idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS ad_benchmarks_unique_with_format
  ON ad_benchmarks (platform, format, category, region, week_start, source)
  WHERE format IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ad_benchmarks_unique_no_format
  ON ad_benchmarks (platform, category, region, week_start, source)
  WHERE format IS NULL;

CREATE INDEX IF NOT EXISTS ad_benchmarks_lookup
  ON ad_benchmarks (category, region, platform, week_start DESC);

CREATE TABLE IF NOT EXISTS competitor_ads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  competitor_handle TEXT NOT NULL,
  platform          TEXT NOT NULL,
  ad_id             TEXT,
  creative_type     TEXT,
  headline          TEXT,
  cta               TEXT,
  start_date        DATE,
  end_date          DATE,
  impression_range  TEXT,
  spend_range       TEXT,
  region            TEXT,
  raw_json          JSONB,
  scraped_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, ad_id)
);

CREATE INDEX IF NOT EXISTS competitor_ads_workspace
  ON competitor_ads (workspace_id, platform, scraped_at DESC);

-- Anonymous network identity column on workspaces. Never written to
-- ad_benchmarks rows — the workspace identity is dropped at write time;
-- this column exists so a future per-workspace contribution audit could
-- run without re-identifying the underlying data.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS ad_intel_network_id UUID DEFAULT gen_random_uuid();
