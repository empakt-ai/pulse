import { authenticate, json } from '../lib/auth.js';
import { supabase } from '../lib/supabase.js';
import { checkCompetitorCap } from '../lib/tiers.js';

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  if (req.method === 'GET') {
    const rows = await supabase.select('competitors', {
      select: '*',
      eq: { workspace_id: ws.id },
      order: 'created_at.desc',
    }).catch(() => []);
    return json(res, 200, { competitors: rows || [] });
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const { platform, handle, display_name } = body || {};
    if (!platform || !handle) return json(res, 400, { error: 'platform and handle are required' });

    const cap = await checkCompetitorCap(ws);
    if (cap.exceeded) {
      return json(res, 429, {
        error: `Competitor limit reached (${cap.limit}). Upgrade plan to track more.`,
        used: cap.used,
        limit: cap.limit,
      });
    }

    try {
      const inserted = await supabase.insert('competitors', {
        workspace_id: ws.id,
        platform,
        handle,
        display_name: display_name || handle,
      });
      return json(res, 200, { competitor: inserted?.[0] || null });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  if (req.method === 'DELETE') {
    const id = req.query?.id;
    if (!id) return json(res, 400, { error: 'id required' });
    try {
      await supabase.update('competitors', { is_active: false }, { eq: { id } });
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  return json(res, 405, { error: 'Method not allowed' });
}
