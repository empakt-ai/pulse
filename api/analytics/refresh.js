import { authenticate, json } from '../_lib/auth.js';
import { supabase } from '../_lib/supabase.js';
import { zernio, extractFollowers } from '../_lib/zernio.js';
import { checkUsageCap } from '../_lib/tiers.js';
import { generateBrief } from '../_lib/intelligence.js';
import { scrapeChannel as scrapeYouTubeChannel } from '../_lib/youtube.js';
import { pullAds } from '../_lib/ads.js';
import { scrapeProfile as apifyScrapeProfile, ACTORS as APIFY_ACTORS } from '../_lib/apify.js';

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function engagementRate(p) {
  const views = Number(p.views || p.impressions || 0);
  if (!views) return null;
  const engagements = Number(p.likes || 0) + Number(p.comments || 0) + Number(p.saves || 0) + Number(p.shares || 0);
  return Math.round((engagements / views) * 10000) / 100; // 2dp percent
}

function signalFor(rate) {
  if (rate == null) return null;
  if (rate >= 12) return 'viral';
  if (rate >= 6) return 'rising';
  if (rate >= 2) return 'steady';
  return 'declining';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  const cap = await checkUsageCap(ws);
  if (cap.exceeded) {
    return json(res, 429, {
      error: 'Monthly usage cap reached. Upgrade plan or wait until next cycle.',
      used: cap.used,
      limit: cap.limit,
    });
  }

  const accounts = await supabase.select('connected_accounts', {
    select: '*',
    eq: { workspace_id: ws.id },
  }).catch(() => []);
  if (!accounts?.length) return json(res, 200, { refreshed: 0, posts: 0, message: 'No accounts to refresh' });

  const fromDate = daysAgo(30);
  const toDate = daysAgo(0);
  let totalPosts = 0;
  const failures = [];
  const snapshots = [];

  // Refresh follower counts. Try Zernio first (free, fast — but currently
  // gated behind their Analytics add-on for this workspace). If it 403s with
  // requiresAddon, fall back to a parallel Apify profile scrape per account.
  {
    const ownAccounts = (accounts || []).filter(a => a.platform !== 'youtube' && a.zernio_account_id);
    const ids = ownAccounts.map(a => a.zernio_account_id);
    let fromZernio = { counts: {}, addonRequired: false };
    if (ids.length) {
      fromZernio = await zernio.getFollowerCountsByAccount(ids);
    }

    // Identify accounts still missing followers after Zernio attempt and run
    // Apify for those (parallel — keeps us under the function budget when
    // multiple accounts need refreshing).
    const needsApify = ownAccounts.filter(a => {
      const fromStats = fromZernio.counts[a.zernio_account_id];
      const fromMeta  = extractFollowers(a.metadata);
      return (fromStats == null) && (fromMeta == null) && a.platform_username && APIFY_ACTORS[a.platform];
    });
    const apifyResults = await Promise.all(needsApify.map(async (a) => {
      try {
        const profile = await apifyScrapeProfile(a.platform, a.platform_username);
        return { id: a.id, followers: profile?.followers ?? null, profile };
      } catch (e) {
        return { id: a.id, followers: null, error: e.message };
      }
    }));
    const apifyById = new Map(apifyResults.map(r => [r.id, r]));

    await Promise.all(ownAccounts.map(async (acct) => {
      const fromStats = fromZernio.counts[acct.zernio_account_id];
      const fromMeta  = extractFollowers(acct.metadata);
      const fromApify = apifyById.get(acct.id)?.followers;
      const followers = fromStats ?? fromMeta ?? fromApify ?? null;
      if (followers != null && followers !== acct.followers) {
        acct.followers = followers;
        await supabase.update('connected_accounts',
          { followers, last_synced_at: new Date().toISOString() },
          { eq: { id: acct.id } }).catch(() => {});
      }
    }));
  }

  for (const acct of accounts) {
    const runLog = {
      workspace_id: ws.id,
      run_type: 'analytics',
      platform: acct.platform,
      status: 'running',
      records_fetched: 0,
    };
    let logRow = null;
    try {
      const inserted = await supabase.insert('usage_log', runLog);
      logRow = inserted?.[0];
    } catch {}

    try {
      // Branch: YouTube goes through Google's API directly (api/_lib/youtube)
      // and produces posts already in our normalized shape. Other platforms
      // use Zernio and need shape-mapping below.
      let rows;
      if (acct.platform === 'youtube') {
        const channelKey = acct.metadata?.channel_id || acct.zernio_account_id;
        const yt = await scrapeYouTubeChannel(channelKey, { maxResults: 12 });
        rows = (yt.posts || []).map(p => {
          const rate = engagementRate(p);
          return {
            workspace_id: ws.id, source: 'own', platform: 'youtube',
            ...p, engagement_rate: rate, signal: signalFor(rate),
          };
        }).filter(r => r.platform_post_id);
      } else {
        const analytics = await zernio.getAnalytics(acct.zernio_account_id, fromDate, toDate);
        const posts = Array.isArray(analytics) ? analytics : (analytics?.posts || analytics?.data || []);
        rows = posts.map(p => {
          // Zernio nests engagement metrics under p.analytics. Fall back to
          // top-level for tolerance against shape variations across platforms.
          const a = p.analytics || p.platforms?.[0]?.analytics || {};
          const views    = Number(a.views || a.impressions || p.views || p.impressions || 0);
          const likes    = Number(a.likes || p.likes || 0);
          const comments = Number(a.comments || p.comments || 0);
          const saves    = Number(a.saves || p.saves || 0);
          const shares   = Number(a.shares || p.shares || 0);
          // Prefer Zernio's pre-computed engagementRate when present.
          const rate = a.engagementRate != null
            ? Number(a.engagementRate)
            : engagementRate({ views, likes, comments, saves, shares });
          return {
            workspace_id: ws.id,
            source: 'own',
            platform: acct.platform,
            platform_post_id: String(p._id || p.id || p.postId || p.platforms?.[0]?.platformPostId || ''),
            post_type: p.type || p.mediaType || p.platforms?.[0]?.mediaType || null,
            caption: p.content || p.caption || p.title || null,
            posted_at: p.publishedAt || p.posted_at || p.created_at || p.scheduledFor || null,
            views, likes, comments, saves, shares,
            engagement_rate: rate,
            signal: signalFor(rate),
            raw_data: p,
          };
        }).filter(r => r.platform_post_id);
      }

      if (rows.length) {
        await supabase.upsert('posts', rows, { onConflict: 'workspace_id,platform,platform_post_id' });
        totalPosts += rows.length;
      }

      // Account snapshot
      const totalViews = rows.reduce((s, r) => s + (r.views || 0), 0);
      const avgViews = rows.length ? Math.round(totalViews / rows.length) : 0;
      const avgEng = rows.length
        ? Math.round((rows.reduce((s, r) => s + (r.engagement_rate || 0), 0) / rows.length) * 100) / 100
        : 0;
      snapshots.push({
        workspace_id: ws.id,
        platform: acct.platform,
        account_type: 'own',
        handle: acct.platform_username,
        snapshot_date: toDate,
        followers: acct.followers,
        avg_views_30d: avgViews,
        avg_eng_rate_30d: avgEng,
        total_views_30d: totalViews,
      });

      if (logRow) {
        await supabase.update('usage_log',
          { status: 'completed', records_fetched: rows.length },
          { eq: { id: logRow.id } }
        );
      }
    } catch (e) {
      failures.push({ platform: acct.platform, error: e.message });
      if (logRow) {
        await supabase.update('usage_log',
          { status: 'failed', records_fetched: 0 },
          { eq: { id: logRow.id } }
        ).catch(() => {});
      }
    }
  }

  if (snapshots.length) {
    await supabase.upsert('account_snapshots', snapshots, {
      onConflict: 'workspace_id,platform,handle,snapshot_date',
    }).catch(() => {});
  }

  // Ads — pull from Zernio /ads for each non-YT account. No-op when there are
  // no ads running, so it's safe to always run.
  let ads = null;
  try {
    ads = await pullAds(ws, accounts, { fromDate, toDate });
  } catch (e) {
    ads = { error: e.message };
  }

  // Tail: regenerate the AI brief if we have fresh data. Best-effort —
  // if Anthropic is down or out-of-budget we still return refresh success.
  let brief = null;
  if (totalPosts > 0) {
    try {
      brief = await generateBrief(ws);
    } catch (e) {
      brief = { error: e.message };
    }
  }

  return json(res, 200, {
    refreshed: accounts.length - failures.length,
    posts: totalPosts,
    failures,
    used: cap.used + accounts.length,
    limit: cap.limit,
    ads,
    brief,
  });
}
