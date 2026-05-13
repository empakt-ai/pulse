// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// Generic Bearer-token validation + workspace selection. No PULSE-specific
// concepts (tier checks, signal logic, etc.) belong in this file.
// ═════════════════════════════════════════════════════════════════════════
//
// Auth middleware for Vercel serverless functions.
// Extracts Bearer token, validates with Supabase, returns { user, workspace }.

import { supabase } from './supabase.js';

export async function authenticate(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return { error: 'No auth token', status: 401 };
  }

  const user = await supabase.getUserFromToken(token);
  if (!user || !user.id) {
    return { error: 'Invalid token', status: 401 };
  }

  // Profile + workspace fetch in parallel. Profile is read for the admin
  // flag (gates /api/admin) and — once Phase 3 lands — tier_override and
  // is_disabled. Until then this is a one-field lookup that PULSE-side
  // code doesn't react to.
  const requestedWsId =
    req.headers?.['x-workspace-id'] || req.headers?.['X-Workspace-Id'] || null;

  const [profileRow, ownedResult] = await Promise.all([
    supabase.select('profiles', {
      select: 'is_admin',
      eq: { id: user.id },
      single: true,
    }).catch(() => null),
    supabase.select('workspaces', {
      select: '*',
      eq: { owner_id: user.id },
      order: 'created_at.asc',
    }).catch(() => []),
  ]);
  const owned = ownedResult || [];
  const isAdmin = profileRow?.is_admin === true;

  let workspace = null;
  if (requestedWsId) {
    workspace = owned.find(w => w.id === requestedWsId) || null;
  }
  if (!workspace) workspace = owned[0] || null;

  // Derive trial state on every request so downstream handlers can gate
  // features without re-querying. Three computed flags:
  //   trial_active  — within the 7-day window, never converted
  //   trial_locked  — past the window, never converted (read-only paywall)
  //   trial_days_left — UI banner copy
  // We attach them to the workspace object in-memory only; the persisted
  // `trial_locked` boolean column is set by the trial-sweep cron.
  if (workspace) attachTrialState(workspace);
  for (const w of owned) attachTrialState(w);

  return { user, workspace, token, workspaces: owned, isAdmin };
}

// Compute and attach trial flags to a workspace row. Idempotent and
// dependency-free — pure function over the row's own columns + now().
function attachTrialState(w) {
  if (!w) return;
  const now = Date.now();
  const endsAt = w.trial_ends_at ? new Date(w.trial_ends_at).getTime() : null;
  const converted = !!w.trial_converted_at;

  // If a workspace has no trial_started_at at all (pre-migration row,
  // edge case), treat it as already converted so existing users don't
  // get surprised by a lockout.
  if (!w.trial_started_at || converted) {
    w.trial_active = false;
    w.trial_locked = false;
    w.trial_days_left = null;
    return;
  }

  if (endsAt && now < endsAt) {
    w.trial_active = true;
    w.trial_locked = false;
    w.trial_days_left = Math.max(0, Math.ceil((endsAt - now) / 86400000));
  } else {
    // Trial window has passed without conversion → locked. Persisted
    // `trial_locked` column eventually catches up via the sweep cron;
    // we honour the computed value immediately either way.
    w.trial_active = false;
    w.trial_locked = true;
    w.trial_days_left = 0;
  }
}

// Helper to send JSON consistently
export function json(res, status, body) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(body));
}

// Trial-lockout gate. Endpoints that mutate data or render the dashboard
// pass the active workspace through this. Returns a truthy object when
// the workspace is locked (caller should `return json(res, ...)` it),
// or null when the request is allowed to proceed.
//
// We deliberately don't bake the response into this helper — different
// endpoints want different shapes (some render HTML for OAuth callbacks,
// most return JSON). Caller decides.
export function trialLockoutEnvelope(workspace) {
  if (!workspace?.trial_locked) return null;
  return {
    status: 402,
    body: {
      error: 'Trial ended. Upgrade to continue using PULSE.',
      trial_locked: true,
      trial_ends_at: workspace.trial_ends_at || null,
      trial_intent_tier: workspace.trial_intent_tier || workspace.tier || null,
    },
  };
}
