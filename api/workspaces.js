// ═════════════════════════════════════════════════════════════════════════
// [MIXED] Mostly SHARED — workspace CRUD is a generic multi-tenant primitive
// — but the GET response embeds PULSE-specific tier + usage data.
//
//   SHARED (move to platform service):
//     • GET list of workspaces a user owns
//     • POST create workspace
//     • PATCH workspace fields (name, user_type, category, country,
//       focus_regions, account_age)
//
//   PULSE-SPECIFIC (stays here, or becomes a sibling endpoint):
//     • tier metadata in GET response (label, price, runs_per_month cap)
//     • usage block (monthly run count vs cap)
//
// Proposed split: shared service exposes /workspaces with the raw row data;
// PULSE adds a /pulse/workspace-context endpoint that joins tier + usage.
// ═════════════════════════════════════════════════════════════════════════
//
// Workspaces endpoint. A user may own multiple workspaces — each one is
// effectively a separate subscription (separate account slots, competitor
// quota, AI run quota). The active workspace for any request is selected via
// the `x-workspace-id` header (see api/_lib/auth.js).
//
//   GET    /api/workspaces            → returns the active workspace + the
//                                       full owned list + tier + usage
//   POST   /api/workspaces  { name }  → create a new workspace
//   PATCH  /api/workspaces  { ... }   → update the active workspace's settings

import { authenticate, json } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';
import { tierFor, getMonthlyUsage } from './_lib/tiers.js';

const ALLOWED_FIELDS = ['name', 'user_type', 'category', 'market', 'account_age', 'country', 'focus_regions'];

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });

  let workspace = auth.workspace;
  // Auto-create on first hit if no workspaces exist yet (defensive — the
  // Supabase signup trigger should have done this already).
  if (!workspace && (!auth.workspaces || !auth.workspaces.length)) {
    const inserted = await supabase.insert('workspaces', {
      owner_id: auth.user.id,
      name: auth.user.email?.split('@')[0] || 'My Workspace',
      tier: 'creator',
    });
    workspace = inserted?.[0] || null;
    if (!workspace) return json(res, 500, { error: 'Workspace not found and could not be created' });
  }

  // ── GET: full active context ──────────────────────────────────────────
  if (req.method === 'GET') {
    const tier = tierFor(workspace);
    const usage = await getMonthlyUsage(workspace.id).catch(() => ({ used: 0, cost_cents: 0 }));
    return json(res, 200, {
      workspace,
      workspaces: auth.workspaces || [workspace],
      tier: { ...tier, key: workspace.tier || 'creator' },
      usage: { used: usage.used, limit: tier.runs_per_month, cost_cents: usage.cost_cents },
    });
  }

  // ── POST: create new workspace ────────────────────────────────────────
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const name = (body?.name || '').trim();
    if (!name) return json(res, 400, { error: 'name is required' });

    try {
      const inserted = await supabase.insert('workspaces', {
        owner_id: auth.user.id,
        name,
        tier: body?.tier || 'creator',
        user_type: body?.user_type || 'creator',
        category: body?.category || null,
        country: body?.country || null,
      });
      return json(res, 200, { workspace: inserted?.[0] || null });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  // ── PATCH: update settings for active workspace ───────────────────────
  if (req.method === 'PATCH') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const patch = {};
    for (const k of ALLOWED_FIELDS) if (k in (body || {})) patch[k] = body[k];
    if (!Object.keys(patch).length) return json(res, 400, { error: 'No valid fields to update' });

    try {
      const rows = await supabase.update('workspaces', patch, { eq: { id: workspace.id } });
      return json(res, 200, { workspace: rows?.[0] || null });
    } catch (e) {
      // Schema fallback: if country/focus_regions columns don't exist yet,
      // strip and retry. (Migration 002 not applied.)
      if (/country|focus_regions/.test(e.message)) {
        const { country, focus_regions, ...legacyPatch } = patch;
        if (Object.keys(legacyPatch).length) {
          const rows = await supabase.update('workspaces', legacyPatch, { eq: { id: workspace.id } });
          return json(res, 200, {
            workspace: rows?.[0] || null,
            warning: 'country/focus_regions not yet supported — run migrations/002.',
          });
        }
      }
      return json(res, 500, { error: e.message });
    }
  }

  return json(res, 405, { error: 'Method not allowed' });
}
