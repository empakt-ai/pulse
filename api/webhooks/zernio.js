// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// Receives Zernio webhook deliveries (comments, DMs, mentions, reactions).
// Verifies HMAC signature if ZERNIO_WEBHOOK_SECRET is set, resolves the
// workspace + account, and inserts an inbox_events row. Idempotent on
// Zernio's delivery_id so replays don't double-insert.
//
// Webhook URL to register in Zernio dashboard:
//   https://mashal.app/api/webhooks/zernio
//
// We don't process events synchronously here — the live-signals cron picks
// up pending rows on its next pass. Keeps webhook latency low and avoids
// long-running work during a delivery that Zernio may retry on timeout.
// ═════════════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';
import { supabase } from '../_lib/supabase.js';
import { json } from '../_lib/auth.js';

const SECRET = process.env.ZERNIO_WEBHOOK_SECRET || '';

// Constant-time signature compare. Returns true on match OR when the
// secret isn't configured (dev / pre-registration mode — we still accept
// the delivery but flag it in payload).
function verifySignature(rawBody, signatureHeader) {
  if (!SECRET) return { ok: true, verified: false };
  if (!signatureHeader) return { ok: false, verified: false };
  // Zernio may send the signature in a couple of common formats:
  //   "sha256=abc..." or just the hex digest. Handle both.
  const sig = String(signatureHeader).replace(/^sha256=/i, '').trim();
  const expected = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
  try {
    const ok = sig.length === expected.length
      && crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    return { ok, verified: ok };
  } catch {
    return { ok: false, verified: false };
  }
}

// Pull a value from the payload by trying several common key names.
function pick(obj, ...keys) {
  for (const k of keys) {
    const v = k.split('.').reduce((o, kk) => (o == null ? null : o[kk]), obj);
    if (v != null) return v;
  }
  return null;
}

