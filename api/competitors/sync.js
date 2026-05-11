// POST /api/competitors/sync — manually trigger Apify scraping for all active
// competitors in the caller's workspace. Body: { force?: boolean }

import { authenticate, json } from '../lib/auth.js';
import { syncCompetitorsForWorkspace } from '../lib/competitor-sync.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const force = !!body?.force;

  try {
    const result = await syncCompetitorsForWorkspace(ws, { force });
    return json(res, 200, result);
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
}
