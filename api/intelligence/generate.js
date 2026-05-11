// POST /api/intelligence/generate — manually trigger an AI brief for the
// caller's workspace. Also runs automatically at the tail of /api/analytics/refresh
// and inside /api/cron/daily.

import { authenticate, json } from '../lib/auth.js';
import { generateBrief } from '../lib/intelligence.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  try {
    const result = await generateBrief(ws);
    if (result.error) return json(res, 502, { error: result.error, raw: result.raw });
    return json(res, 200, result);
  } catch (e) {
    return json(res, e.status || 500, { error: e.message });
  }
}
