// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Automation engine — config → flow compiler.
// ═════════════════════════════════════════════════════════════════════════
//
// Turns a comment→DM automation's config into an automation_flows.definition
// (the ordered step array the runner interprets). This is the ONE place that
// knows how the two headline features become steps:
//
//   • Delay (P1): a `delay` step with a randomized 2–5 min window, so the DM
//     and comment response go out a human-looking few minutes later.
//   • Follow-gate (P2): open a DM asking the commenter to follow, wait for
//     their reply, read the VERIFIED instagramProfile.isFollower off that
//     reply, and only then deliver — with one polite re-prompt if they haven't
//     followed yet.
//
// A plain automation (no delay, no gate) does NOT need this — it stays on
// Zernio's instant hosted automation. Only automations that need something
// Zernio can't do compile to a native flow (and then carry no Zernio twin, so
// nothing double-sends). See api/engage/automations.js for that routing.
//
// PURE + dependency-free on purpose: trivially unit-testable, and the offline
// end-to-end test asserts the exact step arrays this produces.

// Defaults for the 2–5 minute randomized delay (the literal ask).
export const DEFAULT_DELAY_MIN = 120;   // 2 min
export const DEFAULT_DELAY_MAX = 300;   // 5 min
const DELAY_CEILING = 6 * 60 * 60;      // 6h sanity cap

// How long to wait for the commenter to reply to the follow prompt before the
// run quietly expires. Inside Meta's 24h standard messaging window.
const REPLY_WAIT_SECONDS = 23 * 60 * 60;

const DEFAULT_FOLLOW_PROMPT =
  "Almost there! Make sure you're following so I can send this over — then reply here and I'll fire it right to you. 🙌";
const DEFAULT_REPROMPT =
  "Looks like you're not following yet — give the account a follow, then reply here once more and I'll send it. 🙏";

// Meta button_template hard limits (verified against Zernio's OpenAPI DmButton).
const MAX_BUTTONS = 3;
const MAX_QUICK_REPLIES = 13;
const BTN_TITLE_MAX = 20;
const PAYLOAD_MAX = 1000;      // Meta's postback/quick-reply payload ceiling

