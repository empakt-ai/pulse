// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// Layer-1 data refresh: pulls posts, snapshots, follower counts, and ads
// from the underlying providers and writes them to the canonical tables.
// Three explicit modes:
//
//   incremental — only what's changed since the account's
//                 last_incremental_sync_at boundary. Cheap. Default.
//   backfill    — first-connect historical pull. Depth derived from
//                 workspace.account_age. Runs once per account, gated by
//                 connected_accounts.initial_sync_complete.
//   deep        — Sunday weekly re-pull of last 30 days to catch the
//                 retroactive metric corrections platforms ship.
//
// NO intelligence here. The signalFor() classifier is the one Mashal-shaped
// field this file writes (`posts.signal`); when we extract this to the
// platform service we'll move signal classification out into a Mashal
// post-processor that runs on the refresh-complete event.
// ═════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase.js';
import { zernio, extractFollowers, parseAudienceDemographics } from './zernio.js';
import { scrapeChannel as scrapeYouTubeChannel } from './youtube.js';
import { pullAds } from './ads.js';
import { scrapeProfile as apifyScrapeProfile, runActor as apifyRunActor, ACTORS as APIFY_ACTORS } from './apify.js';
import { detectContent } from './content-detection.js';

// ─── Depth selection for the first-connect backfill ──────────────────────
// Keyed by workspace.account_age (set during onboarding). For 3+ years
// we default to 365 — the user can re-trigger a longer backfill if needed,
// but uncapped historical pulls are expensive on Apify/Zernio quotas.
const BACKFILL_DAYS = {
  'under-6mo': 90,
  '6-12mo':    180,
  '1-3yr':     365,
  '3yr+':      365,
};

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function isoDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function engagementRate(p) {
  const views = Number(p.views || p.impressions || 0);
  if (!views) return null;
  const eng = Number(p.likes || 0) + Number(p.comments || 0) + Number(p.saves || 0) + Number(p.shares || 0);
  return Math.round((eng / views) * 10000) / 100;
}

function signalFor(rate) {
  if (rate == null) return null;
  if (rate >= 12) return 'viral';
  if (rate >= 6) return 'rising';
  if (rate >= 2) return 'steady';
  return 'declining';
}

// Decide the (fromDate, toDate) window for a single account, given the mode.
function windowFor(account, workspace, mode) {
  const today = daysAgo(0);
  if (mode === 'deep') {
    return { fromDate: daysAgo(30), toDate: today, reason: 'weekly-deep' };
  }
  if (mode === 'backfill') {
    const depth = BACKFILL_DAYS[workspace?.account_age] || 90;
    return { fromDate: daysAgo(depth), toDate: today, reason: `backfill-${depth}d` };
  }
  // Incremental: use last_incremental_sync_at as the floor, with a 1-day
  // overlap so we re-catch posts whose metrics shifted in the last 24h.
  const boundary = account.last_incremental_sync_at
    ? new Date(account.last_incremental_sync_at)
    : null;
  if (!boundary) {
    // Never synced — treat as a small backfill so we don't return empty.
    return { fromDate: daysAgo(30), toDate: today, reason: 'first-incremental' };
  }
  const overlap = new Date(boundary.getTime() - 86400000); // -1 day
  return { fromDate: isoDate(overlap), toDate: today, reason: 'incremental' };
}

// ─── Audience demographics refresh (Brand+ only, IG primary) ─────────────
// Best-effort pull of audience composition from each connected account.
// Writes one row per (account, dimension, bucket, snapshot_date) — the
// unique index in migrations/026 collapses same-day re-runs to an upsert.
//
// Gated to Brand + Agency tiers and skipped during trial. Demographics on
// Zernio's IG endpoint require the Analytics add-on, which is the same
// cost line we keep off trial accounts for /analytics. Creator just isn't
// in scope — keeps the network of calls small.
//
// Platforms supported today: instagram (live), tiktok + facebook (stubs
// that will return rows once Zernio exposes those endpoints). YouTube,
// LinkedIn, X, Snapchat are intentionally absent — their APIs don't
// expose comparable follower-side demographics through Zernio.
const DEMOGRAPHICS_PLATFORMS = new Set(['instagram', 'tiktok', 'facebook']);

