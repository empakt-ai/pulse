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
  const adsSummary = {
    count: ownAds.length,
    total_spend: Math.round(totalSpend * 100) / 100,
    total_impressions: totalAdImpressions,
    total_clicks: totalAdClicks,
    avg_ctr: avgCtr,
    currency: ownAds[0]?.raw_data?.currency || 'USD',
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
  const accountSummary = {};
  for (const a of (accounts || [])) {
    const key = platformKey(a.platform);
    const latestSnap = (snapshots || []).find(s => s.platform === a.platform && s.account_type === 'own');
    accountSummary[key] = {
      platform: a.platform,
      handle: a.platform_username ? `@${a.platform_username.replace(/^@/, '')}` : null,
      name: a.platform_username || null,
      followers: a.followers || 0,
      verified: a.verified,
      avgViews: latestSnap?.avg_views_30d || 0,
      avgEngRate: latestSnap?.avg_eng_rate_30d || 0,
      totalViews4W: latestSnap?.total_views_30d || 0,
      posts: ownPosts.filter(p => p.platform === a.platform).length,
      lastSyncedAt: a.last_synced_at,
    };
  }

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
        score_factors: v.metadata?.score_factors || [],
      };
    })(),
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
