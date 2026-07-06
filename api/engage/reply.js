// ═════════════════════════════════════════════════════════════════════════
// [Mashal] Engage — outbound engagement module (Phase 1: reply to a comment).
//
// POST /api/engage/reply — post a public reply to a comment that arrived via
// the Zernio webhook (stored in inbox_events). Resolves the Zernio account id,
// platform post id, and comment id from the stored event, calls Zernio's
// reply endpoint, and records the outbound reply as its own inbox_events row
// so the thread shows "you replied".
//
// This is the first WRITE surface in the `engage` module — kept as a thin
// orchestration layer over the Zernio wrapper. Manual and human-initiated, so
// no self-reply loop-prevention is needed here (that belongs to the automation
// step). Automation (comment→DM) lands in a later phase alongside this route.
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json, trialLockoutEnvelope } from '../_lib/auth.js';
import { assertRole } from '../_lib/permissions.js';
import { supabase } from '../_lib/supabase.js';
import { zernio } from '../_lib/zernio.js';

// IG/FB comment ceiling is 2,200 chars; keep a single generous upper bound.
const MAX_LEN = 2200;

// Pull a value from the stored payload by trying several dotted key paths —
// mirrors the defensive read in the webhook (Zernio's field names aren't
// contractually guaranteed and vary a little per platform).
function pick(obj, ...paths) {
  for (const p of paths) {
    const v = p.split('.').reduce((o, k) => (o == null ? null : o[k]), obj);
    if (v != null) return v;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  // Trial-lockout + role gate. Replying is a WRITE, so member+ only
  // (viewers are read-only per api/_lib/permissions.js).
  const locked = trialLockoutEnvelope(ws);
  if (locked) return json(res, locked.status, locked.body);
  const denied = assertRole(auth, 'member');
  if (denied) return json(res, denied.status, denied.body);

  // TIER GATE — Conversations/Engage is a Brand/Agency surface. Trial
  // workspaces preview it (mirrors api/conversations.js exactly).
  const tierKey = String(ws.tier || 'creator').toLowerCase();
  const allowed = tierKey === 'brand' || tierKey === 'agency' || !!ws.trial_active;
  if (!allowed) {
    return json(res, 402, {
      error: 'Replying from Conversations unlocks on Brand and Agency.',
      upgrade_tier: 'brand', current_tier: tierKey,
    });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const inboxEventId = body?.inbox_event_id || null;
  const message = String(body?.message || '').trim();

  if (!inboxEventId) return json(res, 400, { error: 'inbox_event_id is required' });
  if (!message) return json(res, 400, { error: 'message is required' });
  if (message.length > MAX_LEN) {
    return json(res, 400, { error: `message exceeds ${MAX_LEN} characters` });
  }

  // Load the comment event — scoped to THIS workspace so a member of another
  // workspace can't reply into ours by guessing an id.
  const evt = await supabase.select('inbox_events', {
    select: 'id,workspace_id,platform,kind,account_id,zernio_account_id,platform_post_id,post_id,author_handle,payload',
    eq: { id: inboxEventId, workspace_id: ws.id },
    limit: 1, single: true,
  }).catch(() => null);
  if (!evt) return json(res, 404, { error: 'Comment not found' });
  if (!String(evt.kind || '').toLowerCase().includes('comment')) {
    return json(res, 400, { error: 'That event is not a comment — only comments can be replied to here.' });
  }

  // Resolve the three ids Zernio needs. account id + platform post id are
  // columns; the comment id lives only in the stored payload (payload.comment.id).
  const payload = evt.payload || {};
  const accountId = evt.zernio_account_id || pick(payload, 'account.id', 'accountId');
  const postId    = evt.platform_post_id
    || pick(payload, 'comment.platformPostId', 'post.platformPostId', 'post.id');
  const commentId = pick(payload, 'comment.id', 'commentId', 'comment._id');

  if (!accountId || !postId || !commentId) {
    return json(res, 422, {
      error: 'Could not resolve the platform ids needed to reply to this comment.',
      missing: { accountId: !accountId, postId: !postId, commentId: !commentId },
    });
  }

  // Fire the reply through Zernio.
  let zres;
  try {
    zres = await zernio.replyToComment({ accountId, postId, commentId, message });
  } catch (e) {
    // Surface Zernio's own error verbatim so the user understands the cause
    // (e.g. messaging window expired, missing permission, deleted comment).
    return json(res, 502, { error: `Reply failed: ${e.message}`, zernio_status: e.status || null });
  }

  // Record the outbound reply as its own inbox_events row so the thread shows
  // it on the next read. kind 'comment_reply_sent' keeps it distinct from
  // inbound comments; status 'processed' keeps it out of the pending-signal
  // detector path. A logging failure here must NOT fail the request — the
  // reply already posted to the platform.
  const outbound = {
    workspace_id: ws.id,
    account_id: evt.account_id,
    zernio_account_id: accountId,
    platform: evt.platform,
    kind: 'comment_reply_sent',
    post_id: evt.post_id,
    platform_post_id: postId,
    author_handle: pick(payload, 'account.username') || null,
    body: message,
    payload: {
      in_reply_to_comment_id: commentId,
      in_reply_to_event_id: evt.id,
      sent_by_user_id: auth.user.id,
      zernio_response: zres ?? null,
    },
    status: 'processed',
  };
  const inserted = await supabase.insert('inbox_events', outbound).catch((e) => ({ _logError: e.message }));

  return json(res, 200, {
    ok: true,
    reply: {
      message,
      in_reply_to: evt.id,
      platform: evt.platform,
      recorded_event_id: Array.isArray(inserted) ? (inserted[0]?.id || null) : null,
    },
  });
}
