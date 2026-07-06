// ═════════════════════════════════════════════════════════════════════════
// [Mashal] Engage — reply into a DM thread (Step 3).
//
// POST /api/engage/dm — send a direct-message reply into an existing
// conversation that arrived via the Zernio webhook (stored in inbox_events).
// Resolves the Zernio account id + conversation id from the stored event,
// sends via Zernio, and records the outbound DM as its own inbox_events row
// (kind 'message_sent', direction outgoing) so the thread stitches it in.
//
// Sibling of api/engage/reply.js (comment reply). Manual + human-initiated, so
// no self-reply loop-prevention is needed here.
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json, trialLockoutEnvelope } from '../_lib/auth.js';
import { assertRole } from '../_lib/permissions.js';
import { engageGate } from '../_lib/tiers.js';
import { supabase } from '../_lib/supabase.js';
import { zernio } from '../_lib/zernio.js';

// Instagram DM ceiling is 1,000 chars; keep a single generous upper bound.
const MAX_LEN = 1000;

// Defensive dotted-path read over the stored payload (mirrors the webhook).
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

  // Trial-lockout + role gate. Sending a DM is a WRITE, so member+ only.
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
  const message = String(body?.message || '').trim();

  if (!inboxEventId) return json(res, 400, { error: 'inbox_event_id is required' });
  if (!message) return json(res, 400, { error: 'message is required' });
  if (message.length > MAX_LEN) {
    return json(res, 400, { error: `message exceeds ${MAX_LEN} characters` });
  }

  // Load the DM event — scoped to THIS workspace so a member of another
  // workspace can't send into ours by guessing an id. Any event in the thread
  // works: it carries the same conversationId + account.
  const evt = await supabase.select('inbox_events', {
    select: 'id,workspace_id,platform,kind,account_id,zernio_account_id,payload',
    eq: { id: inboxEventId, workspace_id: ws.id },
    limit: 1, single: true,
  }).catch(() => null);
  if (!evt) return json(res, 404, { error: 'Conversation not found' });
  const k = String(evt.kind || '').toLowerCase();
  if (!(k.includes('message') || k.includes('dm') || k.includes('conversation'))) {
    return json(res, 400, { error: 'That event is not a direct message.' });
  }

  // Resolve the two ids Zernio needs: the account and the conversation. The
  // conversation id lives only in the stored payload.
  const payload = evt.payload || {};
  const accountId = evt.zernio_account_id || pick(payload, 'account.id', 'accountId');
  const conversationId = pick(payload, 'message.conversationId', 'conversation.id', 'conversationId');

  if (!accountId || !conversationId) {
    return json(res, 422, {
      error: 'Could not resolve the account/conversation needed to reply to this DM.',
      missing: { accountId: !accountId, conversationId: !conversationId },
    });
  }

  // Fire the DM through Zernio with STANDARD messaging (works within the
  // platform's 24h window). We do NOT send the HUMAN_AGENT tag: Meta requires
  // Facebook App Review approval of the Human Agent feature on the underlying
  // app, and without it Zernio rejects the tag ("must be reviewed and approved
  // by Facebook"). To reply outside 24h later, that feature has to be approved
  // on Zernio's Meta app — then pass tag: 'HUMAN_AGENT' here.
  let zres;
  try {
    zres = await zernio.sendDirectMessage({ accountId, conversationId, message });
  } catch (e) {
    // Surface Zernio's error verbatim (e.g. 24h messaging window expired,
    // missing permission, conversation archived).
    return json(res, 502, { error: `DM send failed: ${e.message}`, zernio_status: e.status || null });
  }

  // Record the outbound DM as its own inbox_events row so the thread shows it
  // on the next read. Carry conversationId + direction so the conversations
  // grouping stitches it into the same thread. kind 'message_sent' keeps it
  // distinct from inbound messages; status 'processed' keeps it out of the
  // pending-signal detector. A logging failure must NOT fail the request — the
  // DM already sent.
  const outbound = {
    workspace_id: ws.id,
    account_id: evt.account_id,
    zernio_account_id: accountId,
    platform: evt.platform,
    kind: 'message_sent',
    author_handle: null,
    body: message,
    payload: {
      message: { conversationId, direction: 'outgoing', text: message },
      in_reply_to_event_id: evt.id,
      sent_by_user_id: auth.user.id,
      zernio_response: zres ?? null,
    },
    status: 'processed',
  };
  const inserted = await supabase.insert('inbox_events', outbound).catch((e) => ({ _logError: e.message }));

  return json(res, 200, {
    ok: true,
    dm: {
      message,
      conversation_id: conversationId,
      platform: evt.platform,
      recorded_event_id: Array.isArray(inserted) ? (inserted[0]?.id || null) : null,
    },
  });
}
