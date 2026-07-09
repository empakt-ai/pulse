// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Automation engine — the worker cron.
// ═════════════════════════════════════════════════════════════════════════
//
// Vercel Cron hits this every couple of minutes. It drains due
// automation_jobs: resuming runs whose randomized delay elapsed, and timing
// out follow-gate waits that never got a reply. When AUTOMATION_ENGINE is off
// (the P0 default) tick() returns immediately, so this endpoint is deployed
// and authenticated but does no DB work until the engine is switched on.
//
// Auth mirrors api/cron/hourly.js: Vercel injects `Authorization: Bearer
// ${CRON_SECRET}`; we timing-safe-compare and reject anything else.

import crypto from 'node:crypto';
import { json } from '../_lib/auth.js';
import { tick } from '../_lib/automation/index.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers?.authorization || '';
  const expected = secret ? `Bearer ${secret}` : '';
  if (!secret
      || header.length !== expected.length
      || !crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected))) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  try {
    const result = await tick({ limit: 25 });
    return json(res, 200, { ran_at: new Date().toISOString(), ...result });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
}
