// Consolidated accounts endpoint (replaces accounts/list, accounts/sync,
// disconnect — merged to free up Vercel slots).
//
//   GET    /api/accounts                       → list connected accounts (active only)
//   POST   /api/accounts                       → sync from Zernio + refresh followers
//   DELETE /api/accounts?id=... | platform=... → disconnect (Zernio + local soft-delete)

import { authenticate, json } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';
import { zernio, extractFollowers } from './_lib/zernio.js';

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  // ── GET: list connected accounts ──────────────────────────────────────
  if (req.method === 'GET') {
    const accounts = await supabase.select('connected_accounts', {
      select: '*',
      eq: { workspace_id: ws.id, is_active: true },
      order: 'connected_at.asc',
    }).catch(() => []);
    return json(res, 200, { accounts: accounts || [] });
  }

  // ── POST: sync from Zernio + refresh follower counts ──────────────────
  if (req.method === 'POST') {
    if (!ws.zernio_profile_id) return json(res, 200, { synced: 0, accounts: [] });

    let remote;
    try {
      remote = await zernio.listAccounts(ws.zernio_profile_id);
    } catch (e) {
      return json(res, e.status || 502, { error: `Zernio: ${e.message}` });
    }
    const list = Array.isArray(remote) ? remote : (remote?.accounts || remote?.data || []);

    // Build the upsert rows. We try three sources for follower counts, in
    // order of trust:
    //   1. Deep-walk the raw listAccounts payload (catches whatever nested
    //      shape Zernio uses for this platform).
    //   2. /accounts/{id}/follower-stats endpoint.
    //   3. Fall back to null + leave a diagnostic in metadata so we can see
    //      exactly what came back.
    const baseRows = list.map(a => ({
      workspace_id: ws.id,
      platform: a.platform || a.provider,
      zernio_account_id: a._id || a.id || a.accountId,
      platform_username: a.username || a.handle || a.name || null,
      platform_user_id: a.platformUserId || a.platform_user_id || a.userId || null,
      _raw: a,
      verified: !!a.verified,
      last_synced_at: new Date().toISOString(),
    })).filter(r => r.platform && r.zernio_account_id);

    // For each account: deep-walk first (free), then call follower-stats
    // only if the walk didn't find anything (saves N parallel requests on
    // platforms where Zernio /accounts already returns the count).
    const enriched = await Promise.all(baseRows.map(async (r) => {
      const fromList = extractFollowers(r._raw);
      let followers = fromList;
      let followerSource = fromList != null ? 'listAccounts' : null;
      let followerStatsRaw = null;
      if (followers == null) {
        try {
          followerStatsRaw = await zernio.getFollowerStats(r.zernio_account_id);
          const fromStats = extractFollowers(followerStatsRaw);
          if (fromStats != null) {
            followers = fromStats;
            followerSource = 'follower-stats';
          }
        } catch (e) {
          followerStatsRaw = { error: e.message };
        }
      }
      return {
        ...r,
        followers,
        metadata: {
          ...r._raw,
          _diag: {
            follower_source: followerSource,
            // When followers is still null, this is what we have to look at
            // in Supabase to figure out what Zernio actually sent us.
            follower_stats_raw: followerStatsRaw,
          },
        },
      };
    }));
    const rows = enriched.map(({ _raw, ...rest }) => rest);

    const existing = await supabase.select('connected_accounts', {
      select: 'zernio_account_id,platform',
      eq: { workspace_id: ws.id },
    }).catch(() => []);
    const existingIds = new Set((existing || []).map(r => r.zernio_account_id));

    if (rows.length) {
      try {
        await supabase.upsert('connected_accounts', rows, {
          onConflict: 'workspace_id,zernio_account_id',
        });
      } catch (e) {
        return json(res, 500, { error: `DB upsert failed: ${e.message}` });
      }
    }

    const accounts = await supabase.select('connected_accounts', {
      select: '*',
      eq: { workspace_id: ws.id },
      order: 'connected_at.asc',
    }).catch(() => []);

    const new_accounts = (accounts || [])
      .filter(a => !existingIds.has(a.zernio_account_id))
      .map(a => ({ platform: a.platform, handle: a.platform_username, id: a.id }));

    return json(res, 200, { synced: rows.length, accounts: accounts || [], new_accounts });
  }

  // ── DELETE: disconnect (Zernio + local soft-delete) ───────────────────
  if (req.method === 'DELETE') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const id = body?.id || req.query?.id;
    const platform = body?.platform || req.query?.platform;
    if (!id && !platform) return json(res, 400, { error: 'Provide either id or platform' });

    // Resolve which connected_accounts rows we're targeting so we can call
    // Zernio with each account's external ID.
    const filter = { workspace_id: ws.id };
    if (id) filter.id = id;
    if (platform && !id) filter.platform = platform;

    const targets = await supabase.select('connected_accounts', {
      select: '*', eq: filter,
    }).catch(() => []);

    // Best-effort Zernio removal — never block on it. YouTube has no Zernio
    // record, so skip those.
    const zernioErrors = [];
    await Promise.all((targets || []).map(async (acct) => {
      if (acct.platform === 'youtube') return;
      if (!acct.zernio_account_id) return;
      try {
        await zernio.disconnectAccount(acct.zernio_account_id);
      } catch (e) {
        zernioErrors.push({ id: acct.id, platform: acct.platform, error: e.message });
      }
    }));

    try {
      const updated = await supabase.update('connected_accounts',
        { is_active: false }, { eq: filter });
      return json(res, 200, {
        ok: true,
        disconnected: updated?.length || 0,
        zernio_errors: zernioErrors.length ? zernioErrors : undefined,
      });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  return json(res, 405, { error: 'Method not allowed' });
}
