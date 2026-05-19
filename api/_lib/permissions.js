// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Permissions — the single source of truth for who can do what
// inside a workspace. Every workspace-scoped route defers here.
//
// Role hierarchy (lowest → highest):
//   viewer  — read-only. Briefs, signals, reports. No edits, no settings.
//   member  — full read/write on brief, content, competitors. No settings.
//   admin   — invite/remove members, edit workspace settings.
//   owner   — billing holder. Everything. Cannot be removed.
//
// Owners always have role='owner' in workspace_members (backfilled by
// migration 024). The workspaces.owner_id column remains the billing
// authority — only the owner_id can change tier, manage Stripe, or
// delete the workspace. Multiple owners are not supported in v1.
//
// Why a separate module:
//   1. One file to change when roles or rules evolve.
//   2. assertRole() is the only function routes call — no bespoke
//      role-checking in individual handlers (which is how drift happens).
//   3. Future audit-log hook can wrap every assertRole call without
//      touching the routes.
// ═════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase.js';

// Higher rank = more permissions. assertRole(auth, 'member') passes for
// member/admin/owner; fails for viewer.
export const ROLE_RANK = {
  viewer: 1,
  member: 2,
  admin:  3,
  owner:  4,
};

export const VALID_ROLES = Object.keys(ROLE_RANK);
// Roles that can be assigned via invite. Owner is minted only on
// workspace creation (or transfer, not in v1).
export const INVITABLE_ROLES = ['admin', 'member', 'viewer'];

// Pure boolean comparison — no DB, no envelope.
export function meetsRole(actualRole, minRole) {
  const actual = ROLE_RANK[String(actualRole || '').toLowerCase()] || 0;
  const min    = ROLE_RANK[String(minRole    || '').toLowerCase()] || 0;
  return actual >= min;
}

// Returns the user's role on a workspace, or null if no membership.
// Owner check is included via the workspace_members backfill — the
// owner has a row with role='owner'. We don't fall back to
// workspaces.owner_id because that path would be unaudited.
export async function roleFor(userId, workspaceId) {
  if (!userId || !workspaceId) return null;
  const row = await supabase.select('workspace_members', {
    select: 'role',
    eq: { user_id: userId, workspace_id: workspaceId },
    single: true,
  }).catch(() => null);
  return row?.role || null;
}

// All workspace IDs the user can access (any role). Used by the auth
// layer to scope workspace lookups so a member of workspace X can never
// see workspace Y just by sending its UUID as x-workspace-id.
export async function workspacesForUser(userId) {
  if (!userId) return [];
  const rows = await supabase.select('workspace_members', {
    select: 'workspace_id,role',
    eq: { user_id: userId },
  }).catch(() => []);
  return (rows || []).map(r => ({ workspace_id: r.workspace_id, role: r.role }));
}

export async function canAccess(userId, workspaceId) {
  const role = await roleFor(userId, workspaceId);
  return !!role;
}

// The route-side gate. Returns null when the request is allowed to
// proceed, or an envelope { status, body } that the handler hands to
// json() to short-circuit. Mirrors the trialLockoutEnvelope() shape in
// auth.js so routes have a single calling pattern:
//
//   const denied = assertRole(auth, 'admin');
//   if (denied) return json(res, denied.status, denied.body);
//
// auth.role is set by api/_lib/auth.js on the active workspace.
export function assertRole(auth, minRole) {
  if (!auth || auth.error) {
    return { status: 401, body: { error: 'Not authenticated' } };
  }
  if (!auth.role) {
    return { status: 403, body: { error: 'No access to this workspace.' } };
  }
  if (!meetsRole(auth.role, minRole)) {
    return {
      status: 403,
      body: {
        error: `This action requires ${minRole} access or higher. Your role: ${auth.role}.`,
        required_role: minRole,
        your_role:     auth.role,
      },
    };
  }
  return null;
}
