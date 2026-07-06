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
import { engageGate } from '../_lib/tiers.js';
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

  // TIER GATE — Pro Creator+ (basic Creator allowed during launch). Shared
  // gate in api/_lib/tiers.js keeps all engage routes in lockstep.
  const gate = engageGate(ws);
  if (gate) return json(res, gate.status, gate.body);

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const inboxEventId = body?.inbox_event_id || null;
  const ext = body?.comment || null;   // external (Zernio-pulled) comment context
  const message = String(body?.message || '').trim();

  if (!inboxEventId && !ext) return json(res, 400, { error: 'inbox_event_id or comment is required' });
  if (!message) return json(res, 400, { error: 'message is required' });
  if (message.length > MAX_LEN) {
    return json(res, 400, { error: `message exceeds ${MAX_LEN} characters` });
  }

  // Resolve the ids Zernio needs (accountId, platform post id, comment id) plus
  // the local columns for recording — from EITHER a stored inbox event OR an
  // external comment pulled live from Zernio. Both are workspace-scoped so a
  // member of another workspace can't reply into ours.
  let accountId, postId, commentId, platform, localAccountId, localPostId, evtId, authorFrom;

  if (inboxEventId) {
    const evt = await supabase.select('inbox_events', {
      select: 'id,workspace_id,platform,kind,account_id,zernio_account_id,platform_post_id,post_id,author_handle,payload',
      eq: { id: inboxEventId, workspace_id: ws.id },
      limit: 1, single: true,
    }).catch(() => null);
    if (!evt) return json(res, 404, { error: 'Comment not found' });
    if (!String(evt.kind || '').toLowerCase().includes('comment')) {
      return json(res, 400, { error: 'That event is not a comment — only comments can be replied to here.' });
    }
    // account id + platform post id are columns; the comment id lives only in
    // the stored payload (payload.comment.id).
    const payload = evt.payload || {};
    accountId      = evt.zernio_account_id || pick(payload, 'account.id', 'accountId');
    postId         = evt.platform_post_id || pick(payload, 'comment.platformPostId', 'post.platformPostId', 'post.id');
    commentId      = pick(payload, 'comment.id', 'commentId', 'comment._id');
    platform       = evt.platform;
    localAccountId = evt.account_id;
    localPostId    = evt.post_id;
    evtId          = evt.id;
    authorFrom     = pick(payload, 'account.username') || null;
  } else {
    // External comment (from GET /inbox/comments). Verify the account belongs
    // to this workspace before acting on its behalf, then use the ids the pull
    // already resolved.
    const acct = await supabase.select('connected_accounts', {
      select: 'id,platform,zernio_account_id',
      eq: { workspace_id: ws.id, zernio_account_id: ext.zernio_account_id },
      limit: 1, single: true,
    }).catch(() => null);
    if (!acct) return json(res, 403, { error: 'That account is not in this workspace.' });
    accountId      = acct.zernio_account_id;
    postId         = ext.platform_post_id || null;
    commentId      = ext.comment_id || null;
    platform       = acct.platform;
    localAccountId = acct.id;
    localPostId    = null;
    evtId          = null;
    authorFrom     = null;
  }

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
    account_id: localAccountId,
    zernio_account_id: accountId,
    platform,
    kind: 'comment_reply_sent',
    post_id: localPostId,
    platform_post_id: postId,
    author_handle: authorFrom,
    body: message,
    payload: {
      in_reply_to_comment_id: commentId,
      in_reply_to_event_id: evtId,
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
      in_reply_to: evtId,
      platform,
      recorded_event_id: Array.isArray(inserted) ? (inserted[0]?.id || null) : null,
    },
  });
}
