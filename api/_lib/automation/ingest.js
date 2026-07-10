// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Automation engine — ingest (webhook → runs).
// ═════════════════════════════════════════════════════════════════════════
//
// Turns inbound platform events into engine work:
//   onComment  — a keyword comment starts matching flows (one run per flow)
//   onMessage  — an inbound DM resumes any run waiting on this contact's reply
//                (and can itself trigger message-keyword flows)
//
// This is the ONLY place that reads platform payloads. The runner and steps
// stay platform-agnostic — they operate on the normalized contact + context.
// Nothing here fires unless the caller (the webhook seam) is behind the
// engine flag, so P0 ships inert.

import { supabase } from '../supabase.js';
import { upsertContact, applyFollowerFromMessage } from './contacts.js';
import { startRun, resumeRun, cancelJobsForRun } from './runner.js';
import { logEvent } from './events.js';

// Defensive nested-key reader (mirrors the webhook handler's `pick`).
function pick(obj, ...keys) {
  for (const k of keys) {
    const v = k.split('.').reduce((o, kk) => (o == null ? null : o[kk]), obj);
    if (v != null) return v;
  }
  return null;
}

// Does this comment text satisfy the flow's keyword trigger?
function keywordMatch(trigger, text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return false;
  const keywords = (trigger?.keywords || []).map(k => String(k).toLowerCase().trim()).filter(Boolean);
  if (!keywords.length) return true;                 // no keywords = match any comment
  const mode = trigger?.match_mode || 'contains';
  if (mode === 'exact') return keywords.some(k => t === k);
  return keywords.some(k => t.includes(k));          // 'contains' (default)
}

// Does the flow apply to the post the comment is on?
function postScopeMatch(trigger, platformPostId) {
  const scope = trigger?.post_scope || 'all';
  if (scope === 'all') return true;
  if (scope === 'post') return String(trigger?.platform_post_id || '') === String(platformPostId || '');
  return true;                                       // 'next' etc. — treated as all for P0
}

// Load the active flows attached to a Zernio account. Small result set
// (a handful per account), so we fetch and filter in JS rather than trying to
// express trigger-shape predicates through PostgREST.
async function activeFlowsFor(workspaceId, zernioAccountId) {
  const rows = await supabase.select('automation_flows', {
    select: '*', eq: { workspace_id: workspaceId, zernio_account_id: zernioAccountId },
  }).catch(() => []);
  return (rows || []).filter(f => f.is_active);
}

// ── comment.received ────────────────────────────────────────────────────────
export async function onComment(event) {
  const { workspaceId, accountId, zernioAccountId, platform, platformPostId, payload } = event;
  if (!workspaceId || !zernioAccountId) return { skipped: 'unresolved' };

  const text = pick(payload, 'comment.text', 'comment.message', 'text') || event.text || '';
  const commentId = pick(payload, 'comment.id', 'comment._id', 'commentId');
  const authorId = pick(payload, 'comment.author.id', 'comment.from.id', 'comment.author.userId', 'from.id');
  const handle = event.authorHandle || pick(payload, 'comment.author.username', 'comment.from.username');
  const name = pick(payload, 'comment.author.name', 'comment.from.name');

  const flows = (await activeFlowsFor(workspaceId, zernioAccountId))
    .filter(f => (f.trigger?.type || 'comment') === 'comment')
    .filter(f => !f.platform || !platform || f.platform === platform)
    .filter(f => keywordMatch(f.trigger, text) && postScopeMatch(f.trigger, platformPostId));

  if (!flows.length) return { matched: 0 };
  if (!authorId) {
    // Can't build a stable contact identity without the commenter id — the
    // follow-gate and dedup both need it. Record the miss and bail.
    await logEvent({ workspaceId, kind: 'comment_no_author', meta: { platform, commentId } });
    return { matched: flows.length, skipped: 'no_author_id' };
  }

  const contact = await upsertContact({
    workspaceId, accountId, zernioAccountId, platform,
    platformUserId: authorId, handle, name,
  });
  if (!contact) return { matched: flows.length, skipped: 'contact_failed' };
  if (contact.automation_paused) return { matched: flows.length, skipped: 'contact_paused' };

  const results = [];
  for (const flow of flows) {
    const r = await startRun(flow, contact, {
      triggerRef: commentId ? `comment:${commentId}` : null,
      context: {
        comment_id: commentId,
        platform_post_id: platformPostId,
        post_id: event.postId || null,
        comment_text: text,
        platform,
        zernio_account_id: zernioAccountId,
        account_id: accountId,
      },
    }).catch((e) => ({ error: e.message }));
    results.push({ flow_id: flow.id, ...r });
  }
  return { matched: flows.length, runs: results };
}

