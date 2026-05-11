// POST/DELETE /api/disconnect — soft-disconnect a connected social account.
// Marks is_active=false; keeps historical posts/snapshots for trend analysis.
//
// Body or query: { id: <connected_account_id> }  OR  { platform: <name> }
// (platform variant disconnects all accounts of that platform in the workspace).

import { authenticate, json } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const id = body?.id || req.query?.id;
  const platform = body?.platform || req.query?.platform;

  if (!id && !platform) {
    return json(res, 400, { error: 'Provide either id or platform' });
  }

  try {
    // Build the filter — but always also filter by workspace_id so callers
    // can't disconnect accounts they don't own.
    const filter = { workspace_id: ws.id };
    if (id) filter.id = id;
    if (platform && !id) filter.platform = platform;

    const updated = await supabase.update('connected_accounts',
      { is_active: false }, { eq: filter });

    return json(res, 200, {
      ok: true,
      disconnected: updated?.length || 0,
      accounts: updated || [],
    });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
}
