// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Referral system helpers — Creator-tier only at v1.
//
// Flow:
//   1. Referrer's code is lazy-created via getOrCreateReferralCode() the
//      first time they hit GET /api/referral.
//   2. Referee lands on /?ref=CODE → SPA stashes it in localStorage and
//      passes it as `trial_promo_code` when creating the workspace.
//   3. Workspace POST (api/workspaces.js) calls recordReferralAttribution
//      which writes a referrals row in 'pending' state.
//   4. Stripe checkout completes for the referee → webhook calls
//      convertReferralIfAny → applyReferralCredit. If the referrer is a
//      paying customer with rewards_earned < max_rewards, a $15 credit
//      is added to their Stripe customer balance.
//   5. If the referrer is still on trial when the conversion lands, the
//      credit is deferred — applyOutstandingReferralCredits() flushes
//      any 'converted' rows on the referrer's own first checkout.
//
// Anti-abuse: same-handle re-signups are already blocked by
// handle_registry (migration 015). A duplicate handle can't complete
// the trial funnel, so the referral row just expires un-converted.
// ═════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase.js';
import { createCustomerCredit } from './stripe.js';

// Creator-tier monthly price in cents. The credit amount per successful
// referral. If we ever scale referrals beyond Creator, this becomes a
// tier-keyed map (see api/_lib/tiers.js for the source of truth).
const CREDIT_CENTS_PER_REFERRAL = 1500;

// Code alphabet — uppercase alphanumeric minus 0/O/1/I/L to keep verbal
// sharing unambiguous. 32 chars.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomChars(n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

// Builds a code like 'NAWAZ7K' — uppercase first name (sanitised, max 8
// chars) + 3 random chars from the ambiguity-free alphabet. Falls back
// to 'MASHAL' as the prefix when no first_name is available so the code
// stays human-readable.
export function generateReferralCode(firstName) {
  const cleaned = String(firstName || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 8);
  const prefix = cleaned || 'MASHAL';
  return `${prefix}${randomChars(3)}`;
}

// SELECT first; INSERT with a generated code if missing. Retries on
// uniqueness collisions up to 5 times — at 32^3 = 32k tail variants
// per prefix, real collisions are vanishingly rare; the retry is a
// defensive guard, not a hot path.
export async function getOrCreateReferralCode(userId, firstName) {
  if (!userId) return null;

  const existing = await supabase.select('referral_codes', {
    select: 'user_id,code,rewards_earned,max_rewards',
    eq: { user_id: userId },
    single: true,
  }).catch(() => null);
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode(firstName);
    try {
      const inserted = await supabase.insert('referral_codes', {
        user_id: userId,
        code,
      });
      return inserted?.[0] || { user_id: userId, code, rewards_earned: 0, max_rewards: 3 };
    } catch (e) {
      // 23505 = unique_violation. Retry with a fresh random tail.
      if (!/unique|duplicate|23505/i.test(e.message || '')) throw e;
    }
  }
  throw new Error('referral code generation failed after 5 attempts');
}

// Resolve referrer + record the attribution. Called from POST /api/workspaces
// when a brand-new workspace lands with a non-empty trial_promo_code.
// Returns the inserted row, or null if the code doesn't map to a real
// referrer, or if this would be a self-referral. Safe to call with a
// non-referral promo code (e.g. a marketing campaign code) — it just
// returns null and the campaign attribution sits on workspaces.trial_promo_code.
export async function recordReferralAttribution({ refereeWorkspaceId, refereeUserId, code }) {
  if (!code || !refereeWorkspaceId || !refereeUserId) return null;
  const normalised = String(code).trim().toUpperCase();
  if (!normalised) return null;

  const rc = await supabase.select('referral_codes', {
    select: 'user_id,code',
    eq: { code: normalised },
    single: true,
  }).catch(() => null);
  if (!rc) return null;                                    // not a referral code
  if (rc.user_id === refereeUserId) return null;           // self-referral

  try {
    const rows = await supabase.insert('referrals', {
      referrer_user_id:     rc.user_id,
      referee_user_id:      refereeUserId,
      referee_workspace_id: refereeWorkspaceId,
      code_used:            normalised,
      status:               'pending',
    });
    return rows?.[0] || null;
  } catch (e) {
    // UNIQUE(referee_workspace_id) — the workspace already has an
    // attribution. Silently ignore; the first one wins.
    if (/unique|duplicate|23505/i.test(e.message || '')) return null;
    throw e;
  }
}

