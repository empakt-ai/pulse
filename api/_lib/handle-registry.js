// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// Global registry of (platform, handle) bindings. The single source of
// truth for "is this handle available to claim?" across the platform.
//
// Why a registry instead of just connected_accounts:
//   • connected_accounts.is_active=false on disconnect, but the handle is
//     considered released — a different workspace can claim it. The
//     registry keeps a permanent record across active+inactive states.
//   • Trial workspaces that expire without converting hold their handles
//     locked (released_at set, workspace_id still bound) so the same
//     handle can't be used to start a fresh trial via a new account.
//   • Future: cross-product (Content Studio etc.) sharing of the same
//     registry without dragging the whole connected_accounts schema.
// ═════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase.js';

// Normalise a handle the same way the migration does — lowercase, strip
// leading '@' or whitespace. Anything that differs only by case or @-prefix
// must collide.
export function normaliseHandle(handle) {
  return String(handle || '').trim().replace(/^@+/, '').toLowerCase();
}

// Is this (platform, handle) available for `workspaceId` to claim?
// Returns { available, reason, currentBinding } so callers can render
// useful messages without a second query.
//
//   available=true  → no row yet, or the row is bound to this workspace
//   available=false → row exists, bound to a different workspace
//                     reason is 'taken' (active binding elsewhere) or
//                     'trial_locked' (expired trial still holding it)
export async function isAvailable(platform, rawHandle, workspaceId) {
  const handle = normaliseHandle(rawHandle);
  if (!platform || !handle) return { available: false, reason: 'invalid' };

  const rows = await supabase.select('social_handles', {
    select: '*',
    eq: { platform, handle },
    limit: 1,
  }).catch(() => []);
  const row = rows?.[0] || null;
  if (!row) return { available: true, reason: null, currentBinding: null };
  if (row.workspace_id === workspaceId) {
    return { available: true, reason: 'already_yours', currentBinding: row };
  }
  return {
    available: false,
    reason: row.released_at ? 'trial_locked' : 'taken',
    currentBinding: row,
  };
}

// Claim (or re-claim) a handle for a workspace. Idempotent — calling it
// twice with the same args just refreshes last_bound_at. Throws if the
// handle is bound to a different workspace; callers should hit
// isAvailable() first when they need a soft message.
export async function claimHandle(platform, rawHandle, { workspaceId, tier }) {
  const handle = normaliseHandle(rawHandle);
  if (!platform || !handle) throw new Error('platform and handle are required');
  if (!workspaceId) throw new Error('workspaceId is required');

  const check = await isAvailable(platform, handle, workspaceId);
  if (!check.available) {
    const err = new Error(`Handle ${handle} on ${platform} is ${check.reason}`);
    err.code = 'handle_taken';
    err.reason = check.reason;
    err.currentBinding = check.currentBinding;
    throw err;
  }

  const now = new Date().toISOString();
  const event = { kind: 'bind', workspace_id: workspaceId, tier: tier || null, at: now };

  if (check.currentBinding) {
    // Same workspace re-binding: append history, bump last_bound_at, clear
    // any released_at left over from a prior trial expiry.
    const history = Array.isArray(check.currentBinding.history)
      ? check.currentBinding.history
      : [];
    await supabase.update('social_handles', {
      tier: tier || check.currentBinding.tier || null,
      last_bound_at: now,
      released_at: null,
      history: [...history, event],
    }, { eq: { id: check.currentBinding.id } });
    return { id: check.currentBinding.id, action: 'rebound' };
  }

  // Fresh claim.
  const inserted = await supabase.insert('social_handles', {
    platform,
    handle,
    workspace_id: workspaceId,
    tier: tier || null,
    first_claimed_at: now,
    last_bound_at: now,
    history: [event],
  });
  return { id: inserted?.[0]?.id, action: 'claimed' };
}

// Release a handle — used by:
//   • the trial-sweep cron when an unconverted trial expires
//   • disconnect (DELETE /api/accounts) — the user's choice to free it
//
// For trial expiry: workspace_id stays bound so the original workspace
// can re-claim it on upgrade. released_at is set, which is what blocks
// any *other* workspace from claiming it. Pass { permanent: true } from
// disconnect to also null the workspace_id, fully freeing the handle.
export async function releaseHandle(platform, rawHandle, { permanent = false, reason = null } = {}) {
  const handle = normaliseHandle(rawHandle);
  if (!platform || !handle) return false;

  const rows = await supabase.select('social_handles', {
    select: '*',
    eq: { platform, handle },
    limit: 1,
  }).catch(() => []);
  const row = rows?.[0] || null;
  if (!row) return false;

  const now = new Date().toISOString();
  const history = Array.isArray(row.history) ? row.history : [];
  const event = { kind: permanent ? 'release_permanent' : 'release_trial', reason, at: now };

  await supabase.update('social_handles', {
    released_at: now,
    ...(permanent ? { workspace_id: null } : {}),
    history: [...history, event],
  }, { eq: { id: row.id } });
  return true;
}

// Release every handle currently bound to a workspace. Called when a
// trial workspace expires unconverted — flips all its accounts into the
// "claimed but released" state so the user can rebind on upgrade but no
// one else can claim them.
export async function releaseAllForWorkspace(workspaceId, { reason = 'trial_expired' } = {}) {
  const rows = await supabase.select('social_handles', {
    select: '*',
    eq: { workspace_id: workspaceId },
  }).catch(() => []);
  if (!rows?.length) return 0;
  const now = new Date().toISOString();
  let released = 0;
  for (const row of rows) {
    if (row.released_at) continue; // already released
    const history = Array.isArray(row.history) ? row.history : [];
    try {
      await supabase.update('social_handles', {
        released_at: now,
        history: [...history, { kind: 'release_trial', reason, at: now }],
      }, { eq: { id: row.id } });
      released += 1;
    } catch (_) {}
  }
  return released;
}
