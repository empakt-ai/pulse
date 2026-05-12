// ═════════════════════════════════════════════════════════════════════════
// [PULSE-SPECIFIC] Stays in this repo. This is the dashboard hydration
// endpoint — it joins raw shared data (accounts, posts, snapshots) with
// PULSE intelligence outputs (signals, verdict, intel score, today actions,
// posting heatmap, top-posts curation). The shaping done here is the PULSE
// product, not the platform. Content Studio will have its own equivalent.
// ═════════════════════════════════════════════════════════════════════════
//
// Consolidated read for the dashboard. Returns everything the SPA needs to
// hydrate Brief/Stats/Growth/Content/Intel/Targets/Settings in one call.

import { authenticate, json } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';
import { tierFor, getMonthlyUsage } from './_lib/tiers.js';
import { getMarketContext } from './_lib/market-context.js';

const PLATFORM_TO_ICON = {
  instagram: 'ig', tiktok: 'tt', youtube: 'yt',
  facebook: 'fb', linkedin: 'li', x: 'x', snapchat: 'sc',
};

function platformKey(p) { return PLATFORM_TO_ICON[p] || p; }

function buildHeatmap(posts) {
  // 6 rows (06-09, 09-12, 12-15, 15-18, 18-21, 21-00) × 7 cols (Mon..Sun)
  // Values 0-4: scaled engagement-rate average per bucket.
  const buckets = Array.from({ length: 6 }, () => Array(7).fill(0));
  const counts = Array.from({ length: 6 }, () => Array(7).fill(0));
  for (const p of posts) {
    if (!p.posted_at) continue;
    const d = new Date(p.posted_at);
    const h = d.getUTCHours();
    if (h < 6) continue;
    const row = Math.min(5, Math.floor((h - 6) / 3));
    const col = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
    buckets[row][col] += p.engagement_rate || 0;
    counts[row][col] += 1;
  }
  // Normalize → 0-4 scale
  let max = 0;
  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
    if (counts[r][c]) buckets[r][c] /= counts[r][c];
    if (buckets[r][c] > max) max = buckets[r][c];
  }
  return buckets.map(row => row.map(v => max ? Math.round((v / max) * 4) : 0));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  const [accounts, posts, snapshots, competitors, signals] = await Promise.all([
    supabase.select('connected_accounts', {
      select: '*', eq: { workspace_id: ws.id, is_active: true }, order: 'connected_at.asc',
    }).catch(() => []),
    supabase.select('posts', {
      select: '*', eq: { workspace_id: ws.id }, order: 'posted_at.desc', limit: 200,
    }).catch(() => []),
    supabase.select('account_snapshots', {
      select: '*', eq: { workspace_id: ws.id }, order: 'snapshot_date.desc', limit: 60,
    }).catch(() => []),
    supabase.select('competitors', {
      select: '*', eq: { workspace_id: ws.id }, order: 'added_at.desc',
    }).catch(() => []),
    supabase.select('signals', {
      select: '*', eq: { workspace_id: ws.id }, order: 'generated_at.desc', limit: 20,
    }).catch(() => []),
  ]);

  // Split organic posts from ads. Ads live in the same table with post_type='ad'.
  const ownPosts = (posts || []).filter(p => p.source === 'own' && p.post_type !== 'ad');
  const ownAds = (posts || []).filter(p => p.source === 'own' && p.post_type === 'ad');
  const tier = tierFor(ws);
  const usage = await getMonthlyUsage(ws.id).catch(() => ({ used: 0, cost_cents: 0 }));

  // Aggregate ad performance for the dashboard. Only meaningful when ads exist.
  const totalSpend = ownAds.reduce((s, p) => s + Number(p.raw_data?.spend || 0), 0);
  const totalAdImpressions = ownAds.reduce((s, p) => s + Number(p.views || 0), 0);
  const totalAdClicks = ownAds.reduce((s, p) => s + Number(p.raw_data?.clicks || 0), 0);
  const avgCtr = ownAds.length
    ? Math.round((ownAds.reduce((s, p) => s + Number(p.engagement_rate || 0), 0) / ownAds.length) * 100) / 100
    : 0;
  // Per-platform aggregation — drives the platform breakdown cards on
  // the Ads dashboard. Sum spend/impressions/clicks per platform, then
  // recompute CTR from the totals (averaging per-ad CTRs would skew
  // toward tiny ads with anomalous rates).
  const perPlatformMap = {};
  for (const a of ownAds) {
    const pk = platformKey(a.platform);
    const row = perPlatformMap[pk] || (perPlatformMap[pk] = {
      platform: pk, count: 0, spend: 0, impressions: 0, clicks: 0,
    });
    row.count += 1;
    row.spend += Number(a.raw_data?.spend || 0);
    row.impressions += Number(a.views || 0);
    row.clicks += Number(a.raw_data?.clicks || 0);
  }
  const per_platform = Object.values(perPlatformMap).map(r => ({
    ...r,
    spend: Math.round(r.spend * 100) / 100,
    ctr: r.impressions ? Math.round((r.clicks / r.impressions) * 10000) / 100 : 0,
  })).sort((a, b) => b.spend - a.spend);

  const adsSummary = {
    count: ownAds.length,
    total_spend: Math.round(totalSpend * 100) / 100,
    total_impressions: totalAdImpressions,
    total_clicks: totalAdClicks,
    avg_ctr: avgCtr,
    currency: ownAds[0]?.raw_data?.currency || 'USD',
    per_platform,
    top: [...ownAds]
      .sort((a, b) => Number(b.raw_data?.spend || 0) - Number(a.raw_data?.spend || 0))
      .slice(0, 5)
      .map(p => ({
        id: p.id,
        platform: platformKey(p.platform),
        name: p.caption,
        spend: Number(p.raw_data?.spend || 0),
        impressions: Number(p.views || 0),
        clicks: Number(p.raw_data?.clicks || 0),
        ctr: Number(p.engagement_rate || 0),
        status: p.raw_data?.status || null,
      })),
  };

  // Build per-platform account summary keyed the way the prototype expects.
  // Adds engRate30d (derived from posts) and follower_history (last 7 daily
  // snapshots) so the Brief stat cards can render sparklines + deltas
  // without an extra round-trip.
  const NOW_MS = Date.now();
  const D30  = 30 * 86400000;
  const accountSummary = {};
  for (const a of (accounts || [])) {
    const key = platformKey(a.platform);
    const latestSnap = (snapshots || []).find(s => s.platform === a.platform && s.account_type === 'own');

    // Last 7 own-account snapshots for the sparkline (oldest → newest).
    const ownSnaps = (snapshots || [])
      .filter(s => s.platform === a.platform && s.account_type === 'own')
      .sort((x, y) => String(x.snapshot_date).localeCompare(String(y.snapshot_date)));
    const history7 = ownSnaps.slice(-7).map(s => ({
      date: s.snapshot_date,
      followers: s.followers || 0,
    }));
    // Week-over-week delta from the snapshot series (current vs ~7d ago).
    let wow_followers = 0;
    if (ownSnaps.length >= 2) {
      const latest = ownSnaps[ownSnaps.length - 1];
      const targetTs = new Date(latest.snapshot_date).getTime() - 7 * 86400000;
      const baseline = [...ownSnaps].reverse().find(s => new Date(s.snapshot_date).getTime() <= targetTs)
        || ownSnaps[0];
      wow_followers = (latest.followers || 0) - (baseline.followers || 0);
    }

    // Per-platform engagement rate over the last 30 days, computed from
    // actual posts (more accurate than the cached snapshot value when the
    // last sync didn't fully refresh).
    const platPosts30 = ownPosts.filter(p =>
      p.platform === a.platform && p.posted_at &&
      (NOW_MS - new Date(p.posted_at).getTime()) <= D30 && Number(p.views || 0) > 0
    );
    const sumViews30 = platPosts30.reduce((s, p) => s + Number(p.views || 0), 0);
    const sumEng30 = platPosts30.reduce((s, p) =>
      s + Number(p.likes || 0) + Number(p.comments || 0) + Number(p.saves || 0) + Number(p.shares || 0), 0);
    const engRate30 = sumViews30 ? Math.round((sumEng30 / sumViews30) * 10000) / 100 : 0;

    accountSummary[key] = {
      platform: a.platform,
      handle: a.platform_username ? `@${a.platform_username.replace(/^@/, '')}` : null,
      name: a.platform_username || null,
      followers: a.followers || 0,
      verified: a.verified,
      avgViews: latestSnap?.avg_views_30d || 0,
      avgEngRate: latestSnap?.avg_eng_rate_30d || 0,
      engRate30d: engRate30,
      reach30d: sumViews30,
      totalViews4W: latestSnap?.total_views_30d || 0,
      posts: ownPosts.filter(p => p.platform === a.platform).length,
      posts30d: platPosts30.length,
      followerHistory7d: history7,
      wowFollowers: wow_followers,
      lastSyncedAt: a.last_synced_at,
    };
  }

  // ── Aggregated brief metrics — drives the Brief screen stat cards ───────
  // All windows are inclusive: 30d = last 30 days; prev30d = the 30 days
  // before that. We compute these once on the server so the front-end
  // doesn't need access to the full posts/snapshots history.
  const briefMetrics = (() => {
    const inWindow = (p, fromMs, toMs) => {
      if (!p.posted_at) return false;
      const ts = new Date(p.posted_at).getTime();
      return ts >= fromMs && ts < toMs;
    };
    const now = NOW_MS;
    const win30  = [now - D30, now];
    const winPrev = [now - 2 * D30, now - D30];

    const posts30  = ownPosts.filter(p => inWindow(p, ...win30));
    const postsPrev = ownPosts.filter(p => inWindow(p, ...winPrev));

    const sumViews = (arr) => arr.reduce((s, p) => s + Number(p.views || 0), 0);
    const sumEng = (arr) => arr.reduce((s, p) =>
      s + Number(p.likes || 0) + Number(p.comments || 0) + Number(p.saves || 0) + Number(p.shares || 0), 0);
    const rate = (a, v) => v ? Math.round((a / v) * 10000) / 100 : 0;

    const reach30 = sumViews(posts30);
    const reachPrev = sumViews(postsPrev);
    const reachDelta = reachPrev ? Math.round(((reach30 - reachPrev) / reachPrev) * 1000) / 10 : null;

    const eng30 = rate(sumEng(posts30), reach30);
    const engPrev = rate(sumEng(postsPrev), reachPrev);
    const engDelta = engPrev ? Math.round(((eng30 - engPrev) / engPrev) * 1000) / 10 : null;

    // Per-platform reach (30d) and engagement rate (30d). Map keyed by the
    // platform short keys the UI uses (ig / tt / yt / li / fb / x / sc).
    const reachByPlat = {};
    const engRateByPlat = {};
    for (const p of posts30) {
      const k = platformKey(p.platform);
      reachByPlat[k] = (reachByPlat[k] || 0) + Number(p.views || 0);
    }
    for (const [k, _] of Object.entries(reachByPlat)) {
      const platPosts = posts30.filter(p => platformKey(p.platform) === k);
      engRateByPlat[k] = rate(sumEng(platPosts), sumViews(platPosts));
    }

    // Signals: count by severity and surface the highest-priority unread title.
    const unread = (signals || []).filter(s => !s.is_read && s.kind !== 'verdict' && s.kind !== 'action');
    const sevOf = (s) => {
      const i = String(s.impact || '').toLowerCase();
      if (/warning|critical|risk/.test(i)) return 'critical';
      if (/high/.test(i)) return 'high';
      if (/strategic|core/.test(i)) return 'strategic';
      return 'other';
    };
    const sigBreakdown = { critical: 0, high: 0, strategic: 0, other: 0 };
    for (const s of unread) sigBreakdown[sevOf(s)] = (sigBreakdown[sevOf(s)] || 0) + 1;
    // Priority order: critical > high > strategic > other
    const priorityOrder = { critical: 0, high: 1, strategic: 2, other: 3 };
    const topSignal = [...unread].sort((a, b) =>
      priorityOrder[sevOf(a)] - priorityOrder[sevOf(b)]
    )[0] || null;

    // Category-level engagement benchmarks (rough, public-data-derived).
    // Used as a "your category averages X%" context line under the eng card.
    const CATEGORY_BENCHMARK = {
      music: 1.6, fashion: 1.4, food: 1.2, ecommerce: 0.8, tech: 0.7,
      gaming: 2.0, fitness: 1.8, education: 1.1, finance: 0.6, comedy: 2.5,
      sports: 1.5, beauty: 1.6, parenting: 1.4, travel: 1.3, art: 1.7,
    };
    const benchmark = CATEGORY_BENCHMARK[ws.category] || 1.0;

    return {
      reach:      { total_30d: reach30, total_prev_30d: reachPrev, delta_pct: reachDelta, by_platform: reachByPlat },
      engagement: { avg_rate_30d: eng30, avg_rate_prev_30d: engPrev, delta_pct: engDelta, by_platform: engRateByPlat, benchmark_pct: benchmark },
      signals:    { total: unread.length, breakdown: sigBreakdown, top_unread: topSignal ? { kind: topSignal.kind, title: topSignal.title, platform: platformKey(topSignal.platform) } : null },
    };
  })();

  // Top posts for Content / Stats screens (last 30 days, sorted by views).
  const topPosts = [...ownPosts]
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, 12)
    .map(p => ({
      id: p.id,
      platform: platformKey(p.platform),
      type: p.post_type || 'post',
      title: p.caption ? p.caption.slice(0, 80) : 'Untitled post',
      daysAgo: p.posted_at ? Math.max(0, Math.floor((Date.now() - new Date(p.posted_at).getTime()) / 86400000)) : null,
      views: p.views || 0,
      likes: p.likes || 0,
      comments: p.comments || 0,
      saves: p.saves || 0,
      shares: p.shares || 0,
      engRate: p.engagement_rate || 0,
      signal: p.signal || 'steady',
      emoji: p.signal === 'viral' ? '⚡' : p.signal === 'rising' ? '🚀' : '📊',
    }));

  // Latest sync time across all accounts
  const lastSync = (accounts || [])
    .map(a => a.last_synced_at)
    .filter(Boolean)
    .sort()
    .pop();

  return json(res, 200, {
    workspace: ws,
    workspaces: auth.workspaces || [],
    user: {
      id: auth.user.id,
      email: auth.user.email,
      // Prefer the explicit first_name captured during onboarding, then the
      // first word of full_name from any OAuth provider, then the email
      // prefix as the last-resort fallback.
      name: auth.user.user_metadata?.first_name
         || (auth.user.user_metadata?.full_name || '').split(' ')[0]
         || auth.user.email?.split('@')[0],
      first_name: auth.user.user_metadata?.first_name || null,
    },
    tier: { ...tier, key: ws.tier || 'creator' },
    usage: { used: usage.used, limit: tier.runs_per_month },
    accounts: accounts || [],
    accountSummary,
    briefMetrics,
    ads: adsSummary,
    competitors: (competitors || []).map(c => {
      // 7-day delta from account_snapshots (account_type='competitor')
      const compSnaps = (snapshots || [])
        .filter(s => s.account_type === 'competitor' && s.platform === c.platform && s.handle === c.handle)
        .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
      let delta = 0;
      if (compSnaps.length >= 2) {
        const latest = compSnaps[compSnaps.length - 1];
        // Find a snapshot ~7 days older than latest
        const targetTs = new Date(latest.snapshot_date).getTime() - 7 * 86400000;
        const baseline = [...compSnaps].reverse().find(s => new Date(s.snapshot_date).getTime() <= targetTs)
          || compSnaps[0];
        if (baseline.followers > 0) {
          delta = Math.round(((latest.followers - baseline.followers) / baseline.followers) * 1000) / 10;
        }
      }
      return {
        handle: c.handle,
        display_name: c.display_name,
        platform: platformKey(c.platform),
        followers: c.followers || 0,
        delta,
      };
    }),
    posts: topPosts,
    snapshots: snapshots || [],
    // Segregate signals by kind. Verdict + actions live in signals table with
    // custom kinds; everything else is the stream the Intel screen renders.
    verdict: (() => {
      const v = (signals || []).find(s => s.kind === 'verdict' && !s.is_read);
      if (!v) return null;
      return {
        title: v.title, body: v.body,
        generated_at: v.metadata?.generated_at || v.generated_at,
        model: v.metadata?.model,
        // Workspace timezone is needed by the SPA to render the "generated at"
        // label in the user's local clock rather than UTC.
        timezone: ws.timezone || 'UTC',
        score_factors: v.metadata?.score_factors || [],
      };
    })(),
    // Distilled "do this exact thing" playbook — 4 ingredients (hook,
    // differentiator, caption structure, niche territory). Returned by the
    // AI in the same brief generation. Null until the next brief regenerates
    // because older verdict rows don't have it in metadata.
    formula: (() => {
      const v = (signals || []).find(s => s.kind === 'verdict' && !s.is_read);
      return v?.metadata?.formula || null;
    })(),
    // Strategic rewrite — pairs a competitor's top post with one of the
    // user's posts, plus an AI rewrite in the winning structure. Null
    // until the next brief regenerates with the extended schema.
    rewrite: (() => {
      const v = (signals || []).find(s => s.kind === 'verdict' && !s.is_read);
      return v?.metadata?.rewrite || null;
    })(),
    // Market context — TAM + platform usage signals for the workspace's
    // country. Null when country isn't set or isn't in our reference set.
    marketContext: getMarketContext(ws.country),
    // Full action plan — every action from the current brief, sorted by
    // the urgency order the model returned them in. The Action Plan screen
    // groups these by `when` into Now/Today/This week/This month buckets.
    actionPlan: (signals || [])
      .filter(s => s.kind === 'action' && !s.is_read)
      .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0))
      .map((a, i) => ({
        id: `a${i + 1}`,
        when: a.metadata?.when || a.impact || 'Today',
        icon: a.metadata?.icon || 'sparkle',
        title: a.title,
        body: a.body,
        cta: a.action,
      })),
    // Today's Top 3 — what the Brief / Intel screens splash above the fold.
    // Same source, just the urgent slice. Keeping a separate field so
    // existing screens don't need to change their data binding.
    todayActions: (signals || [])
      .filter(s => s.kind === 'action' && !s.is_read)
      .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0))
      .slice(0, 3)
      .map((a, i) => ({
        id: `a${i + 1}`,
        when: a.metadata?.when || a.impact || 'Today',
        urgency: i === 0 ? 'urgent' : i === 1 ? 'schedule' : 'optional',
        icon: a.metadata?.icon || 'sparkle',
        title: a.title,
        body: a.body,
        cta: a.action,
      })),
    signals: (signals || [])
      .filter(s => s.kind !== 'verdict' && s.kind !== 'action' && !s.is_read)
      .map(s => ({
        id: s.id,
        kind: s.kind,
        platform: s.platform === 'all' ? 'all' : platformKey(s.platform),
        label: s.title,
        title: s.title,
        body: s.body,
        impact: s.impact || 'Strategic',
        action: s.action || 'Review',
      })),
    intelScore: (() => {
      const v = (signals || []).find(s => s.kind === 'verdict' && !s.is_read);
      return v?.metadata?.intel_score || null;
    })(),
    lastSync,
    heatmap: buildHeatmap(ownPosts),
    state: {
      hasAccounts: (accounts || []).length > 0,
      hasPosts: ownPosts.length > 0,
      hasSignals: (signals || []).some(s => s.kind === 'verdict' && !s.is_read),
    },
  });
}
