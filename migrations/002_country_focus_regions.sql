-- 002_country_focus_regions.sql
-- Adds country + focus_regions to workspaces. Run once in Supabase SQL Editor.
-- Backfills existing rows using the legacy `market` value where possible.
--
-- After running, the `market` column is left in place for backwards-compat
-- but new code writes to `country` / `focus_regions` only.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS focus_regions jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: map legacy market codes to ISO country / region presets.
UPDATE workspaces
SET country = CASE market
    WHEN 'ksa'      THEN 'SA'
    WHEN 'uae'      THEN 'AE'
    WHEN 'pakistan' THEN 'PK'
    WHEN 'canada'   THEN 'CA'
    WHEN 'gcc'      THEN 'SA'   -- pick SA as primary, focus_regions captures the rest
    WHEN 'global'   THEN 'GLOBAL'
    ELSE NULL
  END
WHERE country IS NULL AND market IS NOT NULL;

UPDATE workspaces
SET focus_regions = CASE market
    WHEN 'gcc'    THEN '["SA","AE","KW","QA","BH","OM"]'::jsonb
    WHEN 'global' THEN '["north-america","eu","apac","mena","latam","africa"]'::jsonb
    ELSE focus_regions
  END
WHERE jsonb_array_length(focus_regions) = 0 AND market IS NOT NULL;