// Webhook hook — called from checkout.session.completed once we know the
// referee's workspace has actually paid. Flips 'pending' → 'converted'
// (idempotent: a second call is a no-op). Returns the updated row so the
// caller can hand it to applyReferralCredit.
export async function convertReferralIfAny(refereeWorkspaceId) {
  if (!refereeWorkspaceId) return null;
  const row = await supabase.select('referrals', {
    select: '*',
    eq: { referee_workspace_id: refereeWorkspaceId },
    single: true,
  }).catch(() => null);
  if (!row) return null;
  // Already past 'pending' — nothing to do.
  if (row.status !== 'pending') return row;

  const updated = await supabase.update('referrals',
    { status: 'converted', converted_at: new Date().toISOString() },
    { eq: { id: row.id } },
  ).catch(() => null);
  return (updated && updated[0]) || { ...row, status: 'converted', converted_at: new Date().toISOString() };
}

// Apply the Stripe credit for a single referral. Returns one of:
//   { applied: true }                            — credit posted, row stamped rewarded
//   { applied: false, reason: 'over_cap' }       — referrer hit their max_rewards
//   { applied: false, reason: 'no_customer' }    — referrer isn't a paying Stripe customer yet
//                                                  (row stays 'converted' until they upgrade)
//   { applied: false, reason: 'already_rewarded' } — idempotency short-circuit
//
// Stripe idempotency-key is the referral row id so webhook retries can't
// double-credit the same referrer.
export async function applyReferralCredit(referralRow) {
  if (!referralRow || !referralRow.id) return { applied: false, reason: 'missing_row' };
  if (referralRow.status === 'rewarded' || referralRow.reward_applied_at) {
    return { applied: false, reason: 'already_rewarded' };
  }

  // Look up the referrer's code + Stripe customer in parallel.
  const [code, profile] = await Promise.all([
    supabase.select('referral_codes', {
      select: 'user_id,rewards_earned,max_rewards',
      eq: { user_id: referralRow.referrer_user_id },
      single: true,
    }).catch(() => null),
    supabase.select('profiles', {
      select: 'id,stripe_customer_id',
      eq: { id: referralRow.referrer_user_id },
      single: true,
    }).catch(() => null),
  ]);

  if (!code) return { applied: false, reason: 'no_code_row' };
  if (code.rewards_earned >= code.max_rewards) {
    return { applied: false, reason: 'over_cap' };
  }
  if (!profile?.stripe_customer_id) {
    // Referrer is still on trial. Leave row as 'converted'; the credit
    // will be flushed by applyOutstandingReferralCredits when they
    // eventually convert themselves.
    return { applied: false, reason: 'no_customer' };
  }

  try {
    await createCustomerCredit({
      customerId:   profile.stripe_customer_id,
      amountCents:  CREDIT_CENTS_PER_REFERRAL,
      description:  `Mashal referral credit — code ${referralRow.code_used}`,
      idempotencyKey: `referral_credit_${referralRow.id}`,
    });
  } catch (e) {
    return { applied: false, reason: 'stripe_error', error: e.message };
  }

  // Stamp the row + bump the counter. Two separate updates is fine —
  // the idempotency-key on the Stripe call means a retry that hits this
  // path again is harmless on the Stripe side.
  await supabase.update('referrals',
    { status: 'rewarded', reward_applied_at: new Date().toISOString() },
    { eq: { id: referralRow.id } },
  ).catch(() => {});
  await supabase.update('referral_codes',
    { rewards_earned: (code.rewards_earned || 0) + 1 },
    { eq: { user_id: referralRow.referrer_user_id } },
  ).catch(() => {});

  return { applied: true };
}

// Flush any 'converted' referrals that were deferred because the
// referrer wasn't a Stripe customer at conversion time. Called from
// checkout.session.completed AFTER the referrer's own profile has been
// stamped with stripe_customer_id. Walks each converted-but-not-rewarded
// row and tries applyReferralCredit; stops at the cap.
export async function applyOutstandingReferralCredits(userId) {
  if (!userId) return { applied: 0 };
  const pending = await supabase.select('referrals', {
    select: '*',
    eq: { referrer_user_id: userId, status: 'converted' },
    order: 'converted_at.asc',
  }).catch(() => []);
  let applied = 0;
  for (const row of pending || []) {
    const r = await applyReferralCredit(row);
    if (r.applied) applied++;
    else if (r.reason === 'over_cap') break;     // cap hit, stop trying
  }
  return { applied };
}
