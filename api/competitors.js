// ═════════════════════════════════════════════════════════════════════════
// [MIXED] Mostly SHARED — generic competitor-handle CRUD over a generic
// schema — with one PULSE-specific touch: the cap on how many competitors
// a workspace can track comes from PULSE's pricing tiers.
//
//   SHARED (move to platform service):
//     • GET/POST/DELETE on the competitors table
//     • action='sync' trigger that calls syncCompetitorsForWorkspace()
//
//   PULSE-SPECIFIC (stays here):
//     • checkCompetitorCap() — uses PULSE tier limits (5/15/50)
//
// Proposed split: shared service exposes raw CRUD; PULSE wraps it with a
// thin auth/quota check before forwarding.
// ═════════════════════════════════════════════════════════════════════════
//
// Consolidated competitors endpoint (merged to stay under Vercel Hobby's
// 12-function deployment limit).
//
//   GET  /api/competitors                      → list competitors
//   POST /api/competitors  {platform, handle}  → add
//   POST /api/competitors  {action: 'sync'}    → trigger Apify scrape
//   DELETE /api/competitors?id=...             → soft-delete (is_active=false)

import { authenticate, json } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';
import { checkCompetitorCap } from './_lib/tiers.js';
import { syncCompetitorsForWorkspace } from './_lib/competitor-sync.js';

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  if (req.method === 'GET') {
    const rows = await supabase.select('competitors', {
      select: '*',
      eq: { workspace_id: ws.id },
      order: 'added_at.desc',
    }).catch(() => []);
    return json(res, 200, { competitors: rows || [] });
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

    // Sync mode — Apify scrape all active competitors
    if (body?.action === 'sync') {
      try {
        const result = await syncCompetitorsForWorkspace(ws, { force: !!body.force });
        return json(res, 200, result);
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }

    // Add mode
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
