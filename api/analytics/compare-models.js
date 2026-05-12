// ═════════════════════════════════════════════════════════════════════════
// [PULSE-SPECIFIC] DEPRECATED for the Gemini-only phase.
// The endpoint used to run the same prompt through Claude + Gemini and
// return them side by side. With Gemini as the sole provider there is
// nothing to compare. We keep the route alive (rather than 404ing) so
// any cached Settings UI that still calls it gets a clean response
// instead of a network error, then it's removed.
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json } from '../_lib/auth.js';

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  return json(res, 410, {
    error: 'gone',
    message: 'Side-by-side model comparison is paused — PULSE briefs are currently Gemini-only. The Agency control on Settings is now a brief-tone selector.',
  });
}
