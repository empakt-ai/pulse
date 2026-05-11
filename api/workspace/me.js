import { authenticate, json } from '../lib/auth.js';
import { supabase } from '../lib/supabase.js';
import { tierFor, getMonthlyUsage } from '../lib/tiers.js';

const ALLOWED_FIELDS = ['name', 'user_type', 'category', 'market', 'account_age'];

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });

  let workspace = auth.workspace;
  if (!workspace) {
    // Auto-create if the trigger didn't (defensive)
    const inserted = await supabase.insert('workspaces', {
      owner_id: auth.user.id,
      name: auth.user.email?.split('@')[0] || 'My Workspace',
      tier: 'creator',
    });
    workspace = inserted?.[0] || null;
    if (!workspace) return json(res, 500, { error: 'Workspace not found and could not be created' });
  }

  if (req.method === 'GET') {
    const tier = tierFor(workspace);
    const usage = await getMonthlyUsage(workspace.id).catch(() => ({ used: 0, cost_cents: 0 }));
    return json(res, 200, {
      workspace,
      tier: { ...tier, key: workspace.tier || 'creator' },
      usage: { used: usage.used, limit: tier.runs_per_month, cost_cents: usage.cost_cents },
    });
  }

  if (req.method === 'PATCH') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const patch = {};
    for (const k of ALLOWED_FIELDS) if (k in (body || {})) patch[k] = body[k];
    if (!Object.keys(patch).length) return json(res, 400, { error: 'No valid fields to update' });

    const rows = await supabase.update('workspaces', patch, { eq: { id: workspace.id } });
    return json(res, 200, { workspace: rows?.[0] || null });
  }

  return json(res, 405, { error: 'Method not allowed' });
}
