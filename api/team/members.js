// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] /api/team/members
//
//   GET    → list members + pending invitations for the active workspace.
//            For Agency owners, also returns the cross-workspace
//            assignment matrix so they can manage per-client roles from
//            one panel instead of clicking into 20 workspaces.
//
//   PATCH  body: { user_id, role } → change a member's role
//   DELETE body: { user_id } OR { invitation_id }
//            user_id     → remove the member (owner protected)
//            invitation_id → revoke a pending invite
//
// All operations require admin+ on the active workspace. The owner row
// is protected from role changes and removal — single-owner assumption
// at v1, ownership transfer is out of scope.
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json } from '../_lib/auth.js';
import { supabase } from '../_lib/supabase.js';
import { assertRole, INVITABLE_ROLES } from '../_lib/permissions.js';
import { userMapById } from '../_lib/users.js';

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  const tier = String(ws.tier || '').toLowerCase();
  if (tier !== 'brand' && tier !== 'agency') {
    return json(res, 403, { error: 'Team access is available on Brand and Agency plans.' });
  }

  const denied = assertRole(auth, 'admin');
  if (denied) return json(res, denied.status, denied.body);

  if (req.method === 'GET')    return handleList(req, res, auth, ws, tier);
  if (req.method === 'PATCH')  return handlePatch(req, res, auth, ws);
  if (req.method === 'DELETE') return handleDelete(req, res, auth, ws);
  return json(res, 405, { error: 'Method not allowed' });
}

async function handleList(req, res, auth, ws, tier) {
  // Members of the active workspace + pending invites — the core view
  // shown in the Team panel.
  const [members, invitations] = await Promise.all([
    supabase.select('workspace_members', {
      select: 'user_id,role,invited_by,accepted_at,created_at',
      eq: { workspace_id: ws.id },
      order: 'role.asc,created_at.asc',
    }).catch(() => []),
    supabase.select('team_invitations', {
      select: 'id,email,role,status,expires_at,created_at,invited_by',
      eq: { workspace_id: ws.id, status: 'pending' },
      order: 'created_at.desc',
    }).catch(() => []),
  ]);

  const memberIds = (members || []).map(m => m.user_id);
  const memberInfo = await userMapById(memberIds);

  const decoratedMembers = (members || []).map(m => {
    const info = memberInfo.get(m.user_id) || {};
    return {
      user_id:      m.user_id,
      email:        info.email || null,
      name:         info.first_name || info.full_name || null,
      role:         m.role,
      accepted_at:  m.accepted_at,
      created_at:   m.created_at,
      is_self:      m.user_id === auth.user.id,
    };
  });

  // Agency-only: cross-workspace assignment matrix. Pulls every member
  // across all of this owner's workspaces so the Agency panel can
  // present one view to manage per-client team assignments.
  let matrix = null;
  if (tier === 'agency' && auth.role === 'owner') {
    matrix = await buildAgencyMatrix(ws.owner_id);
  }

  return json(res, 200, {
    members:     decoratedMembers,
    invitations: invitations || [],
    matrix,
  });
}

async function buildAgencyMatrix(ownerId) {
  const ownedWorkspaces = await supabase.select('workspaces', {
    select: 'id,name',
    eq: { owner_id: ownerId },
    order: 'created_at.asc',
  }).catch(() => []);
  const wsIds = (ownedWorkspaces || []).map(w => w.id);
  if (!wsIds.length) return { workspaces: [], users: [] };

  const memberRows = await supabase.select('workspace_members', {
    select: 'user_id,workspace_id,role',
    in: { workspace_id: wsIds },
  }).catch(() => []);

  // Group memberships by user, skipping the owner's own rows — the
  // matrix is about who else has access.
  const byUser = new Map();
  for (const m of memberRows || []) {
    if (m.user_id === ownerId) continue;
    if (!byUser.has(m.user_id)) byUser.set(m.user_id, []);
    byUser.get(m.user_id).push({ workspace_id: m.workspace_id, role: m.role });
  }

  const userInfo = await userMapById([...byUser.keys()]);
  const users = [...byUser.entries()].map(([userId, assignments]) => {
    const info = userInfo.get(userId) || {};
    return {
      user_id:    userId,
      email:      info.email || null,
      name:       info.first_name || info.full_name || null,
      assignments,
    };
  });

  return {
    workspaces: ownedWorkspaces || [],
    users,
  };
}

async function handlePatch(req, res, auth, ws) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const userId = String(body?.user_id || '').trim();
  const role   = String(body?.role    || '').trim().toLowerCase();
  if (!userId) return json(res, 400, { error: 'user_id is required' });
  if (!INVITABLE_ROLES.includes(role)) {
    return json(res, 400, { error: `role must be one of ${INVITABLE_ROLES.join(', ')}` });
  }

  // Refuse to overwrite an owner row — single-owner invariant.
  const existing = await supabase.select('workspace_members', {
    select: 'user_id,role',
    eq: { workspace_id: ws.id, user_id: userId },
    single: true,
  }).catch(() => null);
  if (!existing) return json(res, 404, { error: 'Member not found.' });
  if (existing.role === 'owner') {
    return json(res, 403, { error: "The workspace owner's role can't be changed." });
  }

  try {
    const rows = await supabase.update('workspace_members',
      { role },
      { eq: { workspace_id: ws.id, user_id: userId } },
    );
    return json(res, 200, { member: rows?.[0] || null });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
}

async function handleDelete(req, res, auth, ws) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  // Revoke a pending invitation.
  if (body?.invitation_id) {
    const invId = String(body.invitation_id).trim();
    // Make sure this invitation belongs to the active workspace.
    const inv = await supabase.select('team_invitations', {
      select: 'id,workspace_id,status',
      eq: { id: invId },
      single: true,
    }).catch(() => null);
    if (!inv || inv.workspace_id !== ws.id) {
      return json(res, 404, { error: 'Invitation not found.' });
    }
    if (inv.status !== 'pending') {
      return json(res, 409, { error: `Invitation is already ${inv.status}.` });
    }
    try {
      await supabase.update('team_invitations',
        { status: 'revoked' },
        { eq: { id: invId } },
      );
      return json(res, 200, { ok: true, revoked: invId });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  // Remove an existing member.
  const userId = String(body?.user_id || '').trim();
  if (!userId) return json(res, 400, { error: 'user_id or invitation_id is required' });

  const existing = await supabase.select('workspace_members', {
    select: 'user_id,role',
    eq: { workspace_id: ws.id, user_id: userId },
    single: true,
  }).catch(() => null);
  if (!existing) return json(res, 404, { error: 'Member not found.' });
  if (existing.role === 'owner') {
    return json(res, 403, { error: "You can't remove the workspace owner." });
  }

  try {
    await supabase.delete('workspace_members', {
      eq: { workspace_id: ws.id, user_id: userId },
    });
    return json(res, 200, { ok: true, removed: userId });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
}