// ── message.received ────────────────────────────────────────────────────────
export async function onMessage(event) {
  const { workspaceId, accountId, zernioAccountId, platform, payload } = event;
  if (!workspaceId || !zernioAccountId) return { skipped: 'unresolved' };

  const conversationId = pick(payload, 'message.conversationId', 'conversation.id', 'conversationId');
  const senderId = pick(payload, 'message.sender.id', 'message.from.id', 'sender.id', 'from.id');
  const text = pick(payload, 'message.text', 'text', 'message.message') || event.text || '';
  const handle = event.authorHandle || pick(payload, 'message.sender.username', 'message.from.username');
  const name = pick(payload, 'message.sender.name', 'message.from.name');
  if (!senderId) return { skipped: 'no_sender_id' };

  // Interactive tap metadata. Zernio surfaces button/chip taps on
  // message.received under a top-level `metadata` object (verified against the
  // OpenAPI spec): postback → { postbackPayload, postbackTitle }, chip →
  // { quickReplyPayload }. A postback tap often carries NO message text, so we
  // fold the tapped title/payload into the text we keyword-match AND stash the
  // structured tap in run context so a later step can read exactly what was
  // tapped. `metadata` sits at the payload root; check message.metadata too,
  // since Zernio's payload field names aren't fully pinned in their docs.
  const meta = (payload && (payload.metadata || (payload.message && payload.message.metadata))) || {};
  const tapKind = meta.postbackPayload != null ? 'postback'
    : (meta.quickReplyPayload != null ? 'quick_reply' : null);
  const tap = tapKind
    ? { kind: tapKind, payload: (tapKind === 'postback' ? meta.postbackPayload : meta.quickReplyPayload) || null, title: meta.postbackTitle || null }
    : null;
  const matchText = String(text || (tap && (tap.title || tap.payload)) || '');

  let contact = await upsertContact({
    workspaceId, accountId, zernioAccountId, platform,
    platformUserId: senderId, handle, name, conversationId,
  });
  if (!contact) return { skipped: 'contact_failed' };
  // The verified follow answer lives on the received message — apply it now so
  // any condition step the resume runs reads fresh follower state.
  contact = await applyFollowerFromMessage(contact, payload);
  if (tap) {
    await logEvent({ workspaceId, contactId: contact.id, kind: 'tap_received', meta: tap }).catch(() => {});
  }

  const resumed = [];
  if (!contact.automation_paused) {
    const waiting = await supabase.select('automation_runs', {
      select: '*', eq: { contact_id: contact.id, status: 'waiting', wait_kind: 'reply' },
    }).catch(() => []);
    for (const run of (waiting || [])) {
      run.context = {
        ...(run.context || {}),
        last_reply: { text, at: new Date().toISOString(), conversation_id: conversationId },
        ...(tap ? { last_tap: tap } : {}),      // what they tapped — a step can branch on it
      };
      await supabase.update('automation_runs', { context: run.context }, { eq: { id: run.id } }).catch(() => {});
      await cancelJobsForRun(run.id, { kinds: ['timeout'] });   // reply beat the timeout
      const r = await resumeRun(run).catch((e) => ({ status: 'failed', error: e.message }));
      resumed.push({ run_id: run.id, ...r });
    }
  }

  // Independent message-keyword flows (DM auto-replies). Kept separate from the
  // resume path above so a reply can both continue a gate AND trigger a flow.
  // A tapped chip/postback fans out here too: its title/payload is in matchText,
  // so a "menu" reply can route taps to keyword flows (the in-DM keyword trigger).
  const started = [];
  if (!contact.automation_paused) {
    const flows = (await activeFlowsFor(workspaceId, zernioAccountId))
      .filter(f => (f.trigger?.type) === 'message')
      .filter(f => !f.platform || !platform || f.platform === platform)
      .filter(f => keywordMatch(f.trigger, matchText));
    for (const flow of flows) {
      const r = await startRun(flow, contact, {
        triggerRef: conversationId ? `message:${conversationId}:${Date.now()}` : null,
        context: { conversation_id: conversationId, message_text: matchText, platform, zernio_account_id: zernioAccountId, account_id: accountId, ...(tap ? { last_tap: tap } : {}) },
      }).catch((e) => ({ error: e.message }));
      started.push({ flow_id: flow.id, ...r });
    }
  }

  return { resumed, started };
}

export default { onComment, onMessage };
