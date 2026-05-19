// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] POST /api/team/accept
//   body: { token }
//   → { workspace_id, role, workspace_name }
//
// Validates a pending team invitation and creates the workspace_members
// row. Idempotent — a second call with the same token returns the same
// membership instead of erroring (handles double-tap on the accept link).
//
// The invitation.email must match the authenticated user's email (case-
// insensitive). Mismatches return 403 — you can't pick up someone else's
// invite even if you somehow got the token.
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json } from '../_lib/auth.js';
import { supabase } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const token = String(body?.token || '').trim();
  if (!token) return json(res, 400, { error: 'token is required' });

  const invitation = await supabase.select('team_invitations', {
    select: '*',
    eq: { token },
    single: true,
  }).catch(() => null);
  if (!invitation) return json(res, 404, { error: 'Invitation not found.' });

  const userEmail = String(auth.user.email || '').toLowerCase();
  const inviteEmail = String(invitation.email || '').toLowerCase();
  if (userEmail !== inviteEmail) {
    return json(res, 403, {
      error: 'This invitation was sent to a different email address. Sign in with that address to accept it.',
      sent_to_domain: inviteEmail.split('@')[1] || null,
    });
  }

  // Already-accepted is a success path, not an error — handles the
  // user clicking the link a second time or a stale tab firing.
  if (invitation.status === 'accepted') {
    return json(res, 200, {
      workspace_id:   invitation.workspace_id,
      role:           invitation.role,
      workspace_name: null,
      already_accepted: true,
    });
  }

  if (invitation.status !== 'pending') {
    return json(res, 410, { error: `This invitation is ${invitation.status}.` });
  }

  if (invitation.expires_at && new Date(invitation.expires_at).getTime() < Date.now()) {
    await supabase.update('team_invitations',
      { status: 'expired' },
      { eq: { id: invitation.id } },
    ).catch(() => {});
    return json(res, 410, { error: 'This invitation has expired. Ask for a new one.' });
  }

  // Membership row — upsert so a re-accept (e.g. user removed and re-
  // invited) updates role rather than failing.
  try {
    await supabase.upsert('workspace_members', {
      user_id:      auth.user.id,
      workspace_id: invitation.workspace_id,
      role:         invitation.role,
      invited_by:   invitation.invited_by,
      accepted_at:  new Date().toISOString(),
    }, { onConflict: 'user_id,workspace_id' });
  } catch (e) {
    return json(res, 500, { error: `Could not create membership: ${e.message}` });
  }

  await supabase.update('team_invitations',
    { status: 'accepted', accepted_at: new Date().toISOString() },
    { eq: { id: invitation.id } },
  ).catch(() => {});

  // Pull workspace name for the success toast on the SPA side.
  const ws = await supabase.select('workspaces', {
    select: 'name',
    eq: { id: invitation.workspace_id },
    single: true,
  }).catch(() => null);

  return json(res, 200, {
    workspace_id:   invitation.workspace_id,
    role:           invitation.role,
    workspace_name: ws?.name || null,
  });
}