async function refreshAudienceDemographics(workspace, accounts) {
  const tier = String(workspace?.tier || 'creator').toLowerCase();
  if (tier !== 'brand' && tier !== 'agency') return { skipped: 'tier' };
  if (workspace?.trial_active) return { skipped: 'trial' };

  const targets = accounts.filter(a => a.zernio_account_id && DEMOGRAPHICS_PLATFORMS.has(a.platform));
  if (!targets.length) return { skipped: 'no_accounts', accounts: 0 };

  const today = daysAgo(0);
  let written = 0;
  const errors = [];

  for (const acct of targets) {
    try {
      const payload = await zernio.getAudienceDemographics(acct.zernio_account_id, acct.platform);
      const rows = parseAudienceDemographics(payload);
      if (!rows.length) continue;

      const records = rows.map(r => ({
        workspace_id: workspace.id,
        account_id: acct.id,
        platform: acct.platform,
        dimension: r.dimension,
        bucket: r.bucket,
        share_pct: r.share_pct,
        followers: acct.followers || null,
        snapshot_date: today,
        raw_json: null,
      }));

      await supabase.upsert('audience_demographics', records, {
        onConflict: 'account_id,dimension,bucket,snapshot_date',
      });
      written += records.length;
    } catch (e) {
      // Tolerate everything — addon-required, 404, schema mismatch.
      // Account demographics being unavailable for one account doesn't
      // block the rest of the sync.
      errors.push({ account_id: acct.id, platform: acct.platform, error: e.message });
    }
  }

  return { skipped: null, accounts: targets.length, rows: written, errors: errors.length ? errors : undefined };
}

// ─── Follower refresh (Zernio → metadata → Apify fallback) ───────────────
async function refreshFollowers(accounts) {
  const own = accounts.filter(a => a.platform !== 'youtube' && a.zernio_account_id);
  if (!own.length) return;

  const ids = own.map(a => a.zernio_account_id);
  let fromZernio = { counts: {}, addonRequired: false };
  try {
    fromZernio = await zernio.getFollowerCountsByAccount(ids);
  } catch { /* tolerate */ }

  const needsApify = own.filter(a => {
    const fromStats = fromZernio.counts[a.zernio_account_id];
    const fromMeta  = extractFollowers(a.metadata);
    return (fromStats == null) && (fromMeta == null)
        && a.platform_username && APIFY_ACTORS[a.platform];
  });
  const apifyById = new Map(
    (await Promise.all(needsApify.map(async a => {
      try {
        const profile = await apifyScrapeProfile(a.platform, a.platform_username);
        return [a.id, profile?.followers ?? null];
      } catch { return [a.id, null]; }
    }))).map(([id, f]) => [id, f])
  );

  await Promise.all(own.map(async (acct) => {
    const fromStats = fromZernio.counts[acct.zernio_account_id];
    const fromMeta  = extractFollowers(acct.metadata);
    const fromApify = apifyById.get(acct.id);
    const followers = fromStats ?? fromMeta ?? fromApify ?? null;
    if (followers != null && followers !== acct.followers) {
      acct.followers = followers;
      await supabase.update('connected_accounts',
        { followers }, { eq: { id: acct.id } }).catch(() => {});
    }
  }));
}

// Map one Zernio post payload to a normalized posts row.
function mapZernioPost(p, { workspaceId, platform }) {
  const a = p.analytics || p.platforms?.[0]?.analytics || {};
  const views    = Number(a.views || a.impressions || p.views || p.impressions || 0);
  const likes    = Number(a.likes || p.likes || 0);
  const comments = Number(a.comments || p.comments || 0);
  const saves    = Number(a.saves || p.saves || 0);
  const shares   = Number(a.shares || p.shares || 0);
  const rate = a.engagementRate != null
    ? Number(a.engagementRate)
    : engagementRate({ views, likes, comments, saves, shares });
  return {
    workspace_id: workspaceId,
    source: 'own',
    platform,
    platform_post_id: String(p._id || p.id || p.postId || p.platforms?.[0]?.platformPostId || ''),
    post_type: p.type || p.mediaType || p.platforms?.[0]?.mediaType || null,
    caption: p.content || p.caption || p.title || null,
    posted_at: p.publishedAt || p.posted_at || p.created_at || p.scheduledFor || null,
    views, likes, comments, saves, shares,
    engagement_rate: rate,
    signal: signalFor(rate),
    raw_data: p,
  };
}

