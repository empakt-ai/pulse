// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Public list of workspace names that have opted in to
// being featured in the "Trusted by" marquee on the landing page. No
// auth — anyone can fetch the list. Returns names only — no handles,
// no follower counts, no platform breakdown.
//
// Workspaces opt in via Settings → Workspace settings (default off).
// ═════════════════════════════════════════════════════════════════════════

import { supabase } from './_lib/supabase.js';
import { json } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const rows = await supabase.select('workspaces', {
    select: 'name',
    eq: { featured_on_homepage: true },
    order: 'created_at.asc',
    limit: 50,
  }).catch(() => []);

  // De-dupe and trim. The marquee renders names as-typed but we keep
  // the visible set tidy by filtering empties + collapsing whitespace.
  const seen = new Set();
  const names = (rows || [])
    .map(r => String(r.name || '').trim())
    .filter(n => {
      if (!n) return false;
      const k = n.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  // Browser cache for 5 minutes — the marquee doesn't need real-time
  // freshness, and this keeps load off the database on the landing page.
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  return json(res, 200, { names });
}
