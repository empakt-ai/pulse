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

// Normalize the buttons array into what Zernio's private-reply expects
// ({type:'url', title, url}). Drops anything malformed; caps at 3 (Meta's
// button_template limit). URL-only for v1 — postback/phone come later.
export function normalizeButtons(buttons) {
  if (!Array.isArray(buttons)) return [];
  const out = [];
  for (const b of buttons) {
    if (!b || out.length >= 3) break;
    const title = String(b.title || '').trim();
    const url = String(b.url || '').trim();
    if (!title || !/^https?:\/\//i.test(url)) continue;
    out.push({ type: 'url', title: title.slice(0, 20), url });
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
//   'native'  — our engine (needs delay and/or follow-gate)
//   'zernio'  — Zernio's instant hosted automation (plain comment→DM)
export function deriveEngine({ delay, requireFollow } = {}) {
  return (normalizeDelay(delay) || requireFollow) ? 'native' : 'zernio';
}

// Compile a config into the step array.
//   cfg = {
//     dmMessage,                 // the payload DM (required)
//     commentReply,              // optional public reply on the comment
//     delay: { min_seconds, max_seconds } | null,
//     requireFollow: bool,
//     followPrompt, rePrompt,    // optional custom gate copy
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
  // Buttons ride on the private-reply opener (the cold-reach message that lands
  // in the Requests folder, where buttons — unlike chips — actually render).
  const withButtons = (step) => (buttons.length ? { ...step, buttons } : step);

  const steps = [];
  const delayStep = () => ({ type: 'delay', min_seconds: delay.min, max_seconds: delay.max });

  if (!requireFollow) {
    // Plain (optionally delayed) comment→DM. The first DM to a fresh commenter
    // must open the thread, so it's a private_reply.
    if (delay) steps.push(delayStep());
    if (commentReply) steps.push({ type: 'comment_reply', text: commentReply });
    steps.push(withButtons({ type: 'send_dm', via: 'private_reply', text: dmMessage }));
    return steps;
  }

  // Follow-gate. Two-step by necessity: isFollower is only knowable once the
  // commenter replies, so we open a DM, wait, verify, then deliver.
  //   0  opener (private reply asking them to follow + reply)
  //   1  wait for their reply  (no reply → run expires)
  //   2  condition: are they now a follower?   yes → fall through; no → re-prompt
  steps.push(withButtons({ type: 'send_dm', via: 'private_reply', text: followPrompt }));
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

// Build the trigger object for a comment→DM flow from the automation config.
export function buildTrigger({ keywords, matchMode, platformPostId } = {}) {
  const t = {
    type: 'comment',
    keywords: Array.isArray(keywords) ? keywords : [],
    match_mode: matchMode === 'exact' ? 'exact' : 'contains',
    post_scope: platformPostId ? 'post' : 'all',
  };
  if (platformPostId) t.platform_post_id = String(platformPostId);
  return t;
}

export default { buildFlowDefinition, buildTrigger, deriveEngine, normalizeDelay, DEFAULT_DELAY_MIN, DEFAULT_DELAY_MAX };
