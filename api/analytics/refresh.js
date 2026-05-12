// ═════════════════════════════════════════════════════════════════════════
// [PULSE-SPECIFIC] Manual sync trigger. PULSE tier-based daily caps enforce
// fair use here (3 / 8 / unlimited). The actual data fetching is delegated
// to the shared runSync() — no intelligence work happens in this handler.
// Brief generation is a separate endpoint (/api/intelligence/generate) and
// runs only on its own cron schedule, not as a refresh tail.
// ═════════════════════════════════════════════════════════════════════════
//
// POST /api/analytics/refresh — manual sync trigger.
// Body (optional): { mode: 'incremental' | 'deep' }  — default 'incremental'.
// Returns the runSync() summary.

import { authenticate, json } from '../_lib/auth.js';
import { supabase } from '../_lib/supabase.js';
import { runSync } from '../_lib/sync.js';
import { tierFor } from '../_lib/tiers.js';

// Per-tier daily manual sync allowance. Background login syncs do NOT
// count against this — they're rate-limited naturally by the 60-min
// cooldown on the client.
const MANUAL_DAILY_CAP = {
  creator: 3,
  brand:   8,
  agency:  -1, // unlimited
};

function startOfTodayIso() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// Count today's manual_sync rows for this workspace.
async function manualSyncsToday(workspaceId) {
  const rows = await supabase.select('usage_log', {
    select: 'id,created_at,run_type',
    eq: { workspace_id: workspaceId, run_type: 'manual_sync' },
  }).catch(() => []);
  const since = startOfTodayIso();
  return (rows || []).filter(r => r.created_at >= since).length;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const mode = body?.mode === 'deep' ? 'deep' : 'incremental';

  // Tier cap — counts today's manual syncs only. Background login syncs
  // skip this endpoint entirely (they hit /api/sync instead).
  // Agency tier: explicit no-cap. We still check the lookup table for
  // defence-in-depth (agency maps to -1 = unlimited).
  const tier = tierFor(ws);
  const isAgency = (ws.tier || '').toLowerCase() === 'agency';
  if (!isAgency) {
    const cap = MANUAL_DAILY_CAP[ws.tier || 'creator'] ?? MANUAL_DAILY_CAP.creator;
    if (cap !== -1) {
      const used = await manualSyncsToday(ws.id);
      if (used >= cap) {
        return json(res, 429, {
          error: `Daily manual sync limit reached (${used}/${cap}). Resets at 00:00 UTC.`,
          used, limit: cap, tier: tier.label,
        });
      }
    }
  }

  // Log the run upfront so concurrent calls can't both slip past the cap.
  let logRow = null;
  try {
    const inserted = await supabase.insert('usage_log', {
      workspace_id: ws.id, run_type: 'manual_sync', status: 'running',
      run_at: new Date().toISOString(),
    });
    logRow = inserted?.[0];
  } catch {}

  const result = await runSync(ws, { mode });

  if (logRow) {
    await supabase.update('usage_log', {
      status: result.failed > 0 ? 'failed' : 'completed',
      records_fetched: result.posts,
    }, { eq: { id: logRow.id } }).catch(() => {});
  }

  return json(res, 200, result);
}
