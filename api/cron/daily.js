// Daily cron — iterates every workspace with a Zernio profile,
// syncs accounts, refreshes analytics. Vercel Cron triggers this at 06:00 UTC.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically
// when you set CRON_SECRET as an env var. Reject any call without it.

import { supabase } from '../lib/supabase.js';
import { zernio } from '../lib/zernio.js';
import { json } from '../lib/auth.js';

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
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

async function refreshWorkspace(ws) {
  if (!ws.zernio_profile_id) return { workspace_id: ws.id, skipped: 'no_profile' };

  // 1) sync accounts
  let accounts;
  try {
    const remote = await zernio.listAccounts(ws.zernio_profile_id);
    const list = Array.isArray(remote) ? remote : (remote?.accounts || remote?.data || []);
    const rows = list.map(a => ({
      workspace_id: ws.id,
      platform: a.platform || a.provider,
      zernio_account_id: a._id || a.id || a.accountId,
      platform_username: a.username || a.handle || a.name || null,
      platform_user_id: a.platformUserId || a.platform_user_id || a.userId || null,
      followers: a.followers ?? a.followerCount ?? null,
      verified: !!a.verified,
      last_synced_at: new Date().toISOString(),
      metadata: a,
    })).filter(r => r.platform && r.zernio_account_id);
    if (rows.length) {
      await supabase.upsert('connected_accounts', rows, {
        onConflict: 'workspace_id,zernio_account_id',
      });
    }
    accounts = await supabase.select('connected_accounts', {
      select: '*', eq: { workspace_id: ws.id },
    });
  } catch (e) {
    return { workspace_id: ws.id, error: `account sync: ${e.message}` };
  }

  if (!accounts?.length) return { workspace_id: ws.id, accounts: 0, posts: 0 };

  // 2) refresh analytics per account
  const fromDate = daysAgo(30);
  const toDate = daysAgo(0);
  let totalPosts = 0;
  const snapshots = [];

  for (const acct of accounts) {
    let logRow = null;
    try {
      const inserted = await supabase.insert('usage_log', {
        workspace_id: ws.id, run_type: 'analytics', platform: acct.platform, status: 'running',
      });
      logRow = inserted?.[0];
    } catch {}

    try {
      const analytics = await zernio.getAnalytics(acct.zernio_account_id, fromDate, toDate);
      const posts = Array.isArray(analytics) ? analytics : (analytics?.posts || analytics?.data || []);
      const postRows = posts.map(p => {
        const rate = engagementRate(p);
        return {
          workspace_id: ws.id, source: 'own', platform: acct.platform,
          platform_post_id: String(p.id || p._id || p.postId || ''),
          post_type: p.type || p.mediaType || null,
          caption: p.caption || p.title || null,
          posted_at: p.posted_at || p.publishedAt || p.created_at || null,
          views: Number(p.views || p.impressions || 0),
          likes: Number(p.likes || 0), comments: Number(p.comments || 0),
          saves: Number(p.saves || 0), shares: Number(p.shares || 0),
          engagement_rate: rate, signal: signalFor(rate), raw_data: p,
        };
      }).filter(r => r.platform_post_id);

      if (postRows.length) {
        await supabase.upsert('posts', postRows, { onConflict: 'workspace_id,platform,platform_post_id' });
        totalPosts += postRows.length;
      }

      const totalViews = postRows.reduce((s, r) => s + (r.views || 0), 0);
      const avgViews = postRows.length ? Math.round(totalViews / postRows.length) : 0;
      const avgEng = postRows.length
        ? Math.round((postRows.reduce((s, r) => s + (r.engagement_rate || 0), 0) / postRows.length) * 100) / 100
        : 0;
      snapshots.push({
        workspace_id: ws.id, platform: acct.platform, account_type: 'own',
        handle: acct.platform_username, snapshot_date: toDate,
        followers: acct.followers, avg_views_30d: avgViews,
        avg_eng_rate_30d: avgEng, total_views_30d: totalViews,
      });

      if (logRow) {
        await supabase.update('usage_log',
          { status: 'completed', records_fetched: postRows.length },
          { eq: { id: logRow.id } }).catch(() => {});
      }
    } catch (e) {
      if (logRow) {
        await supabase.update('usage_log',
          { status: 'failed' }, { eq: { id: logRow.id } }).catch(() => {});
      }
    }
  }

  if (snapshots.length) {
    await supabase.upsert('account_snapshots', snapshots, {
      onConflict: 'workspace_id,platform,handle,snapshot_date',
    }).catch(() => {});
  }

  return { workspace_id: ws.id, accounts: accounts.length, posts: totalPosts };
}

export default async function handler(req, res) {
  // Auth: CRON_SECRET via Bearer header (Vercel Cron injects this).
  const secret = process.env.CRON_SECRET;
  const header = req.headers?.authorization || '';
  if (!secret || header !== `Bearer ${secret}`) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  const workspaces = await supabase.select('workspaces', {
    select: 'id,zernio_profile_id,tier',
  }).catch(() => []);

  // Sequential to stay under serverless concurrency limits; 60s max duration.
  const results = [];
  for (const ws of (workspaces || [])) {
    if (!ws.zernio_profile_id) continue;
    try {
      results.push(await refreshWorkspace(ws));
    } catch (e) {
      results.push({ workspace_id: ws.id, error: e.message });
    }
  }

  return json(res, 200, {
    ran_at: new Date().toISOString(),
    workspaces: results.length,
    results,
  });
}
