// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Ad Intelligence settings for a workspace.
//
//   GET   /api/workspace/ad-settings
//     → { settings: { goal, category, regions, network_opt_in } | null }
//
//   PATCH /api/workspace/ad-settings
//     body: { goal?, category?, regions?, network_opt_in? }
//     → { settings: <updated row> }
//
// Settings drive everything in the ads-intel module: benchmark lookups,
// spot scores, and the recommendation engine. Row is created on first
// PATCH; null when never configured.
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json } from '../_lib/auth.js';
import { supabase } from '../_lib/supabase.js';
import { assertRole } from '../_lib/permissions.js';

const VALID_GOALS = new Set(['sales', 'leads', 'awareness', 'followers', 'traffic']);
const VALID_CATEGORIES = new Set([
  'food_beverage', 'automotive', 'fashion', 'saas', 'health_wellness',
  'real_estate', 'finance', 'retail', 'media', 'other',
]);

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  if (req.method === 'GET') {
    const settings = await supabase.select('workspace_ad_settings', {
      select: 'goal,category,regions,network_opt_in',
      eq: { workspace_id: ws.id },
      single: true,
    }).catch(() => null);
    return json(res, 200, { settings: settings || null });
  }

  if (req.method === 'PATCH') {
    const denied = assertRole(auth, 'admin');
    if (denied) return json(res, denied.status, denied.body);

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const update = { workspace_id: ws.id, updated_at: new Date().toISOString() };
    if ('goal' in body) {
      const g = body.goal == null ? null : String(body.goal).toLowerCase();
      if (g && !VALID_GOALS.has(g)) {
        return json(res, 400, { error: `goal must be one of ${[...VALID_GOALS].join(', ')}` });
      }
      update.goal = g;
    }
    if ('category' in body) {
      const c = body.category == null ? null : String(body.category).toLowerCase();
      if (c && !VALID_CATEGORIES.has(c)) {
        return json(res, 400, { error: `category must be one of ${[...VALID_CATEGORIES].join(', ')}` });
      }
      update.category = c;
    }
    if ('regions' in body) {
      if (body.regions != null && !Array.isArray(body.regions)) {
        return json(res, 400, { error: 'regions must be an array of region codes' });
      }
      update.regions = body.regions || null;
    }
    if ('network_opt_in' in body) {
      update.network_opt_in = !!body.network_opt_in;
    }

    try {
      const rows = await supabase.upsert('workspace_ad_settings', update, {
        onConflict: 'workspace_id',
      });
      return json(res, 200, { settings: rows?.[0] || null });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  return json(res, 405, { error: 'Method not allowed' });
}
