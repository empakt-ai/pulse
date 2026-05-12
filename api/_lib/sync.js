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
// NO intelligence here. The signalFor() classifier is the one PULSE-shaped
// field this file writes (`posts.signal`); when we extract this to the
// platform service we'll move signal classification out into a PULSE
// post-processor that runs on the refresh-complete event.
// ═════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase.js';
import { zernio, extractFollowers } from './zernio.js';
import { scrapeChannel as scrapeYouTubeChannel } from './youtube.js';
import { pullAds } from './ads.js';
import { scrapeProfile as apifyScrapeProfile, ACTORS as APIFY_ACTORS } from './apify.js';
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
  const today = daysAgo(0);
  const snapshots = [];
  for (const r of results) {
    if (r.error || !r.rows.length) continue;
    const acct = scoped.find(a => a.id === r.account_id);
    if (!acct) continue;
    const totalViews = r.rows.reduce((s, x) => s + (x.views || 0), 0);
    const avgViews = r.rows.length ? Math.round(totalViews / r.rows.length) : 0;
    const avgEng = r.rows.length
      ? Math.round((r.rows.reduce((s, x) => s + (x.engagement_rate || 0), 0) / r.rows.length) * 100) / 100
      : 0;
    snapshots.push({
      workspace_id: workspace.id,
      platform: acct.platform,
      account_type: 'own',
      handle: acct.platform_username,
      snapshot_date: today,
      followers: acct.followers,
      avg_views_30d: avgViews,
      avg_eng_rate_30d: avgEng,
      total_views_30d: totalViews,
    });
  }
  if (snapshots.length) {
    await supabase.upsert('account_snapshots', snapshots, {
      onConflict: 'workspace_id,platform,handle,snapshot_date',
    }).catch(() => {});
  }

  // Ads — no-op when no ads are running. Same window as the deepest mode.
  let ads = null;
  try {
    const { fromDate, toDate } = mode === 'backfill'
      ? { fromDate: daysAgo(BACKFILL_DAYS[workspace?.account_age] || 90), toDate: daysAgo(0) }
      : { fromDate: daysAgo(30), toDate: daysAgo(0) };
    ads = await pullAds(workspace, scoped, { fromDate, toDate });
  } catch (e) {
    ads = { error: e.message };
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
  };
}
