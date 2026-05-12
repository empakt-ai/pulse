// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// Silent background sync triggered by the SPA on every authenticated load.
// No tier caps here — the 60-minute cooldown enforced server-side keeps
// this cheap-by-design. Also handles the first-connect backfill kick.
// ═════════════════════════════════════════════════════════════════════════
//
//   POST /api/sync              → incremental sync, 60-min cooldown
//   POST /api/sync?mode=backfill → first-connect backfill (no cooldown)
//
// Returns { ran: true, ...summary } when work happened, or
// { ran: false, reason: 'cooldown', minutesRemaining } when skipped.

import { authenticate, json } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';
import { runSync } from './_lib/sync.js';

// Default cooldown for non-agency tiers. Agency bypasses the cooldown
// entirely (15-min staleness instead — applied client-side via login flow).
const COOLDOWN_MINUTES = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  const mode = req.query?.mode === 'backfill' ? 'backfill' : 'incremental';
  const isAgency = (ws.tier || '').toLowerCase() === 'agency';

  // Cooldown only applies to incremental — backfill is one-shot per account
  // (gated by initial_sync_complete inside runSync) and always allowed.
  // Agency tier bypasses the cooldown entirely.
  if (mode === 'incremental' && !isAgency) {
    const accounts = await supabase.select('connected_accounts', {
      select: 'last_incremental_sync_at',
      eq: { workspace_id: ws.id, is_active: true },
    }).catch(() => []);
    if (!accounts?.length) {
      return json(res, 200, { ran: false, reason: 'no_accounts' });
    }
    const stamps = accounts
      .map(a => a.last_incremental_sync_at ? new Date(a.last_incremental_sync_at).getTime() : 0)
      .filter(Boolean);
    if (stamps.length === accounts.length) {
      const newest = Math.max(...stamps);
      const minutesSince = (Date.now() - newest) / 60000;
      if (minutesSince < COOLDOWN_MINUTES) {
        return json(res, 200, {
          ran: false, reason: 'cooldown',
          minutesRemaining: Math.ceil(COOLDOWN_MINUTES - minutesSince),
        });
      }
    }
  }

  const result = await runSync(ws, { mode });
  return json(res, 200, { ran: true, ...result });
}
