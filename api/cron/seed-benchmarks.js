// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] One-shot seed for ad_benchmarks.
//
// Run via POST /api/cron/seed-benchmarks (auth: CRON_SECRET) to populate
// the seeded floor that the spot-score module falls back to before the
// network has enough data. Idempotent: upserts on the unique key.
//
// Values are rounded approximations from public industry sources
// (WordStream, TikTok Business, Meta Q1 2025 reports). Network rollups
// replace these the moment ≥3 weekly network rows exist for the same
// (platform, format, category, region) — see api/_lib/ads-intel.js.
// ═════════════════════════════════════════════════════════════════════════

import { supabase } from '../_lib/supabase.js';
import { json } from '../_lib/auth.js';

const WEEK_START = '2026-01-01';

const SEEDS = [
  // META FEED
  { platform: 'meta', format: 'feed', category: 'food_beverage',   region: 'ontario_ca', avg_ctr: 1.82, avg_cpm: 12.50, p25_ctr: 0.90, p75_ctr: 2.80 },
  { platform: 'meta', format: 'feed', category: 'automotive',      region: 'ontario_ca', avg_ctr: 1.21, avg_cpm: 18.40, p25_ctr: 0.60, p75_ctr: 2.10 },
  { platform: 'meta', format: 'feed', category: 'fashion',         region: 'ontario_ca', avg_ctr: 2.10, avg_cpm: 10.80, p25_ctr: 1.00, p75_ctr: 3.20 },
  { platform: 'meta', format: 'feed', category: 'saas',            region: 'ontario_ca', avg_ctr: 2.80, avg_cpm: 22.00, p25_ctr: 1.40, p75_ctr: 4.20 },
  { platform: 'meta', format: 'feed', category: 'health_wellness', region: 'ontario_ca', avg_ctr: 1.38, avg_cpm: 14.20, p25_ctr: 0.65, p75_ctr: 2.30 },
  { platform: 'meta', format: 'feed', category: 'real_estate',     region: 'ontario_ca', avg_ctr: 1.60, avg_cpm: 16.00, p25_ctr: 0.80, p75_ctr: 2.60 },
  { platform: 'meta', format: 'feed', category: 'finance',         region: 'ontario_ca', avg_ctr: 1.55, avg_cpm: 20.00, p25_ctr: 0.75, p75_ctr: 2.50 },
  { platform: 'meta', format: 'feed', category: 'retail',          region: 'ontario_ca', avg_ctr: 1.72, avg_cpm: 11.50, p25_ctr: 0.85, p75_ctr: 2.75 },
  { platform: 'meta', format: 'feed', category: 'fashion',         region: 'dubai_ae',   avg_ctr: 1.65, avg_cpm:  9.80, p25_ctr: 0.80, p75_ctr: 2.70 },
  { platform: 'meta', format: 'feed', category: 'retail',          region: 'riyadh_sa',  avg_ctr: 1.55, avg_cpm:  8.90, p25_ctr: 0.75, p75_ctr: 2.50 },
  { platform: 'meta', format: 'feed', category: 'food_beverage',   region: 'dubai_ae',   avg_ctr: 1.70, avg_cpm: 11.20, p25_ctr: 0.85, p75_ctr: 2.60 },

  // META REELS
  { platform: 'meta', format: 'reels', category: 'food_beverage', region: 'ontario_ca', avg_ctr: 2.10, avg_cpm: 10.20, p25_ctr: 1.10, p75_ctr: 3.20 },
  { platform: 'meta', format: 'reels', category: 'fashion',       region: 'ontario_ca', avg_ctr: 2.50, avg_cpm:  9.40, p25_ctr: 1.30, p75_ctr: 3.80 },
  { platform: 'meta', format: 'reels', category: 'retail',        region: 'ontario_ca', avg_ctr: 2.20, avg_cpm:  9.80, p25_ctr: 1.10, p75_ctr: 3.40 },

  // TIKTOK IN-FEED
  { platform: 'tiktok', format: 'in_feed', category: 'food_beverage',   region: 'ontario_ca', avg_ctr: 1.40, avg_cpm: 8.80, p25_ctr: 0.65, p75_ctr: 2.20 },
  { platform: 'tiktok', format: 'in_feed', category: 'fashion',         region: 'ontario_ca', avg_ctr: 2.20, avg_cpm: 7.40, p25_ctr: 1.10, p75_ctr: 3.40 },
  { platform: 'tiktok', format: 'in_feed', category: 'health_wellness', region: 'ontario_ca', avg_ctr: 1.65, avg_cpm: 8.20, p25_ctr: 0.80, p75_ctr: 2.60 },
  { platform: 'tiktok', format: 'in_feed', category: 'retail',          region: 'ontario_ca', avg_ctr: 1.80, avg_cpm: 7.90, p25_ctr: 0.90, p75_ctr: 2.80 },
  { platform: 'tiktok', format: 'in_feed', category: 'fashion',         region: 'dubai_ae',   avg_ctr: 2.20, avg_cpm: 7.00, p25_ctr: 1.10, p75_ctr: 3.50 },

  // X (TWITTER) PROMOTED
  { platform: 'x', format: 'promoted', category: 'saas',    region: 'ontario_ca', avg_ctr: 0.70, avg_cpm: 8.00, p25_ctr: 0.30, p75_ctr: 1.20 },
  { platform: 'x', format: 'promoted', category: 'finance', region: 'ontario_ca', avg_ctr: 0.85, avg_cpm: 9.50, p25_ctr: 0.40, p75_ctr: 1.40 },

  // GOOGLE SEARCH (Phase-1 floor; the recommender already references it)
  { platform: 'google', format: 'search', category: 'saas',          region: 'ontario_ca', avg_ctr: 4.10, avg_cpm: 35.00, p25_ctr: 2.00, p75_ctr: 6.50 },
  { platform: 'google', format: 'search', category: 'food_beverage', region: 'ontario_ca', avg_ctr: 3.20, avg_cpm: 18.00, p25_ctr: 1.50, p75_ctr: 5.00 },
  { platform: 'google', format: 'search', category: 'automotive',    region: 'ontario_ca', avg_ctr: 3.80, avg_cpm: 25.00, p25_ctr: 1.80, p75_ctr: 6.00 },
  { platform: 'google', format: 'search', category: 'real_estate',   region: 'ontario_ca', avg_ctr: 3.50, avg_cpm: 22.00, p25_ctr: 1.70, p75_ctr: 5.50 },
];

export default async function handler(req, res) {
  // Same auth pattern as cron/hourly.js — accept either a matching
  // CRON_SECRET bearer (used by Vercel Cron + manual curls) or a deploy
  // with no secret set (local dev convenience).
  if (process.env.CRON_SECRET) {
    const auth = req.headers?.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return json(res, 401, { error: 'Unauthorized' });
    }
  }

  const rows = SEEDS.map(s => ({
    ...s,
    week_start:  WEEK_START,
    sample_size: 1,
    source:      'seeded',
  }));

  try {
    await supabase.upsert('ad_benchmarks', rows, {
      onConflict: 'platform,format,category,region,week_start,source',
    });
    return json(res, 200, { seeded: rows.length });
  } catch (e) {
    console.error('[seed-benchmarks] failed:', e.message);
    return json(res, 500, { error: e.message });
  }
}
