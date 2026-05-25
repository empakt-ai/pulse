// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Thin Stripe REST client. No SDK install — Stripe's API is
// stable and form-encoded; a `fetch` wrapper is enough and keeps our
// node_modules surface tiny.
//
// Surface area we use today:
//   - createCustomer / getCustomer
//   - createCheckoutSession   (trial → paid conversion)
//   - createPortalSession     (customer self-service)
//   - getSubscription         (force-refresh from admin)
//   - listInvoices            (admin Billing detail)
//   - verifyWebhookSignature  (signature check on the webhook endpoint)
//
// Map of tier key → Stripe Price ID. Updating tiers means flipping these
// here AND in api/_lib/tiers.js (the latter governs feature caps; this
// one governs billing).
// ═════════════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';

const API = 'https://api.stripe.com/v1';
const SECRET = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

if (!SECRET && typeof process !== 'undefined') {
  console.warn('[stripe] STRIPE_SECRET_KEY missing — billing calls will fail');
}

// Tier ↔ Price mapping. These are LIVE Price IDs from Stripe Dashboard.
// Test-mode keys/prices would go in a separate map keyed by env.
export const PRICE_BY_TIER = {
  creator:     'price_1TWzqUImZCTvR1deBmoqcZdq',
  // Pro Creator — Stripe product + price has not been created in the
  // dashboard yet. Set STRIPE_PRICE_PRO_CREATOR in the Vercel env to wire
  // it. Until set, attempts to subscribe at Pro Creator fail fast in
  // api/stripe.js with a 400 instead of silently billing the wrong amount.
  pro_creator: process.env.STRIPE_PRICE_PRO_CREATOR || '',
  brand:       'price_1TWzqmImZCTvR1deNcMzg059',
  agency:      'price_1TWzr4ImZCTvR1deU87YGUhD',
};
// Build the reverse map only from non-empty entries so an unset Pro Creator
// price doesn't shadow the empty string as a valid lookup key.
export const TIER_BY_PRICE = Object.fromEntries(
  Object.entries(PRICE_BY_TIER).filter(([_, v]) => !!v).map(([k, v]) => [v, k]),
);