// ─── Per-account fetch (analytics + posts) ───────────────────────────────
async function syncOneAccount(workspace, acct, mode) {
  const { fromDate, toDate, reason } = windowFor(acct, workspace, mode);
  let rows = [];
  let error = null;

  // Trial workspaces never call Zernio /analytics — that endpoint is gated
  // by the paid Analytics add-on and is the single biggest line item we
  // need to keep off the trial cost line. Instead we route every platform
  // through its scrape path (Apify for IG/TT/FB/X/LI, YouTube Data API
  // for YT). The schema rows we produce are identical; downstream code
  // doesn't know the difference.
  const scrapeOnly = !!workspace?.trial_active;

  try {
    if (acct.platform === 'youtube') {
      // YouTube goes through the Data API; we always pull the latest N
      // videos rather than a date window because the API doesn't support
      // `publishedAfter` on the playlistItems endpoint without re-paging.
      const channelKey = acct.metadata?.channel_id || acct.zernio_account_id;
      const limit = mode === 'backfill' ? 50 : mode === 'deep' ? 30 : 12;
      const yt = await scrapeYouTubeChannel(channelKey, { maxResults: limit });
      rows = (yt.posts || []).map(p => {
        const rate = engagementRate(p);
        return { workspace_id: workspace.id, source: 'own', platform: 'youtube',
                 ...p, engagement_rate: rate, signal: signalFor(rate) };
      }).filter(r => r.platform_post_id);
    } else if (scrapeOnly && acct.platform_username) {
      // Apify scrape using the account's public handle. Limit follows the
      // same depth tiers we use for Zernio so trial cards aren't visibly
      // shallower than paid ones (the difference is mostly under the hood).
      const limit = mode === 'backfill' ? 30 : mode === 'deep' ? 24 : 12;
      const result = await apifyRunActor(acct.platform, acct.platform_username, { limit });
      rows = (result.posts || []).map(p => {
        const rate = engagementRate(p);
        return {
          workspace_id: workspace.id,
          source: 'own',
          platform: acct.platform,
          platform_post_id: p.platform_post_id,
          post_type: p.post_type || null,
          caption: p.caption || null,
          posted_at: p.posted_at || null,
          views: p.views || 0,
          likes: p.likes || 0,
          comments: p.comments || 0,
          saves: p.saves || 0,
          shares: p.shares || 0,
          engagement_rate: rate,
          signal: signalFor(rate),
          raw_data: p.raw_data || {},
        };
      }).filter(r => r.platform_post_id);
    } else {
      const analytics = await zernio.getAnalytics(acct.zernio_account_id, fromDate, toDate);
      const posts = Array.isArray(analytics) ? analytics : (analytics?.posts || analytics?.data || []);
      rows = posts.map(p => mapZernioPost(p, { workspaceId: workspace.id, platform: acct.platform }))
                  .filter(r => r.platform_post_id);
    }
  } catch (e) {
    error = e.message;
  }

  if (rows.length) {
    try {
      await supabase.upsert('posts', rows, {
        onConflict: 'workspace_id,platform,platform_post_id',
      });
    } catch (e) {
      error = error || `upsert: ${e.message}`;
    }
  }

  return { platform: acct.platform, account_id: acct.id, fromDate, toDate, reason,
           posts: rows.length, error, rows };
}

