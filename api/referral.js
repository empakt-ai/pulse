// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Referral panel data — Creator-tier only at v1.
//
//   GET /api/referral
//     → { code, link_path, max_rewards, rewards_earned, rewards_pending,
//         rewards_converted, referrals: [{ number, status, signed_up_at,
//         converted_at, reward_applied_at }] }
//
// Tier-gated server-side — Brand/Agency get 403. The SPA also hides the
// panel client-side, but a poking user can't extract a code by hitting
// the endpoint directly.
//
// Privacy note: the referrals list intentionally omits referee identity.
// The referrer numbered each invite themselves; lifecycle state +
// timestamps is enough for the dashboard without leaking the referee's
// account info to the referrer.
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';
import { getOrCreateReferralCode } from './_lib/referral.js';

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  const tier = String(ws.tier || 'creator').toLowerCase();
  if (tier !== 'creator') {
    return json(res, 403, { error: 'Referrals are a Creator-tier feature.' });
  }
  // Paid Creators only — trialing Creators can't invite. The referrer
  // reward is a Stripe credit applied to their next invoice, which only
  // makes sense once they have a subscription. Also keeps the "free
  // month for inviting friends from a free trial" abuse vector closed.
  if (ws.trial_active) {
    return json(res, 403, { error: 'Referrals unlock once you upgrade from the trial.' });
  }

  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  // First-name powers the code prefix (NAWAZ7K-style). Falls back through
  // user_metadata.first_name → first word of full_name → null (helper
  // then uses 'MASHAL' as a placeholder prefix).
  const firstName = auth.user?.user_metadata?.first_name
                 || (auth.user?.user_metadata?.full_name || '').split(' ')[0]
                 || null;

  const codeRow = await getOrCreateReferralCode(auth.user.id, firstName);
  if (!codeRow) return json(res, 500, { error: 'Failed to mint referral code' });

  const referrals = await supabase.select('referrals', {
    select: 'id,status,signed_up_at,converted_at,reward_applied_at',
    eq: { referrer_user_id: auth.user.id },
    order: 'signed_up_at.desc',
    limit: 50,
  }).catch(() => []);

  const list = referrals || [];
  const total = list.length;

  return json(res, 200, {
    code: codeRow.code,
    // Path only — the panel builds the full link from window.location.origin
    // so preview/prod URLs stay correct without a per-env config.
    link_path: `/?ref=${encodeURIComponent(codeRow.code)}`,
    max_rewards:      codeRow.max_rewards || 3,
    rewards_earned:   codeRow.rewards_earned || 0,
    rewards_pending:  list.filter(r => r.status === 'pending').length,
    rewards_converted: list.filter(r => r.status === 'converted').length,
    referrals: list.map((r, i) => ({
      number: total - i,       // oldest = #1, newest = #N
      status: r.status,
      signed_up_at: r.signed_up_at,
      converted_at: r.converted_at,
      reward_applied_at: r.reward_applied_at,
    })),
  });
}
