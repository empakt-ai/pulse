-- ═════════════════════════════════════════════════════════════════════════
-- 027_ad_library_competitor_cooldown.sql
--
-- Single-column add: last_ad_library_scrape_at on competitors. Drives the
-- 24-hour cooldown that gates Meta Ad Library scrapes per competitor so
-- the cron doesn't burn Apify credit re-fetching the same Page name every
-- hour. Reuses the same pattern as competitors.last_synced_at, which gates
-- the profile/posts scrape on a 6-hour window.
--
-- The competitor_ads table itself already exists (migrations/021); this
-- migration only adds the freshness column on the parent record.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE competitors
  ADD COLUMN IF NOT EXISTS last_ad_library_scrape_at TIMESTAMPTZ NULL;

NOTIFY pgrst, 'reload schema';