// Stripe expects application/x-www-form-urlencoded with bracket-notation
// for nested objects. Walks an object recursively to emit the flat form
// pairs the API wants.
function formEncode(obj, prefix = '') {
  const out = [];
  const push = (k, v) => { out.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`); };
  for (const [key, value] of Object.entries(obj || {})) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value == null) continue;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (v && typeof v === 'object') out.push(formEncode(v, `${name}[${i}]`));
        else push(`${name}[${i}]`, String(v));
      });
    } else if (typeof value === 'object') {
      out.push(formEncode(value, name));
    } else {
      push(name, String(value));
    }
  }
  return out.flat().filter(Boolean).join('&');
}

async function call(path, { method = 'GET', body, idempotencyKey } = {}) {
  if (!SECRET) throw new Error('STRIPE_SECRET_KEY missing');
  const headers = {
    Authorization: `Bearer ${SECRET}`,
    'Stripe-Version': '2024-06-20',
  };
  let opts = { method, headers };
  if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = formEncode(body);
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await fetch(`${API}${path}`, opts);
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

  if (!res.ok) {
    const msg = parsed?.error?.message || `Stripe ${res.status}`;
    const err = new Error(`Stripe: ${msg}`);
    err.status = res.status;
    err.code = parsed?.error?.code;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

// ── Customers ────────────────────────────────────────────────────────────
export const createCustomer = ({ email, name, userId }) =>
  call('/customers', {
    method: 'POST',
    body: {
      email,
      name,
      metadata: { pulse_user_id: userId },
    },
  });

export const getCustomer = (customerId) =>
  call(`/customers/${encodeURIComponent(customerId)}`);

// ── Checkout ─────────────────────────────────────────────────────────────
// Subscription Checkout in trial-to-paid mode. We always pass a workspace
// ID in metadata so the webhook can resolve which workspace to update.
export const createCheckoutSession = ({
  customerId,
  priceId,
  workspaceId,
  successUrl,
  cancelUrl,
  trialDays = null,         // null → no Stripe-side trial (we manage trials ourselves)
  promoCode = null,
}) =>
  call('/checkout/sessions', {
    method: 'POST',
    body: {
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]':    priceId,
      'line_items[0][quantity]': 1,
      success_url: successUrl,
      cancel_url:  cancelUrl,
      // Encode the workspace_id both on the session AND on the subscription —
      // session metadata is visible in checkout.session.completed; subscription
      // metadata is visible in customer.subscription.* events. Both need it.
      'metadata[workspace_id]': workspaceId,
      'subscription_data[metadata][workspace_id]': workspaceId,
      ...(trialDays ? { 'subscription_data[trial_period_days]': String(trialDays) } : {}),
      ...(promoCode ? { 'discounts[0][promotion_code]': promoCode } : {}),
      // Allow the user to enter a promo on the Stripe-hosted Checkout
      // UI only when (a) we didn't already attach one server-side, and
      // (b) we're not running a Stripe-side trial. The combo of explicit
      // `discounts[…]` AND `allow_promotion_codes:true` is rejected by
      // Stripe with `parameter_invalid_string`.
      allow_promotion_codes: !promoCode && !trialDays,
    },
  });

// ── Customer Portal ──────────────────────────────────────────────────────
export const createPortalSession = ({ customerId, returnUrl }) =>
  call('/billing_portal/sessions', {
    method: 'POST',
    body: { customer: customerId, return_url: returnUrl },
  });

// ── Subscription read (force-refresh path) ──────────────────────────────
export const getSubscription = (subId) =>
  call(`/subscriptions/${encodeURIComponent(subId)}`);

export const listSubscriptionsForCustomer = (customerId) =>
  call(`/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=100`);

export const listInvoices = (customerId, { limit = 20 } = {}) =>
  call(`/invoices?customer=${encodeURIComponent(customerId)}&limit=${limit}`);

// ── Customer balance credit (used by the referral reward path) ──────────
// Negative `amount` adds a credit that Stripe auto-applies to the next
// invoice. We pass an idempotency key derived from the referral row so
// webhook retries can't double-credit a referrer.
export const createCustomerCredit = ({ customerId, amountCents, currency = 'usd', description, idempotencyKey }) =>
  call(`/customers/${encodeURIComponent(customerId)}/balance_transactions`, {
    method: 'POST',
    idempotencyKey,
    body: {
      amount: -Math.abs(amountCents),       // negative = credit
      currency,
      description: description || 'Mashal referral credit',
    },
  });

// ── Webhook signature verification ──────────────────────────────────────
// Stripe signs every webhook body with the endpoint's signing secret. We
// recompute the HMAC and compare with constant-time equality, also
// enforcing a 5-minute timestamp tolerance to make replays of old events
// useless. Returns the parsed event on success; throws on any mismatch.
export function verifyWebhookSignature(rawBody, header, { toleranceSec = 300 } = {}) {
  if (!WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET missing');
  if (!header) throw new Error('Missing Stripe-Signature header');

  // Header shape: t=TIMESTAMP,v1=SIGNATURE,v1=SIGNATURE2
  const parts = Object.fromEntries(
    header.split(',').map(kv => {
      const [k, v] = kv.split('=');
      return [k, v];
    }),
  );
  const t   = parts.t;
  const sig = parts.v1;
  if (!t || !sig) throw new Error('Malformed Stripe-Signature header');

  const skew = Math.abs(Date.now() / 1000 - Number(t));
  if (skew > toleranceSec) throw new Error(`Webhook timestamp outside tolerance (${skew}s)`);

  const payload = `${t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Webhook signature mismatch');
  }

  return JSON.parse(rawBody);
}
