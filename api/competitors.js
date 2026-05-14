// ═════════════════════════════════════════════════════════════════════════
// [MIXED] Mostly SHARED — generic competitor-handle CRUD over a generic
// schema — with one Mashal-specific touch: the cap on how many competitors
// a workspace can track comes from Mashal's pricing tiers.
//
//   SHARED (move to platform service):
//     • GET/POST/DELETE on the competitors table
//     • action='sync' trigger that calls syncCompetitorsForWorkspace()
//
//   Mashal-SPECIFIC (stays here):
//     • checkCompetitorCap() — uses Mashal tier limits (5/15/50)
//
// Proposed split: shared service exposes raw CRUD; Mashal wraps it with a
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

import { authenticate, json, trialLockoutEnvelope } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';
import { checkCompetitorCap } from './_lib/tiers.js';
import { syncCompetitorsForWorkspace } from './_lib/competitor-sync.js';
import { classifyCaption } from './_lib/caption-patterns.js';

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  if (req.method === 'GET') {
    // ── Top-content mode ────────────────────────────────────────────────
    // GET /api/competitors?mode=top-content[&platform=tiktok][&limit=20]
    // Returns the top-performing competitor posts across the workspace,
    // each tagged with a caption pattern (price, cultural, BNPL, etc).
    // Drives the "Top Competitor Content" table on the Content screen.
    if (req.query?.mode === 'top-content') {
      const limit = Math.min(50, Math.max(5, Number(req.query?.limit) || 20));
      const platform = req.query?.platform && req.query.platform !== 'all' ? req.query.platform : null;

      // Pull competitor metadata first so we can attach display_name without
      // an N+1 join per post.
      const comps = await supabase.select('competitors', {
        select: 'id,handle,display_name,platform,followers',
        eq: { workspace_id: ws.id },
      }).catch(() => []);
      const compById = {};
      (comps || []).forEach(c => { compById[c.id] = c; });

      const filter = { workspace_id: ws.id, source: 'competitor' };
      if (platform) filter.platform = platform;

      const rows = await supabase.select('posts', {
        select: 'id,competitor_id,platform,caption,views,likes,comments,shares,posted_at,raw_data',
        eq: filter,
        order: 'views.desc.nullslast',
        limit: 200,
      }).catch(() => []);

      const top = (rows || [])
        .filter(p => (p.views || 0) > 0 && compById[p.competitor_id])
        .slice(0, limit)
        .map(p => {
          const c = compById[p.competitor_id];
          const pattern = classifyCaption(p.caption);
          const permalink = p.raw_data?.permalink || p.raw_data?.url || p.raw_data?.webUrl || null;
          return {
            id: p.id,
            competitor: {
              id: c.id, handle: c.handle,
              display_name: c.display_name || c.handle,
              platform: c.platform,
              followers: c.followers || null,
            },
            platform: p.platform,
            caption_excerpt: p.caption ? p.caption.slice(0, 140) : '',
            posted_at: p.posted_at,
            views: p.views || 0,
            likes: p.likes || 0,
            comments: p.comments || 0,
            shares: p.shares || 0,
            permalink,
            pattern,
          };
        });

      return json(res, 200, { posts: top, scanned: (rows || []).length });
    }

    const rows = await supabase.select('competitors', {
      select: '*',
      eq: { workspace_id: ws.id },
      order: 'added_at.desc',
    }).catch(() => []);
    return json(res, 200, { competitors: rows || [] });
  }

  if (req.method === 'POST') {
    // Locked trial — no new tracking, no scrapes.
    const locked = trialLockoutEnvelope(ws);
    if (locked) return json(res, locked.status, locked.body);

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
      const msg = cap.source === 'trial'
        ? `Trial allows tracking ${cap.limit} competitors. Upgrade to track more.`
        : `Competitor limit reached (${cap.limit}). Upgrade plan to track more.`;
      return json(res, 429, {
        error: msg,
        used: cap.used,
        limit: cap.limit,
        trial: cap.source === 'trial',
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
