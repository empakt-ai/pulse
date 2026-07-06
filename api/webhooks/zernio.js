// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// Receives Zernio webhook deliveries (comments, DMs, mentions, reactions).
// Verifies HMAC signature if ZERNIO_WEBHOOK_SECRET is set, resolves the
// workspace + account, and inserts an inbox_events row. Idempotent on
// Zernio's delivery_id so replays don't double-insert.
//
// Webhook URL to register in Zernio dashboard (use the www canonical host —
// the bare apex mashal.app issues a 307 redirect that a POST webhook may not
// follow, dropping the body):
//   https://www.mashal.app/api/webhooks/zernio
//
// We don't process events synchronously here — the live-signals cron picks
// up pending rows on its next pass. Keeps webhook latency low and avoids
// long-running work during a delivery that Zernio may retry on timeout.
// ═════════════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';
import { supabase } from '../_lib/supabase.js';
import { json } from '../_lib/auth.js';

// Disable Vercel's automatic body parsing so we can read the EXACT raw bytes
// Zernio signed. @vercel/node does NOT populate req.rawBody, so the old
// JSON.stringify(req.body) fallback re-serialized the parsed body — reordering
// keys and changing whitespace/unicode escaping — which makes the HMAC never
// match a real delivery. We read the stream ourselves and parse it manually.
export const config = { api: { bodyParser: false } };

const SECRET = process.env.ZERNIO_WEBHOOK_SECRET || '';
const IS_PROD = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

// Constant-time signature compare.
// SECURITY (audit, May 2026): fail closed in production. The previous
// behavior accepted every unsigned delivery as "verified: false" when
// ZERNIO_WEBHOOK_SECRET was unset, which let any caller insert fake
// inbox_events rows that downstream cron logic would act on. In prod
// a missing secret is a configuration bug — refuse the request rather
// than silently degrade.
function verifySignature(rawBody, signatureHeader) {
  if (!SECRET) {
    if (IS_PROD) return { ok: false, verified: false, reason: 'secret_missing' };
    return { ok: true, verified: false };                 // dev only
  }
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

// Read the exact raw request bytes off the stream. With bodyParser disabled
// req is the unconsumed IncomingMessage, so this is what Zernio actually
// signed — feed it straight into the HMAC, then JSON.parse for the payload.
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const raw = await readRawBody(req);
  const sigHeader = req.headers?.['x-zernio-signature'] || req.headers?.['x-signature'] || '';
  const verify = verifySignature(raw, sigHeader);
  if (!verify.ok) {
    return json(res, 401, { error: 'Invalid signature' });
  }

  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch { body = {}; }
  if (!body || typeof body !== 'object') return json(res, 400, { error: 'Invalid body' });

  // Zernio webhook payload field names aren't fully nailed down in their
  // public docs — read defensively. Common shapes:
  //   { event: 'comment.created', deliveryId, accountId, profileId,
  //     platform, post: {...}, comment: {...}, message: {...} }
  const kind = pick(body, 'event', 'type', 'kind') || 'unknown';
  const deliveryId = pick(body, 'deliveryId', 'delivery_id', 'id', 'eventId') || null;
  // 'number.id'/'number.profileId' cover the WhatsApp BYO lifecycle envelope
  // ({ id, event, timestamp, number:{ id, phoneNumber, country, profileId } }).
  // Appended last so existing comment/dm/review events still match their own
  // keys first — purely additive.
  const zernioAccountId = pick(body, 'accountId', 'account_id', 'account.id', 'data.accountId', 'number.id', 'number._id') || null;
  const zernioProfileId = pick(body, 'profileId', 'profile_id', 'account.profileId', 'number.profileId') || null;
  const platform = pick(body, 'platform', 'account.platform', 'data.platform') || null;
  const platformPostId = pick(body, 'post.platformPostId', 'post.id', 'post._id',
                                'comment.postId', 'data.postId') || null;
  // Author/sender identity. Comments carry comment.author.username; DMs carry
  // the sender under message.sender.* (username OR name) and again on the
  // conversation as participant*. Prefer a handle, fall back to a display name,
  // so the inbox shows who it's from instead of "Someone".
  const authorHandle = pick(body,
    'comment.author.username', 'author.username',
    'message.sender.username', 'message.from.username', 'from.username',
    'conversation.participantUsername',
    'message.sender.name', 'conversation.participantName',
    'author') || null;
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

  // Post lifecycle. Zernio namespaces these as post.<action> OR
  // post.platform.<action> (e.g. post.platform.published / post.platform.failed),
  // so match on the trailing action, not the exact string — otherwise a
  // published/failed webhook silently misses our status update. Non-status post
  // events (post.external.*, post.tiktok.url.resolved) have other trailing words
  // and fall through to be ignored below.
  const postAction = k.startsWith('post.') ? k.split('.').pop() : null;

  if (postAction === 'published') {
    if (postId) {
      await supabase.update('posts',
        { status: 'published', published_at: new Date().toISOString() },
        { eq: { id: postId } }
      ).catch(() => {});
    }
    return json(res, 200, { ok: true, kind: k, applied: !!postId });
  }

  if (postAction === 'failed' || postAction === 'cancelled' || postAction === 'partial' || postAction === 'recycled') {
    if (postId) {
      await supabase.update('posts', { status: postAction }, { eq: { id: postId } }).catch(() => {});
    }
    // A failed publish deserves a row in inbox_events too — the user wants to
    // see "your scheduled post broke". The other lifecycle states are silent
    // status changes.
    if (postAction === 'failed' && workspaceId) {
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

  // WhatsApp BYO number lifecycle (the only events that fire for bring-your-own
  // numbers — provisioned-only states like declined/verification_required won't
  // arrive). Additive: drives connected_accounts.status, no inbox row.
  //   activated / reactivated → live again
  //   suspended               → Meta paused it (kept visible, flagged)
  //   released                → terminal removal (mirror account.disconnected)
  if (k === 'whatsapp.number.activated' || k === 'whatsapp.number.reactivated') {
    if (accountId) {
      await supabase.update('connected_accounts',
        { status: 'connected', is_active: true, disconnected_at: null },
        { eq: { id: accountId } }
      ).catch(() => {});
    }
    return json(res, 200, { ok: true, kind: k, applied: !!accountId });
  }

  if (k === 'whatsapp.number.suspended' || k === 'whatsapp.number.released') {
    const released = k === 'whatsapp.number.released';
    if (accountId) {
      await supabase.update('connected_accounts',
        released
          ? { status: 'disconnected', is_active: false, disconnected_at: new Date().toISOString() }
          : { status: 'suspended' },
        { eq: { id: accountId } }
      ).catch(() => {});
    }
    return json(res, 200, { ok: true, kind: k, applied: !!accountId });
  }

  // ─── Inbox/feed events: comment.received, message.received/edited, review.* ─
  // Only genuine feed events become inbox rows. Everything else that reaches
  // here — message.read/delivered/sent/failed/deleted, reaction.received,
  // conversation.started, status.*, lead.*, post.external.*, post.tiktok.* — is
  // ACKed without an insert so the newly-enabled webhooks don't pollute the
  // feed. (First-class handling for reactions + externally-sent DMs comes once
  // we've seen real payloads for them.)
  const isFeedEvent =
    (k.includes('comment') && !k.includes('delet') && !k.includes('hidden')) ||
    k === 'message.received' || k === 'message.edited' ||
    (k.includes('review') && !k.includes('delet'));
  if (!isFeedEvent) {
    return json(res, 200, { ok: true, kind: k, ignored: true });
  }

  // The live-signals cron picks pending rows up and runs pattern detection.
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
