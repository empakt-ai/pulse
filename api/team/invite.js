// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] POST /api/team/invite
//   body: { email, role: 'admin'|'member'|'viewer' }
//   → { invitation: {...}, link }
//
// Admin+ only. Tier-gated to Brand/Agency. Enforces seat cap (Brand=3
// total users including owner, Agency=10) before issuing the invite,
// counting both existing workspace_members + outstanding pending invites
// across all of the owner's workspaces.
//
// Resends if the same email already has a pending invitation for this
// workspace — refreshing the token and resetting expires_at instead of
// inserting a duplicate row.
// ═════════════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';
import { authenticate, json } from '../_lib/auth.js';
import { supabase } from '../_lib/supabase.js';
import { assertRole, INVITABLE_ROLES } from '../_lib/permissions.js';
import { sendEmail } from '../_lib/email.js';

const SEAT_LIMITS = { brand: 3, agency: 10 };
const INVITE_TTL_DAYS = 7;
const APP_URL = process.env.APP_URL || 'https://mashal.app';

// Count distinct seats used by an owner across ALL their workspaces.
// Owner's own row in workspace_members counts as 1 seat (so Brand=3
// means owner + 2 invitees, matching the spec's pricing copy).
async function countSeatsUsed(ownerId) {
  const owned = await supabase.select('workspaces', {
    select: 'id',
    eq: { owner_id: ownerId },
  }).catch(() => []);
  const wsIds = (owned || []).map(w => w.id);
  if (!wsIds.length) return { members: 0, pending: 0 };

  const [memberRows, pendingRows] = await Promise.all([
    supabase.select('workspace_members', {
      select: 'user_id',
      in: { workspace_id: wsIds },
    }).catch(() => []),
    supabase.select('team_invitations', {
      select: 'email',
      in: { workspace_id: wsIds },
      eq: { status: 'pending' },
    }).catch(() => []),
  ]);
  const uniqueUsers   = new Set((memberRows  || []).map(m => m.user_id));
  const pendingEmails = new Set((pendingRows || []).map(p => String(p.email).toLowerCase()));
  return { members: uniqueUsers.size, pending: pendingEmails.size };
}

function inviteEmailHtml({ inviterName, workspaceName, link, role }) {
  const safeWs   = String(workspaceName || 'a workspace').replace(/</g, '&lt;');
  const safeName = String(inviterName   || 'Someone').replace(/</g, '&lt;');
  const safeRole = String(role          || 'member');
  return `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#F5F1E8; padding:32px; color:#0A0A0B;">
  <div style="max-width:520px; margin:0 auto; background:#FFFFFF; border-radius:16px; padding:32px;">
    <div style="font-family: 'Geist Mono', monospace; font-size:11px; text-transform:uppercase; letter-spacing:0.14em; color:#6B5BFF;">Mashal · Team invite</div>
    <h1 style="font-size:24px; margin:12px 0 8px;">You're invited to ${safeWs}.</h1>
    <p style="font-size:14.5px; line-height:1.55; color:#5C5A53;">${safeName} added you as a <strong>${safeRole}</strong> on Mashal — daily social-media intelligence for serious creators, brands, and agencies. Accept the invite to see the workspace's daily brief and signals.</p>
    <p style="margin:24px 0;">
      <a href="${link}" style="display:inline-block; background:#0A0A0B; color:#F5F1E8; padding:12px 20px; border-radius:12px; text-decoration:none; font-weight:500; font-size:14px;">Accept invitation →</a>
    </p>
    <p style="font-size:12px; color:#8E8B84;">Or copy this link: <br/><span style="font-family: 'Geist Mono', monospace; color:#6B5BFF;">${link}</span></p>
    <p style="font-size:11.5px; color:#8E8B84; margin-top:24px;">This invitation expires in ${INVITE_TTL_DAYS} days. If you weren't expecting it, you can ignore this email.</p>
  </div>
</body></html>`;
}

function inviteEmailText({ inviterName, workspaceName, link, role }) {
  return `${inviterName || 'Someone'} invited you to ${workspaceName || 'a Mashal workspace'} as a ${role}.

Accept the invitation: ${link}

This invitation expires in ${INVITE_TTL_DAYS} days. If you weren't expecting it, ignore this email.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  // Team features are Brand/Agency only.
  const tier = String(ws.tier || '').toLowerCase();
  if (!SEAT_LIMITS[tier]) {
    return json(res, 403, { error: 'Team access is available on Brand and Agency plans.' });
  }

  const denied = assertRole(auth, 'admin');
  if (denied) return json(res, denied.status, denied.body);

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const email = String(body.email || '').trim().toLowerCase();
  const role  = String(body.role  || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(res, 400, { error: 'A valid email is required.' });
  }
  if (!INVITABLE_ROLES.includes(role)) {
    return json(res, 400, { error: `role must be one of ${INVITABLE_ROLES.join(', ')}` });
  }
  if (email === String(auth.user.email || '').toLowerCase()) {
    return json(res, 400, { error: "You can't invite yourself." });
  }

  // Seat cap — count current members + pending invites across all of
  // this owner's workspaces. The owner is reckoned as ws.owner_id, not
  // auth.user.id — an admin invited by the owner can issue invites but
  // the cap belongs to the billing owner.
  const ownerId = ws.owner_id || auth.user.id;
  const { members, pending } = await countSeatsUsed(ownerId);
  const limit = SEAT_LIMITS[tier];
  if (members + pending >= limit) {
    return json(res, 402, {
      error: `Seat limit reached. Your ${tier} plan includes ${limit} seats. Per-seat add-ons are coming soon.`,
      members, pending, limit,
    });
  }

  // If this email already has a pending invite for THIS workspace,
  // refresh it instead of inserting a duplicate. Anything else (revoked,
  // expired, accepted) we treat as a brand-new invite.
  const existing = await supabase.select('team_invitations', {
    select: 'id,status',
    eq: { workspace_id: ws.id, email, status: 'pending' },
    single: true,
  }).catch(() => null);

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400000).toISOString();

  let invitation;
  if (existing?.id) {
    const updated = await supabase.update('team_invitations',
      { token, role, expires_at: expiresAt, invited_by: auth.user.id },
      { eq: { id: existing.id } },
    ).catch(() => null);
    invitation = updated?.[0] || null;
  } else {
    try {
      const inserted = await supabase.insert('team_invitations', {
        workspace_id: ws.id,
        email,
        role,
        token,
        invited_by:   auth.user.id,
        expires_at:   expiresAt,
        status:       'pending',
      });
      invitation = inserted?.[0] || null;
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  const link = `${APP_URL}/?invite=${encodeURIComponent(token)}`;

  // Best-effort email send — if Resend errors, the invitation still
  // exists in the DB. The admin can copy the link from the UI as a
  // fallback. We surface the email error so they know.
  let emailStatus = 'sent';
  let emailError  = null;
  try {
    const inviterName = auth.user?.user_metadata?.first_name
                     || auth.user?.user_metadata?.full_name
                     || (auth.user.email || '').split('@')[0];
    await sendEmail({
      to:      email,
      subject: `You're invited to ${ws.name || 'a Mashal workspace'}`,
      html:    inviteEmailHtml({ inviterName, workspaceName: ws.name, link, role }),
      text:    inviteEmailText({ inviterName, workspaceName: ws.name, link, role }),
    });
  } catch (e) {
    emailStatus = 'failed';
    emailError  = e.message;
    console.warn('[team/invite] Resend send failed:', e.message);
  }

  return json(res, 200, {
    invitation,
    link,
    email_status: emailStatus,
    email_error:  emailError,
  });
}
