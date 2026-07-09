// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Automation engine — step handler registry.
// ═════════════════════════════════════════════════════════════════════════
//
// THIS is the extension seam. A flow's `definition` is an ordered array of
// steps; each step has a `type` that maps to one handler here. Adding a
// ManyChat-parity capability (buttons, sequences, A/B split, external
// webhook, SMS…) means adding ONE handler to this map — the tables, the
// runner, the worker, and the scheduler never change. That is the whole
// point of building the generic runtime (P0) before any single feature.
//
// A handler receives (step, ctx) and returns an ACTION telling the runner
// what to do next:
//   { next: true }                       advance to the following step
//   { jump: <index> }                    go to a specific step
//   { wait: { kind, resumeAt|expiresAt } } pause; the worker resumes later
//   { done: true }                       finish the run successfully
//   { fail: '<reason>' }                 finish the run as failed
//
// ctx = { flow, contact, run, context } where `context` is the run's mutable
// variable bag (comment_id, platform_post_id, last_reply, …). Handlers may
// mutate ctx.context and ctx.contact; the runner persists them.

import zernio from '../zernio.js';
import { logEvent, bumpFlowStat } from './events.js';
import { updateContact } from './contacts.js';

// ── tiny helpers ───────────────────────────────────────────────────────────

// Resolve a dotted path against the ctx view {contact, context, flow}.
function resolvePath(path, ctx) {
  if (!path) return undefined;
  const root = { contact: ctx.contact || {}, context: ctx.context || {}, flow: ctx.flow || {} };
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), root);
}

// {{contact.name}} / {{context.comment_text}} substitution. Unknown tokens
// render empty so a template never leaks raw braces to a user.
function renderTemplate(text, ctx) {
  if (!text || typeof text !== 'string') return text || '';
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const v = resolvePath(path, ctx);
    return v == null ? '' : String(v);
  });
}

function toSeconds(step) {
  if (Number.isFinite(step.seconds)) return Math.max(0, step.seconds);
  const min = Number.isFinite(step.min_seconds) ? step.min_seconds : null;
  const max = Number.isFinite(step.max_seconds) ? step.max_seconds : null;
  if (min != null && max != null && max >= min) {
    // Randomized, human-looking delay (the 2–5 min ask lives here). Math.random
    // is fine in this Node runtime — the no-random rule is Workflow-script only.
    return Math.round(min + Math.random() * (max - min));
  }
  if (min != null) return min;
  return 0;
}

// ── handlers ────────────────────────────────────────────────────────────────

// send_dm — deliver a direct message.
//   { text, tag?, via?: 'conversation' | 'private_reply', buttons?, quick_replies? }
// 'conversation' replies into an existing thread (contact.conversation_id).
// 'private_reply' is the first-touch DM to a commenter with no open thread —
// the comment→DM / follow-gate opener — via Zernio's verified
// sendPrivateReply (IG/FB only, 1 per comment, within 7 days). For cold reach
// the DM lands in IG's Message Requests folder where quick-reply chips don't
// render, so pass `buttons` (not `quick_replies`) for any tappable element.
async function send_dm(step, ctx) {
  const message = renderTemplate(step.text, ctx);
  if (!message) return { fail: 'send_dm: empty text' };
  const accountId = ctx.flow.zernio_account_id;
  const via = step.via || 'conversation';

  try {
    let res;
    if (via === 'private_reply') {
      // Needs the triggering comment's post + comment ids (captured in run
      // context at trigger time). The opener has no conversationId yet — it
      // arrives on the reply's message.received webhook, which resumes the run.
      const postId = ctx.context?.platform_post_id;
      const commentId = ctx.context?.comment_id;
      if (!postId || !commentId) return { fail: 'send_dm(private_reply): missing post/comment id in context' };
      res = await zernio.sendPrivateReply({
        accountId, postId, commentId, message,
        buttons: step.buttons || null, quickReplies: step.quick_replies || null,
      });
      if (res?.messageId) ctx.context.private_reply_message_id = res.messageId;
    } else {
      const conversationId = ctx.contact?.conversation_id || ctx.context?.conversation_id;
      if (!conversationId) return { fail: 'send_dm: no conversation_id on contact' };
      res = await zernio.sendDirectMessage({ accountId, conversationId, message, tag: step.tag || null });
    }
    await bumpFlowStat(ctx.flow.id, 'stat_dms_sent');
    await logEvent({ workspaceId: ctx.flow.workspace_id, flowId: ctx.flow.id, runId: ctx.run.id, contactId: ctx.contact?.id, kind: 'dm_sent', meta: { via, chars: message.length } });
    return { next: true };
  } catch (e) {
    await bumpFlowStat(ctx.flow.id, 'stat_dms_failed');
    await logEvent({ workspaceId: ctx.flow.workspace_id, flowId: ctx.flow.id, runId: ctx.run.id, contactId: ctx.contact?.id, kind: 'dm_failed', meta: { via, error: e.message } });
    return { fail: `send_dm: ${e.message}` };
  }
}