// Vercel parses JSON bodies by default. Get the raw text for signature
// verification by reading from req.rawBody when available; otherwise
// re-serialize req.body (close enough — Zernio signs the JSON they sent
// us, which we reconstruct deterministically here).
async function readRawBody(req) {
  if (req.rawBody) return Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : String(req.rawBody);
  if (typeof req.body === 'string') return req.body;
  return JSON.stringify(req.body || {});
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const raw = await readRawBody(req);
  const sigHeader = req.headers?.['x-zernio-signature'] || req.headers?.['x-signature'] || '';
  const verify = verifySignature(raw, sigHeader);
  if (!verify.ok) {
    return json(res, 401, { error: 'Invalid signature' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== 'object') return json(res, 400, { error: 'Invalid body' });

  // Zernio webhook payload field names aren't fully nailed down in their
  // public docs — read defensively. Common shapes:
  //   { event: 'comment.created', deliveryId, accountId, profileId,
  //     platform, post: {...}, comment: {...}, message: {...} }
  const kind = pick(body, 'event', 'type', 'kind') || 'unknown';
  const deliveryId = pick(body, 'deliveryId', 'delivery_id', 'id', 'eventId') || null;
  const zernioAccountId = pick(body, 'accountId', 'account_id', 'account.id', 'data.accountId') || null;
  const zernioProfileId = pick(body, 'profileId', 'profile_id', 'account.profileId') || null;
  const platform = pick(body, 'platform', 'account.platform', 'data.platform') || null;
  const platformPostId = pick(body, 'post.platformPostId', 'post.id', 'post._id',
                                'comment.postId', 'data.postId') || null;
  const authorHandle = pick(body, 'author.username', 'comment.author.username',
                               'message.from.username', 'from.username', 'author') || null;
  const text = pick(body, 'comment.text', 'message.text', 'text', 'body') || null;

  // Resolve workspace + post locally. Best-effort — webhook still records
  // an unresolved event so we don't drop deliveries when our DB hasn't
  // caught up to the upstream state yet.
  let workspaceId = null;
  let accountId = null;
  if (zernioAccountId) {
    const acct = await supabase.select('connected_accounts', {
      select: 'id,workspace_id',
      eq: { zernio_account_id: zernioAccountId },
      limit: 1, single: true,
    }).catch(() => null);
    if (acct) { workspaceId = acct.workspace_id; accountId = acct.id; }
  }
  if (!workspaceId && zernioProfileId) {
    const ws = await supabase.select('workspaces', {
      select: 'id', eq: { zernio_profile_id: zernioProfileId }, limit: 1, single: true,
    }).catch(() => null);
    if (ws) workspaceId = ws.id;
  }
  if (!workspaceId) {
    // Can't attribute the event. ACK so Zernio stops retrying, but record
    // the orphan in the response for ops visibility.
    return json(res, 200, { ok: true, orphan: true, reason: 'workspace_unresolved' });
  }

  let postId = null;
  if (platformPostId) {
    const p = await supabase.select('posts', {
      select: 'id', eq: { workspace_id: workspaceId, platform_post_id: String(platformPostId) },
      limit: 1, single: true,
    }).catch(() => null);
    if (p) postId = p.id;
  }

  // ─── Lifecycle events: side-effects, no inbox row ─────────────────────
  // These events drive state changes (posts.status, connected_accounts.status,
  // posts.published_at) rather than the comment/dm inbox feed. ACK on
  // success so Zernio doesn't retry. Unknown post / account refs are
  // tolerated — we just no-op the side-effect.
  const k = String(kind).toLowerCase();

  if (k === 'post.published') {
    if (postId) {
      await supabase.update('posts',
        { status: 'published', published_at: new Date().toISOString() },
        { eq: { id: postId } }
      ).catch(() => {});
    }
    return json(res, 200, { ok: true, kind: k, applied: !!postId });
  }

  if (k === 'post.failed' || k === 'post.cancelled' || k === 'post.partial' || k === 'post.recycled') {
    const status = k.split('.')[1]; // 'failed' | 'cancelled' | 'partial' | 'recycled'
    if (postId) {
      await supabase.update('posts', { status }, { eq: { id: postId } }).catch(() => {});
    }
    // post.failed deserves a row in inbox_events too — the user wants to
    // see "your scheduled post broke". The other lifecycle states are
    // silent state changes.
    if (k === 'post.failed' && workspaceId) {
      await supabase.insert('inbox_events', {
        workspace_id: workspaceId, account_id: accountId, zernio_account_id: zernioAccountId,
        platform, kind: 'post_failed',
        post_id: postId, platform_post_id: platformPostId ? String(platformPostId) : null,
        author_handle: null, body: pick(body, 'error', 'reason', 'message') || 'Post failed to publish',
        payload: { ...body, _signature_verified: verify.verified },
        delivery_id: deliveryId,
      }).catch(() => {});
    }
    return json(res, 200, { ok: true, kind: k, applied: !!postId });
  }

  if (k === 'account.disconnected') {
    if (accountId) {
      await supabase.update('connected_accounts',
        { status: 'disconnected', disconnected_at: new Date().toISOString() },
        { eq: { id: accountId } }
      ).catch(() => {});
    }
    return json(res, 200, { ok: true, kind: k, applied: !!accountId });
  }

  // ─── Inbox/feed events: comment.received, message.received, review.new ──
  // Everything else falls through to the generic inbox_events insert. The
  // live-signals cron picks pending rows up and runs pattern detection.
  const row = {
    workspace_id: workspaceId,
    account_id: accountId,
    zernio_account_id: zernioAccountId,
    platform,
    kind,
    post_id: postId,
    platform_post_id: platformPostId ? String(platformPostId) : null,
    author_handle: authorHandle,
    body: text,
    payload: { ...body, _signature_verified: verify.verified },
    delivery_id: deliveryId,
  };

  try {
    await supabase.insert('inbox_events', row);
  } catch (e) {
    // 23505 = unique_violation (delivery_id replay). Treat as success.
    if (/duplicate key|unique/i.test(e.message)) {
      return json(res, 200, { ok: true, duplicate: true });
    }
    return json(res, 500, { error: e.message });
  }

  return json(res, 200, { ok: true });
}
