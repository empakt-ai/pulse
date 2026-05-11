// Multi-workspace endpoint. A user may own multiple workspaces — each one is
// effectively a separate subscription (separate account slots, competitor
// quota, AI run quota). The active workspace for any request is selected via
// the `x-workspace-id` header (see api/_lib/auth.js).
//
//   GET    /api/workspaces            → list owned workspaces
//   POST   /api/workspaces  { name }  → create a new workspace

import { authenticate, json } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });

  if (req.method === 'GET') {
    return json(res, 200, {
      workspaces: auth.workspaces || [],
      active_id: auth.workspace?.id || null,
    });
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const name = (body?.name || '').trim();
    if (!name) return json(res, 400, { error: 'name is required' });

    try {
      const inserted = await supabase.insert('workspaces', {
        owner_id: auth.user.id,
        name,
        // Each new workspace defaults to creator tier. When Stripe is wired
        // up (Phase 6), tier comes from the subscription the user purchases
        // for this specific workspace.
        tier: body?.tier || 'creator',
        user_type: body?.user_type || 'creator',
        category: body?.category || null,
        country: body?.country || null,
      });
      return json(res, 200, { workspace: inserted?.[0] || null });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  return json(res, 405, { error: 'Method not allowed' });
}
