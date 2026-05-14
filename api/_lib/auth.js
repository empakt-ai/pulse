// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// Generic Bearer-token validation + workspace selection. No Mashal-specific
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

  // Profile + workspace fetch in parallel. Profile reads three admin-
  // managed fields:
  //   - is_admin       → gates /api/admin
  //   - is_disabled    → blocks every API call for the user
  //   - tier_override  → admin-only "view as" tier (honored only for admins)
  const requestedWsId =
    req.headers?.['x-workspace-id'] || req.headers?.['X-Workspace-Id'] || null;

  const [profileRow, ownedResult] = await Promise.all([
    supabase.select('profiles', {
      select: 'is_admin,is_disabled,disabled_reason,tier_override',
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

  // Hard gate: a disabled profile cannot transact at all. We deliberately
  // surface the disabled_reason so the user understands why; the SPA
  // shows it on the sign-in screen.
  if (profileRow?.is_disabled === true) {
    return {
      error: 'Account disabled.',
      status: 403,
      disabled: true,
      disabled_reason: profileRow.disabled_reason || null,
    };
  }

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

  // Admin-only tier override. Reads from the admin's own profile row, so
  // there's no way a non-admin gets a tier upgrade by writing into their
  // own row — auth.js refuses to honor it unless is_admin=true. Applies
  // to every workspace the admin owns (including the active one) so the
  // gated experience is uniform across the dashboard.
  const tierOverride = (isAdmin && typeof profileRow?.tier_override === 'string'
    && ['creator', 'brand', 'agency'].includes(profileRow.tier_override))
    ? profileRow.tier_override
    : null;
  if (tierOverride) {
    if (workspace) {
      workspace.tier = tierOverride;
      workspace.tier_overridden = true;
    }
    for (const w of owned) {
      w.tier = tierOverride;
      w.tier_overridden = true;
    }
  }

  return {
    user,
    workspace,
    token,
    workspaces: owned,
    isAdmin,
    asTier: tierOverride,
  };
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
      error: 'Trial ended. Upgrade to continue using Mashal.',
      trial_locked: true,
      trial_ends_at: workspace.trial_ends_at || null,
      trial_intent_tier: workspace.trial_intent_tier || workspace.tier || null,
    },
  };
}