// ─── Public entry point ──────────────────────────────────────────────────
// Returns a summary; never throws. Caller can use this from the manual
// /api/sync handler, from cron, or from connect/callback's first-connect
// backfill hook.
export async function runSync(workspace, { mode = 'incremental', accountIds = null } = {}) {
  const accounts = await supabase.select('connected_accounts', {
    select: '*',
    eq: { workspace_id: workspace.id, is_active: true },
  }).catch(() => []);

  let scoped = accounts || [];
  if (accountIds?.length) {
    const set = new Set(accountIds);
    scoped = scoped.filter(a => set.has(a.id));
  }
  // For backfill mode skip accounts that have already completed.
  if (mode === 'backfill') {
    scoped = scoped.filter(a => !a.initial_sync_complete);
  }
  if (!scoped.length) {
    return { mode, refreshed: 0, posts: 0, accounts: [], snapshots: [] };
  }

  await refreshFollowers(scoped);

  // Audience demographics — Brand+ only, tolerated failure. We don't await
  // this in parallel with the per-account post pulls because Zernio's
  // rate limiter is per-request; running serial against follower-refresh
  // keeps us comfortably under their bucket.
  let demographics = null;
  try {
    demographics = await refreshAudienceDemographics(workspace, scoped);
  } catch (e) {
    demographics = { error: e.message };
  }

  const results = [];
  let totalPosts = 0;
  for (const acct of scoped) {
    const r = await syncOneAccount(workspace, acct, mode);
    results.push(r);
    totalPosts += r.posts;

    // Stamp the account so the next incremental pull picks up from now.
    const stamp = { last_incremental_sync_at: new Date().toISOString() };
    if (mode === 'backfill' && !r.error) stamp.initial_sync_complete = true;
    if (!r.error) {
      await supabase.update('connected_accounts', stamp, { eq: { id: acct.id } }).catch(() => {});
    }
  }

  // Build today's account_snapshots (one row per own account).
  // The avg_views_30d / avg_eng_rate_30d / total_views_30d columns are
  // a true 30-day window aggregated from the posts table (including the
  // batch we just upserted) — NOT a summary of the current sync batch.
  // Incremental syncs only pull 1–2 days of posts, so the previous
  // approach of averaging r.rows produced a misleading "30d" label.
  const today = daysAgo(0);
  const since30dIso = new Date(Date.now() - 30 * 86400000).toISOString();
  const snapshots = [];
  for (const r of results) {
    if (r.error) continue;
    const acct = scoped.find(a => a.id === r.account_id);
    if (!acct) continue;

    // Query the freshly-merged posts table for this account's last 30 days.
    // Service-role bypasses RLS so this is cheap; one query per account.
    const recent = await supabase.select('posts', {
      select: 'views,engagement_rate',
      eq: { workspace_id: workspace.id, platform: acct.platform, source: 'own' },
      gte: { posted_at: since30dIso },
      limit: 1000,
    }).catch(() => []);

    const totalViews30 = (recent || []).reduce((s, x) => s + (x.views || 0), 0);
    const avgViews30   = (recent || []).length ? Math.round(totalViews30 / recent.length) : 0;
    const avgEng30     = (recent || []).length
      ? Math.round((recent.reduce((s, x) => s + (x.engagement_rate || 0), 0) / recent.length) * 100) / 100
      : 0;

    snapshots.push({
      workspace_id: workspace.id,
      platform: acct.platform,
      account_type: 'own',
      handle: acct.platform_username,
      snapshot_date: today,
      followers: acct.followers,
      avg_views_30d: avgViews30,
      avg_eng_rate_30d: avgEng30,
      total_views_30d: totalViews30,
    });
  }
  if (snapshots.length) {
    await supabase.upsert('account_snapshots', snapshots, {
      onConflict: 'workspace_id,platform,handle,snapshot_date',
    }).catch(() => {});
  }

  // Ads — no-op when no ads are running. Same window as the deepest mode.
  // Skipped entirely during trial since /ads is on the Zernio paid path
  // and the Ads tab is upgrade-gated anyway.
  let ads = null;
  if (workspace?.trial_active) {
    ads = { skipped: 'trial' };
  } else {
    try {
      const { fromDate, toDate } = mode === 'backfill'
        ? { fromDate: daysAgo(BACKFILL_DAYS[workspace?.account_age] || 90), toDate: daysAgo(0) }
        : { fromDate: daysAgo(30), toDate: daysAgo(0) };
      ads = await pullAds(workspace, scoped, { fromDate, toDate });
    } catch (e) {
      ads = { error: e.message };
    }
  }

  // Content-piece + series detection. Runs after posts are persisted so
  // the detector sees every new row. Best-effort — if the migration hasn't
  // been applied yet, the inserts just fail silently and we return zeros.
  let detection = null;
  try {
    detection = await detectContent(workspace);
  } catch (e) {
    detection = { error: e.message };
  }

  return {
    mode,
    refreshed: results.filter(r => !r.error).length,
    failed: results.filter(r => r.error).length,
    posts: totalPosts,
    accounts: results.map(({ rows, ...rest }) => rest),
    snapshots: snapshots.length,
    ads,
    detection,
    demographics,
  };
}
