import { authenticate, json } from '../_lib/auth.js';
import { supabase } from '../_lib/supabase.js';
import { zernio } from '../_lib/zernio.js';
import { checkUsageCap } from '../_lib/tiers.js';
import { generateBrief } from '../_lib/intelligence.js';

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
      const analytics = await zernio.getAnalytics(acct.zernio_account_id, fromDate, toDate);
      const posts = Array.isArray(analytics) ? analytics : (analytics?.posts || analytics?.data || []);

      const rows = posts.map(p => {
        const rate = engagementRate(p);
        return {
          workspace_id: ws.id,
          source: 'own',
          platform: acct.platform,
          platform_post_id: String(p.id || p.postId || p.platform_post_id || ''),
          post_type: p.type || p.mediaType || null,
          caption: p.caption || p.title || null,
          posted_at: p.posted_at || p.publishedAt || p.created_at || null,
          views: Number(p.views || p.impressions || 0),
          likes: Number(p.likes || 0),
          comments: Number(p.comments || 0),
          saves: Number(p.saves || 0),
          shares: Number(p.shares || 0),
          engagement_rate: rate,
          signal: signalFor(rate),
          raw_data: p,
        };
      }).filter(r => r.platform_post_id);

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
    brief,
  });
}
