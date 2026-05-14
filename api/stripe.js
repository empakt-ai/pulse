// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Stripe-facing endpoints exposed to the SPA. Single
// function, action-routed.
//
//   POST /api/stripe?action=checkout
//     body: { tier?: 'creator'|'brand'|'agency' }
//     Creates a Stripe Checkout Session for the caller's active workspace.
//     Falls back to workspace.trial_intent_tier if no tier passed.
//     Returns { url } the SPA redirects to.
//
//   POST /api/stripe?action=portal
//     Creates a Customer Portal Session.
//     Returns { url } the SPA redirects to for card / plan management.
//
// Customer = user model: one Stripe Customer per profile, used to pay for
// any number of workspaces the user owns. We createCustomer lazily on
// first checkout and cache the id on profiles.stripe_customer_id.
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';
import {
  createCustomer,
  createCheckoutSession,
  createPortalSession,
  PRICE_BY_TIER,
} from './_lib/stripe.js';

const APP_URL = process.env.APP_URL || 'https://mashal.app';

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  const action = (req.query?.action || '').toString().toLowerCase();
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  // Ensure the user has a Stripe Customer. Lazy because we don't want a
  // signup to provision a Customer that never converts.
  async function ensureCustomerId() {
    const profile = await supabase.select('profiles', {
      select: 'id,stripe_customer_id',
      eq: { id: auth.user.id },
      single: true,
    }).catch(() => null);
    if (profile?.stripe_customer_id) return profile.stripe_customer_id;

    const created = await createCustomer({
      email: auth.user.email,
      name: auth.user.user_metadata?.first_name || auth.user.email,
      userId: auth.user.id,
    });
    await supabase.update('profiles',
      { stripe_customer_id: created.id },
      { eq: { id: auth.user.id } },
    ).catch(e => console.warn('[stripe] cache customer_id failed:', e.message));
    return created.id;
  }

  // Self-heal for "No such customer" — happens on test/live key swaps,
  // manual Stripe-dashboard deletes, or account switches. Null the cached
  // id and retry once so a single click still succeeds.
  const isMissingCustomer = e =>
    e?.code === 'resource_missing'
    && (e?.body?.error?.param ? e.body.error.param === 'customer' : true);

  async function withCustomerRetry(fn) {
    try { return await fn(); } catch (e) {
      if (!isMissingCustomer(e)) throw e;
      console.warn('[stripe] cached customer missing in Stripe, recreating');
      await supabase.update('profiles',
        { stripe_customer_id: null },
        { eq: { id: auth.user.id } },
      ).catch(err => console.warn('[stripe] clear customer_id failed:', err.message));
      return fn();
    }
  }

  // ── Checkout ─────────────────────────────────────────────────────────
  if (action === 'checkout') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const tier = (body?.tier || ws.trial_intent_tier || ws.tier || 'creator').toLowerCase();
    const priceId = PRICE_BY_TIER[tier];
    if (!priceId) return json(res, 400, { error: `Unknown tier: ${tier}` });

    try {
      const session = await withCustomerRetry(async () => {
        const customerId = await ensureCustomerId();
        return createCheckoutSession({
          customerId,
          priceId,
          workspaceId: ws.id,
          successUrl: `${APP_URL}/?checkout=success`,
          cancelUrl:  `${APP_URL}/?checkout=cancelled`,
          promoCode: body?.promoCode || null,
        });
      });
      return json(res, 200, { url: session.url, id: session.id });
    } catch (e) {
      return json(res, e.status || 500, { error: e.message });
    }
  }

  // ── Customer Portal ──────────────────────────────────────────────────
  if (action === 'portal') {
    try {
      const session = await withCustomerRetry(async () => {
        const customerId = await ensureCustomerId();
        return createPortalSession({
          customerId,
          returnUrl: `${APP_URL}/?portal=returned`,
        });
      });
      return json(res, 200, { url: session.url });
    } catch (e) {
      return json(res, e.status || 500, { error: e.message });
    }
  }

  return json(res, 400, { error: 'Unknown action', action });
}
