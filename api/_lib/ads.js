// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// Maps Zernio /ads payloads to the generic posts schema. No interpretation
// of what "good" means happens here; consumers (Mashal brief, future Content
// Studio campaign view) compute their own verdicts from the raw rows.
// ═════════════════════════════════════════════════════════════════════════
//
// Ad performance helper — pulls Zernio /ads for an account and persists into
// the `posts` table with post_type='ad'. Keeps schema light: no new table.
// Ad-specific fields (spend, CTR, CPM, conversions, status) live in raw_data.
//
// Filtering: app code reads ads via `posts.eq.post_type='ad'` (or excludes
// them by adding `.neq.post_type='ad'`).

import { zernio } from './zernio.js';
import { supabase } from './supabase.js';

const num = (v) => {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Map a raw Zernio ad object to our `posts` row shape. The exact shape from
// Zernio /ads isn't documented in the spec the user shared, so the mapping is
// defensive — it accepts common field names from Meta/TikTok/LinkedIn ad APIs.
export function mapAd(ad, { workspaceId, platform, accountId } = {}) {
  const a = ad.analytics || ad.insights || ad.metrics || ad;
  const impressions = num(a.impressions || a.reach || ad.impressions || ad.reach);
  const clicks      = num(a.clicks || a.linkClicks || ad.clicks);
  const ctr         = impressions ? Math.round((clicks / impressions) * 10000) / 100 : 0;
  const spend       = num(a.spend || a.cost || ad.spend || ad.cost);   // in account currency
  const conversions = num(a.conversions || a.results || ad.conversions);

  return {
    workspace_id: workspaceId,
    source: 'own',
    platform,
    platform_post_id: String(ad._id || ad.id || ad.adId || ad.creative_id || ''),
    post_type: 'ad',
    caption: ad.name || ad.title || ad.creative?.name || null,
    posted_at: ad.createdAt || ad.created_time || ad.start_time || ad.startedAt || null,
    views: impressions,
    likes: num(a.likes || a.reactions),
    comments: num(a.comments),
    saves: num(a.saves),
    shares: num(a.shares),
    engagement_rate: ctr, // for ads, eng-rate column carries CTR%
    signal: null,
    raw_data: {
      ad_kind: 'paid',
      account_zernio_id: accountId,
      spend, clicks, impressions, ctr, conversions,
      currency: ad.currency || a.currency || null,
      status: ad.status || ad.effective_status || null,
      objective: ad.objective || null,
      campaign: ad.campaign?.name || ad.campaign_name || null,
      adset: ad.adset?.name || ad.adset_name || null,
      ...ad,
    },
  };
}

// Pull ads for a list of connected accounts and upsert into posts.
// Returns { fetched, persisted, errors }.
export async function pullAds(workspace, accounts, { fromDate, toDate } = {}) {
  let fetched = 0;
  let persisted = 0;
  const errors = [];

  for (const acct of accounts) {
    // Skip YouTube (handled separately via direct API) and platforms unlikely
    // to surface ad data via Zernio.
    if (acct.platform === 'youtube') continue;
    if (!acct.zernio_account_id) continue;

    try {
      const result = await zernio.getAds(acct.zernio_account_id, { fromDate, toDate });
      const ads = result?.ads || result?.data || (Array.isArray(result) ? result : []);
      if (!ads.length) continue;
      fetched += ads.length;

      const rows = ads
        .map(a => mapAd(a, {
          workspaceId: workspace.id,
          platform: acct.platform,
          accountId: acct.zernio_account_id,
        }))
        .filter(r => r.platform_post_id);

      if (!rows.length) continue;

      try {
        await supabase.upsert('posts', rows, {
          onConflict: 'workspace_id,platform,platform_post_id',
        });
        persisted += rows.length;
      } catch (e) {
        errors.push({ platform: acct.platform, error: `DB upsert: ${e.message}` });
      }
    } catch (e) {
      // Don't fail the whole refresh just because one account lacks ad access.
      errors.push({ platform: acct.platform, error: `Zernio /ads: ${e.message}` });
    }
  }

  return { fetched, persisted, errors };
}