// Normalize the buttons array into Zernio's DmButton shape. Three types
// (verified against the OpenAPI spec): `url` and `postback` work on IG + FB,
// `phone` is FB-only. Drops anything malformed for its type; caps at 3 (Meta's
// button_template limit). A postback tap comes back on message.received as
// metadata.postbackPayload — see ingest's tap handling.
export function normalizeButtons(buttons) {
  if (!Array.isArray(buttons)) return [];
  const out = [];
  for (const b of buttons) {
    if (!b || out.length >= MAX_BUTTONS) break;
    const title = String(b.title || '').trim();
    if (!title) continue;
    const type = String(b.type || 'url').trim().toLowerCase();
    if (type === 'postback') {
      const payload = String(b.payload || '').trim();
      if (!payload) continue;
      out.push({ type: 'postback', title: title.slice(0, BTN_TITLE_MAX), payload: payload.slice(0, PAYLOAD_MAX) });
    } else if (type === 'phone') {
      const phone = String(b.phone || '').trim();
      if (!/^\+?[0-9][0-9\s\-().]{4,}$/.test(phone)) continue;
      out.push({ type: 'phone', title: title.slice(0, BTN_TITLE_MAX), phone });
    } else {
      const url = String(b.url || '').trim();
      if (!/^https?:\/\//i.test(url)) continue;
      out.push({ type: 'url', title: title.slice(0, BTN_TITLE_MAX), url });
    }
  }
  return out;
}

// Normalize quick-reply chips: { title, payload }, max 13 (Zernio/Meta limit).
// Payload defaults to the title so a chip is usable without a separate value.
// Chips render only in an OPEN thread (not IG's Requests folder), so the
// flow-builder attaches them to in-thread sends, never the cold opener.
export function normalizeQuickReplies(quickReplies) {
  if (!Array.isArray(quickReplies)) return [];
  const out = [];
  for (const q of quickReplies) {
    if (!q || out.length >= MAX_QUICK_REPLIES) break;
    const title = String(q.title || '').trim();
    if (!title) continue;
    const payload = String(q.payload || title).trim();
    out.push({ title: title.slice(0, BTN_TITLE_MAX), payload: payload.slice(0, PAYLOAD_MAX) });
  }
  return out;
}

// Normalize a delay config into { min, max } seconds, or null when disabled.
export function normalizeDelay(delay) {
  if (!delay) return null;
  let min = Number(delay.min_seconds ?? delay.min);
  let max = Number(delay.max_seconds ?? delay.max);
  if (!Number.isFinite(min) || min < 0) min = 0;
  if (!Number.isFinite(max) || max < 0) max = 0;
  if (min === 0 && max === 0) return null;
  if (max < min) max = min;
  min = Math.min(min, DELAY_CEILING);
  max = Math.min(max, DELAY_CEILING);
  return { min, max };
}

// Decide which execution surface an automation belongs on:
//   'native'  — our engine (needs delay and/or follow-gate, or a DM-keyword
//               trigger, which Zernio's comment-only hosted automation can't do)
//   'zernio'  — Zernio's instant hosted automation (plain comment→DM)
export function deriveEngine({ delay, requireFollow, triggerType } = {}) {
  if (triggerType === 'message') return 'native';   // Zernio hosts comments only
  return (normalizeDelay(delay) || requireFollow) ? 'native' : 'zernio';
}

// Compile a config into the step array.
//   cfg = {
//     dmMessage,                 // the payload DM (required)
//     commentReply,              // optional public reply on the comment
//     delay: { min_seconds, max_seconds } | null,
//     requireFollow: bool,
//     followPrompt, rePrompt,    // optional custom gate copy
//     triggerType: 'comment' | 'message',
//   }
// The delay is applied to the *delivery* (the requested DM + public reply) —
// for the gate that means "after they follow, send after the delay", matching
// the ask exactly; for the plain-with-delay case it wraps the whole response.
export function buildFlowDefinition(cfg = {}) {
  const dmMessage = String(cfg.dmMessage || '').trim();
  const commentReply = cfg.commentReply ? String(cfg.commentReply).trim() : null;
  const delay = normalizeDelay(cfg.delay);
  const requireFollow = !!cfg.requireFollow;
  const followPrompt = String(cfg.followPrompt || DEFAULT_FOLLOW_PROMPT).trim();
  const rePrompt = String(cfg.rePrompt || DEFAULT_REPROMPT).trim();
  const buttons = normalizeButtons(cfg.buttons);
  const quickReplies = normalizeQuickReplies(cfg.quickReplies);
  // Attach interactive elements to a send step. Buttons and chips are mutually
  // exclusive (Meta), so buttons win when both are set. Buttons render even in
  // IG's Requests folder (cold openers); chips render only in an OPEN thread, so
  // they're allowed only where chips:true (in-thread sends), never on a cold
  // private-reply opener. Handlers forward `buttons`/`quick_replies` to Zernio.
  const withInteractive = (step, { chips = false } = {}) => {
    if (buttons.length) return { ...step, buttons };
    if (chips && quickReplies.length) return { ...step, quick_replies: quickReplies };
    return step;
  };

  const steps = [];
  const delayStep = () => ({ type: 'delay', min_seconds: delay.min, max_seconds: delay.max });

  // DM-keyword trigger: the person already DMed us, so the thread is open —
  // reply straight into it (via 'conversation', not a private-reply opener) and
  // there's no comment to publicly reply to. Delay + buttons/chips still apply.
  if (cfg.triggerType === 'message') {
    if (delay) steps.push(delayStep());
    steps.push(withInteractive({ type: 'send_dm', via: 'conversation', text: dmMessage }, { chips: true }));
    return steps;
  }

  if (!requireFollow) {
    // Plain (optionally delayed) comment→DM. The first DM to a fresh commenter
    // must open the thread, so it's a private_reply (opener → buttons only).
    if (delay) steps.push(delayStep());
    if (commentReply) steps.push({ type: 'comment_reply', text: commentReply });
    steps.push(withInteractive({ type: 'send_dm', via: 'private_reply', text: dmMessage }));
    return steps;
  }

  // Follow-gate. Two-step by necessity: isFollower is only knowable once the
  // commenter replies, so we open a DM, wait, verify, then deliver.
  //   0  opener (private reply asking them to follow + reply)
  //   1  wait for their reply  (no reply → run expires)
  //   2  condition: are they now a follower?   yes → fall through; no → re-prompt
  steps.push(withInteractive({ type: 'send_dm', via: 'private_reply', text: followPrompt }));
  steps.push({ type: 'wait_for_reply', timeout_seconds: REPLY_WAIT_SECONDS });
  const condOpen = { type: 'condition', field: 'contact.is_follower', op: 'is_true', else: null };
  steps.push(condOpen);

  // Delivery block — reached when they ARE following. Delay applies here.
  const deliveryIdx = steps.length;
  if (delay) steps.push(delayStep());
  if (commentReply) steps.push({ type: 'comment_reply', text: commentReply });
  steps.push({ type: 'send_dm', via: 'conversation', text: dmMessage });
  steps.push({ type: 'end' });                       // stop before the re-prompt block

  // Re-prompt block — reached once when they replied but still don't follow.
  const repromptIdx = steps.length;
  steps.push({ type: 'send_dm', via: 'conversation', text: rePrompt });
  steps.push({ type: 'wait_for_reply', timeout_seconds: REPLY_WAIT_SECONDS });
  steps.push({ type: 'condition', field: 'contact.is_follower', op: 'is_true', else: 'done' });
  steps.push({ type: 'goto', to: deliveryIdx });     // now following → deliver

  condOpen.else = repromptIdx;                        // wire the opener's "not yet" branch
  return steps;
}

// Build the trigger object for a flow from the automation config.
//   'comment' (default) — keyword comment, scoped to a post or all posts.
//   'message'           — keyword in an inbound DM (no post scope — no post).
export function buildTrigger({ keywords, matchMode, platformPostId, triggerType } = {}) {
  const kw = Array.isArray(keywords) ? keywords : [];
  const match_mode = matchMode === 'exact' ? 'exact' : 'contains';
  if (triggerType === 'message') {
    return { type: 'message', keywords: kw, match_mode };
  }
  const t = {
    type: 'comment',
    keywords: kw,
    match_mode,
    post_scope: platformPostId ? 'post' : 'all',
  };
  if (platformPostId) t.platform_post_id = String(platformPostId);
  return t;
}

export default { buildFlowDefinition, buildTrigger, deriveEngine, normalizeDelay, normalizeButtons, normalizeQuickReplies, DEFAULT_DELAY_MIN, DEFAULT_DELAY_MAX };
