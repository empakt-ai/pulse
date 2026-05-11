import { authenticate, json } from '../lib/auth.js';
import { supabase } from '../lib/supabase.js';
import { zernio } from '../lib/zernio.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  if (!ws.zernio_profile_id) {
    return json(res, 200, { synced: 0, accounts: [] });
  }

  let remote;
  try {
    remote = await zernio.listAccounts(ws.zernio_profile_id);
  } catch (e) {
    return json(res, e.status || 502, { error: `Zernio: ${e.message}` });
  }

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

  // Snapshot existing zernio_account_ids so we can detect what's new on this sync.
  const existing = await supabase.select('connected_accounts', {
    select: 'zernio_account_id,platform',
    eq: { workspace_id: ws.id },
  }).catch(() => []);
  const existingIds = new Set((existing || []).map(r => r.zernio_account_id));

  let saved = [];
  if (rows.length) {
    try {
      saved = await supabase.upsert('connected_accounts', rows, {
        onConflict: 'workspace_id,zernio_account_id',
      });
    } catch (e) {
      return json(res, 500, { error: `DB upsert failed: ${e.message}` });
    }
  }

  // Always return the canonical list from DB
  const accounts = await supabase.select('connected_accounts', {
    select: '*',
    eq: { workspace_id: ws.id },
    order: 'created_at.asc',
  }).catch(() => saved);

  // Newly-inserted accounts (i.e. just connected on this sync call)
  const new_accounts = (accounts || [])
    .filter(a => !existingIds.has(a.zernio_account_id))
    .map(a => ({ platform: a.platform, handle: a.platform_username, id: a.id }));

  return json(res, 200, { synced: rows.length, accounts: accounts || [], new_accounts });
}