// comment_reply — public reply to the comment that triggered the flow.
//   { text }
async function comment_reply(step, ctx) {
  const message = renderTemplate(step.text, ctx);
  if (!message) return { fail: 'comment_reply: empty text' };
  const postId = ctx.context?.platform_post_id;
  const commentId = ctx.context?.comment_id;
  if (!postId || !commentId) return { fail: 'comment_reply: missing post/comment id in context' };
  try {
    await zernio.replyToComment({ accountId: ctx.flow.zernio_account_id, postId, commentId, message });
    await logEvent({ workspaceId: ctx.flow.workspace_id, flowId: ctx.flow.id, runId: ctx.run.id, contactId: ctx.contact?.id, kind: 'comment_replied', meta: { chars: message.length } });
    return { next: true };
  } catch (e) {
    await logEvent({ workspaceId: ctx.flow.workspace_id, flowId: ctx.flow.id, runId: ctx.run.id, contactId: ctx.contact?.id, kind: 'comment_reply_failed', meta: { error: e.message } });
    return { fail: `comment_reply: ${e.message}` };
  }
}

// delay — pause the run for a fixed or randomized number of seconds. This is
// the P1 "wait 2–5 minutes before answering" step: { min_seconds:120, max_seconds:300 }.
async function delay(step, ctx) {
  const secs = toSeconds(step);
  if (secs <= 0) return { next: true };
  const resumeAt = new Date(Date.now() + secs * 1000).toISOString();
  await logEvent({ workspaceId: ctx.flow.workspace_id, flowId: ctx.flow.id, runId: ctx.run.id, contactId: ctx.contact?.id, kind: 'delay_scheduled', meta: { seconds: secs, resume_at: resumeAt } });
  return { wait: { kind: 'delay', resumeAt } };
}

// wait_for_reply — pause until the contact replies in the DM thread (the
// runner is resumed by the message webhook) or the window elapses.
//   { timeout_seconds? }  default 24h (Meta's standard messaging window)
async function wait_for_reply(step, ctx) {
  const secs = Number.isFinite(step.timeout_seconds) ? step.timeout_seconds : 86_400;
  const expiresAt = new Date(Date.now() + secs * 1000).toISOString();
  return { wait: { kind: 'reply', expiresAt } };
}

// condition — branch on contact/context state. The follow-gate is exactly this:
//   { field:'contact.is_follower', op:'is_true', else:'done' }
// true → next step; false → `else` (a step index, or 'done' to stop).
async function condition(step, ctx) {
  const actual = resolvePath(step.field, ctx);
  const expected = step.value;
  let pass;
  switch (step.op) {
    case 'is_true':   pass = actual === true; break;
    case 'is_false':  pass = actual === false; break;
    case 'exists':    pass = actual != null && actual !== ''; break;
    case 'not_exists':pass = actual == null || actual === ''; break;
    case 'eq':        pass = actual === expected; break;
    case 'neq':       pass = actual !== expected; break;
    case 'contains':  pass = String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase()); break;
    default:          pass = !!actual;
  }
  if (pass) return { next: true };
  if (step.else === 'done' || step.else == null) return { done: true };
  return { jump: Number(step.else) };
}

// set_tag — add/remove tags on the contact. { add:[], remove:[] }
async function set_tag(step, ctx) {
  const current = new Set(ctx.contact?.tags || []);
  for (const t of (step.add || [])) current.add(t);
  for (const t of (step.remove || [])) current.delete(t);
  const tags = [...current];
  await updateContact(ctx.contact.id, { tags });
  ctx.contact.tags = tags;
  return { next: true };
}

// set_field — write a custom field on the contact. { key, value }
async function set_field(step, ctx) {
  if (!step.key) return { next: true };
  const fields = { ...(ctx.contact?.fields || {}), [step.key]: renderTemplate(String(step.value ?? ''), ctx) };
  await updateContact(ctx.contact.id, { fields });
  ctx.contact.fields = fields;
  return { next: true };
}

// goto — unconditional jump. { to: <index> }
async function goto(step) {
  return { jump: Number(step.to) };
}

// end — terminate the run early. (Alias: 'stop'.)
async function end() {
  return { done: true };
}

export const STEP_HANDLERS = {
  send_dm,
  comment_reply,
  delay,
  wait_for_reply,
  condition,
  set_tag,
  set_field,
  goto,
  end,
  stop: end,
};

export function getStepHandler(type) {
  return STEP_HANDLERS[type] || null;
}

export { renderTemplate, resolvePath };
export default { STEP_HANDLERS, getStepHandler, renderTemplate, resolvePath };
