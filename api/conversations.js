// ═════════════════════════════════════════════════════════════════════════
// [Mashal] Conversations — read-only inbox surface (Brand / Agency).
//
// Returns the workspace's incoming DMs / comments / reviews from inbox_events
// (fed by the Zernio webhook) plus lightweight messaging analytics computed
// locally from those rows. READ ONLY — no replies, no outbound, no templates.
//
// Phase 1 reads only inbox_events (a known, already-populated shape). A later
// phase will enrich with Zernio's live /inbox/* threads + /analytics/inbox/*
// endpoints once their response shapes are confirmed.
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';
import { engageGate } from './_lib/tiers.js';

const PLATFORM_LABEL = {
  instagram: 'Instagram', facebook: 'Facebook', telegram: 'Telegram',
  whatsapp: 'WhatsApp', youtube: 'YouTube', google_business: 'Google Business',
};

// Collapse the many webhook `kind` strings into 3 display groups.
function groupFor(kind) {
  const k = String(kind || '').toLowerCase();
  if (k.includes('comment')) return 'comment';
  if (k.includes('review'))  return 'review';
  if (k.includes('message') || k.includes('dm') || k.includes('conversation')) return 'dm';
  return 'other';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  // TIER GATE — Conversations (inbox + reply + automations). Intended floor is
  // Pro Creator; during launch basic Creator is also allowed. Single source of
  // truth in api/_lib/tiers.js so all engage routes agree.
  const tierKey = String(ws.tier || 'creator').toLowerCase();
  const gate = engageGate(ws);
  if (gate) return json(res, gate.status, gate.body);

  // Recent inbox events for this workspace (webhook-fed). Read-only.
  const rows = await supabase.select('inbox_events', {
    select: 'id,platform,kind,author_handle,body,post_id,platform_post_id,received_at',
    eq: { workspace_id: ws.id },
    order: 'received_at.desc',
    limit: 200,
  }).catch(() => []);

  const items = (rows || []).map(r => ({
    id:             r.id,
    platform:       r.platform,
    platform_label: PLATFORM_LABEL[r.platform] || r.platform || 'Unknown',
    group:          groupFor(r.kind),
    kind:           r.kind,
    author:         r.author_handle || null,
    body:           r.body || null,
    post_id:        r.post_id || null,
    received_at:    r.received_at,
  }));

  // Lightweight analytics computed locally (no Zernio add-on needed).
  const by_platform = {};
  const by_group = { dm: 0, comment: 0, review: 0, other: 0 };
  const now = Date.now();
  const last7 = [0, 0, 0, 0, 0, 0, 0]; // index 0 = today, 6 = six days ago
  for (const it of items) {
    by_platform[it.platform] = (by_platform[it.platform] || 0) + 1;
    by_group[it.group] = (by_group[it.group] || 0) + 1;
    const days = Math.floor((now - new Date(it.received_at).getTime()) / 86400000);
    if (days >= 0 && days < 7) last7[days] += 1;
  }

  return json(res, 200, {
    items,
    analytics: {
      total: items.length,
      by_platform,
      by_group,
      last_7d: last7.slice().reverse(), // oldest → today, for a left-to-right bar
    },
    tier: { key: tierKey },
  });
}
