// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Stays in this repo. Manual trigger for the Mashal AI
// brief. After the platform extraction this stays a Mashal endpoint that
// reads from the shared posts/account_snapshots tables.
// ═════════════════════════════════════════════════════════════════════════
//
// POST /api/intelligence/generate — manually trigger an AI brief for the
// caller's workspace. Also runs automatically at the tail of /api/analytics/refresh
// and inside /api/cron/daily.

import { authenticate, json } from '../_lib/auth.js';
import { generateBrief } from '../_lib/intelligence.js';
import { assertRole } from '../_lib/permissions.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  // Regenerating the brief spends the workspace's monthly quota and
  // mutates the signals feed — member+ only. Viewers (clients) see the
  // current brief read-only and can't burn the quota.
  const denied = assertRole(auth, 'member');
  if (denied) return json(res, denied.status, denied.body);

  // Auto-fire paths (Agency session-start regen, first-brief bootstrap,
  // cron passing through here in future) tag themselves with ?source=auto
  // so the run records as 'intelligence_auto' and stays out of the
  // monthly quota counter. Anything else is treated as a user click.
  const source = (req.query?.source || '').toString().toLowerCase();
  const manual = source !== 'auto';

  try {
    const result = await generateBrief(ws, { manual });
    // Forward the WHOLE result on error so the UI panel sees message/details
    // (e.g. the underlying SQL error from a persist failure). Keep status 200
    // so the browser api() helper doesn't throw and discard the body.
    if (result.error) return json(res, 200, { ok: false, ...result });
    return json(res, 200, { ok: true, ...result });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message });
  }
}
