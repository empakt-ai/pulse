// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Stripe webhook handler. Signs every received event, dedupes
// via stripe_events.id, and mirrors subscription state onto our tables.
//
// Endpoint URL (configure in Stripe Dashboard → Developers → Webhooks):
//   https://mashal.app/api/stripe-webhook
//
// Events we listen to:
//   - checkout.session.completed       — trial → paid conversion lands here
//   - customer.subscription.created    — subscription becomes the source of truth
//   - customer.subscription.updated    — plan change, cancel-at-period-end toggle, etc.
//   - customer.subscription.deleted    — final cancellation
//   - invoice.payment_succeeded        — clears past_due, stamps last_invoice_status
//   - invoice.payment_failed           — flips to past_due so the dashboard can warn
//
// Replay safety:
//   - Stripe-Signature verified with HMAC + 5-min timestamp tolerance
//   - stripe_events.id is the PK; duplicate event IDs short-circuit
//   - All DB updates derive from event payload only (no incidental writes)
//
// Vercel-specific notes:
//   - bodyParser disabled below so we get the raw text Stripe signed
//   - Signature failures return 400; everything else returns 200 (we'd
//     rather log a logic failure than have Stripe retry indefinitely)
// ═════════════════════════════════════════════════════════════════════════

import { supabase } from './_lib/supabase.js';
import { verifyWebhookSignature, TIER_BY_PRICE, getSubscription } from './_lib/stripe.js';
import { logAdminAction } from './_lib/admin.js';
import {
  convertReferralIfAny,
  applyReferralCredit,
  applyOutstandingReferralCredits,
} from './_lib/referral.js';

// Tell Vercel not to parse the body — signature verification needs the
// raw text exactly as Stripe sent it.
export const config = {
  api: { bodyParser: false },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  // 1. Verify signature against the raw request body.
  let event;
  let raw;
  try {
    raw = await readRawBody(req);
    const sig = req.headers['stripe-signature'] || req.headers['Stripe-Signature'];
    event = verifyWebhookSignature(raw, sig);
  } catch (e) {
    console.warn('[stripe-webhook] signature verification failed:', e.message);
    res.status(400).send(`Webhook Error: ${e.message}`);
    return;
  }

  // 2. Idempotency: skip if we've already processed this event ID.
  // We INSERT first; if the row already exists we treat it as a no-op.
  // PostgREST surfaces a 409-like error on conflict; we swallow and exit.
  try {
    await supabase.insert('stripe_events', {
      id: event.id,
      type: event.type,
      payload: event,
    });
  } catch (e) {
    // Already processed — Stripe is retrying. Acknowledge and bail.
    console.log(`[stripe-webhook] duplicate event ${event.id}, skipping`);
    res.status(200).json({ received: true, duplicate: true });
    return;
  }

  // 3. Dispatch on event type. Each handler is its own function so the
  // top-level dispatch stays readable and a single handler crash doesn't
  // leak through to others.
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpsert(event.data.object, event.type);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      case 'invoice.payment_succeeded':
        await handleInvoicePaid(event.data.object);
        break;
      case 'invoice.payment_failed':
        await handleInvoiceFailed(event.data.object);
        break;
      default:
        // Recorded in stripe_events for debugging but otherwise ignored.
        break;
    }

    await supabase.update('stripe_events', { processed_at: new Date().toISOString() }, { eq: { id: event.id } }).catch(() => {});
    res.status(200).json({ received: true });
  } catch (e) {
    // Logic error — Stripe shouldn't retry. We log and acknowledge so the
    // event sits in stripe_events with an error string for debugging.
    console.error(`[stripe-webhook] ${event.type} (${event.id}) failed:`, e.message);
    await supabase.update('stripe_events',
      { error: e.message, processed_at: new Date().toISOString() },
      { eq: { id: event.id } },
    ).catch(() => {});
    res.status(200).json({ received: true, error: e.message });
  }
}

// ── Event handlers ──────────────────────────────────────────────────────

// checkout.session.completed fires once when the user finishes the hosted
// Checkout flow. session.subscription is a Subscription ID (or full object
// if expanded); session.customer is the Customer ID. workspace_id was set
// in metadata when we created the session.
async function handleCheckoutCompleted(session) {
  const workspaceId = session.metadata?.workspace_id;
  const customerId  = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  if (!workspaceId) {
    console.warn('[stripe-webhook] checkout.session.completed missing workspace_id metadata');
    return;
  }

  // Mirror Customer onto the workspace owner's profile so the next checkout
  // re-uses it instead of creating duplicates. We resolve owner_id from
  // the workspace, then upsert into profiles.
  const ws = await supabase.select('workspaces', {
    select: 'id,owner_id,tier,trial_converted_at',
    eq: { id: workspaceId },
    single: true,
  }).catch(() => null);
  if (!ws) {
    console.warn(`[stripe-webhook] workspace ${workspaceId} not found for checkout`);
    return;
  }
  if (customerId && ws.owner_id) {
    await supabase.update('profiles', { stripe_customer_id: customerId }, { eq: { id: ws.owner_id } }).catch(e => {
      console.warn('[stripe-webhook] failed to set profile.stripe_customer_id:', e.message);
    });
  }

  // The session payload doesn't include the full subscription. We
  // fetch it directly so we can tell whether this checkout completion
  // is a real paid conversion (status=active) or a card-upfront trial
  // signup (status=trialing). For trial signups we extend the workspace
  // trial window to match Stripe's trial_end, but DO NOT stamp
  // trial_converted_at — that happens later when the trial actually
  // converts (handled in handleSubscriptionUpsert when status moves
  // from trialing to active).
  let isStripeTrialing = false;
  let stripeTrialEnd = null;
  if (subscriptionId) {
    try {
      const sub = await getSubscription(subscriptionId);
      if (sub?.status === 'trialing' && sub.trial_end) {
        isStripeTrialing = true;
        stripeTrialEnd = new Date(sub.trial_end * 1000).toISOString();
      }
    } catch (e) {
      console.warn('[stripe-webhook] failed to fetch subscription for trial check:', e.message);
    }
  }

  const patch = {
    stripe_subscription_id: subscriptionId || null,
    trial_locked: false,
    stripe_last_event_at: new Date().toISOString(),
  };
  if (isStripeTrialing) {
    patch.trial_ends_at = stripeTrialEnd;
  } else {
    patch.trial_converted_at = ws.trial_converted_at || new Date().toISOString();
  }
  await supabase.update('workspaces', patch, { eq: { id: workspaceId } });

  await logAdminAction({
    actor: ws.owner_id,
    action: 'billing.checkout.completed',
    targetType: 'workspace',
    targetId: workspaceId,
    before: { trial_converted_at: ws.trial_converted_at || null, stripe_subscription_id: null },
    after:  { trial_converted_at: patch.trial_converted_at, stripe_subscription_id: subscriptionId || null },
    reason: `Stripe Checkout completed (customer=${customerId || 'unknown'})`,
  }).catch(() => {});

  // ── Referral conversion ────────────────────────────────────────────────
  // This workspace just paid. Two things may need to happen:
  //   1. If this workspace was attributed to a referrer (pending row),
  //      flip it to 'converted' and try to apply the credit to the
  //      referrer's Stripe customer.
  //   2. If the OWNER of this workspace has any deferred 'converted'
  //      rewards from their own past referrals (they were on trial when
  //      a friend converted), flush those now — the profile.stripe_
  //      customer_id was stamped above, so the credit call can find it.
  //
  // All best-effort: a referral failure must never stop the checkout
  // event from being marked processed.
  try {
    const referral = await convertReferralIfAny(workspaceId);
    if (referral) {
      await applyReferralCredit(referral).catch(e =>
        console.warn('[stripe-webhook] referral credit apply failed:', e.message));
    }
  } catch (e) {
    console.warn('[stripe-webhook] convertReferralIfAny failed:', e.message);
  }
  try {
    if (ws.owner_id) {
      await applyOutstandingReferralCredits(ws.owner_id);
    }
  } catch (e) {
    console.warn('[stripe-webhook] applyOutstandingReferralCredits failed:', e.message);
  }
}

// customer.subscription.{created,updated} carries the canonical state.
// We mirror all the columns we care about and derive the tier from the
// active Price ID. If we ever launch annual prices or per-seat plans
// we'd extend PRICE_BY_TIER and the resolution here.
async function handleSubscriptionUpsert(sub, eventType) {
  const workspaceId = sub.metadata?.workspace_id;
  if (!workspaceId) {
    console.warn(`[stripe-webhook] ${eventType} missing workspace_id metadata`);
    return;
  }

  const item = (sub.items?.data || [])[0];
  const priceId = item?.price?.id || null;
  const derivedTier = priceId ? TIER_BY_PRICE[priceId] : null;
  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;

  const before = await supabase.select('workspaces', {
    select: 'id,owner_id,tier,stripe_subscription_id,stripe_subscription_status,stripe_price_id,trial_converted_at',
    eq: { id: workspaceId },
    single: true,
  }).catch(() => null);
  if (!before) {
    console.warn(`[stripe-webhook] workspace ${workspaceId} not found for ${eventType}`);
    return;
  }

  const patch = {
    stripe_subscription_id: sub.id,
    stripe_subscription_status: sub.status,
    stripe_price_id: priceId,
    stripe_current_period_end: periodEnd,
    stripe_cancel_at_period_end: !!sub.cancel_at_period_end,
    stripe_last_event_at: new Date().toISOString(),
  };
  // Update tier only if the price maps cleanly. We never overwrite tier
  // with null — if a manual Stripe edit pointed to an unknown price we
  // keep the last good tier rather than blanking the row.
  if (derivedTier && derivedTier !== before.tier) patch.tier = derivedTier;

  // Trial-state transitions:
  //   - trialing: a card is on file but Stripe hasn't charged yet. Mirror
  //     the trial_end onto trial_ends_at so the SPA's trial banner shows
  //     the extended window correctly.
  //   - active: the trial has converted to a paying subscription. Stamp
  //     trial_converted_at if it isn't already set (handles both direct
  //     paid conversions and the trialing → active transition).
  if (sub.status === 'trialing' && sub.trial_end) {
    patch.trial_ends_at = new Date(sub.trial_end * 1000).toISOString();
  } else if (sub.status === 'active' && !before.trial_converted_at) {
    patch.trial_converted_at = new Date().toISOString();
  }

  await supabase.update('workspaces', patch, { eq: { id: workspaceId } });

  await logAdminAction({
    actor: before.owner_id,
    action: `billing.subscription.${eventType.split('.').pop()}`,
    targetType: 'workspace',
    targetId: workspaceId,
    before: {
      tier: before.tier,
      stripe_subscription_status: before.stripe_subscription_status,
      stripe_price_id: before.stripe_price_id,
    },
    after: {
      tier: patch.tier ?? before.tier,
      stripe_subscription_status: patch.stripe_subscription_status,
      stripe_price_id: patch.stripe_price_id,
    },
    reason: `Stripe subscription ${eventType.split('.').pop()} (${sub.status})`,
  }).catch(() => {});
}

// Subscription deletion = customer ended billing. Status becomes
// 'canceled'. We deliberately KEEP the tier value so the dashboard
// remembers what the customer was paying for; gating logic will read
// stripe_subscription_status to decide whether to lock the workspace.
async function handleSubscriptionDeleted(sub) {
  const workspaceId = sub.metadata?.workspace_id;
  if (!workspaceId) return;

  const before = await supabase.select('workspaces', {
    select: 'id,owner_id,tier,stripe_subscription_status',
    eq: { id: workspaceId },
    single: true,
  }).catch(() => null);
  if (!before) return;

  await supabase.update('workspaces', {
    stripe_subscription_status: 'canceled',
    stripe_cancel_at_period_end: false,
    stripe_last_event_at: new Date().toISOString(),
  }, { eq: { id: workspaceId } });

  await logAdminAction({
    actor: before.owner_id,
    action: 'billing.subscription.deleted',
    targetType: 'workspace',
    targetId: workspaceId,
    before: { stripe_subscription_status: before.stripe_subscription_status },
    after:  { stripe_subscription_status: 'canceled' },
    reason: 'Stripe subscription deleted',
  }).catch(() => {});
}

// invoice.payment_succeeded marks the workspace healthy. If the workspace
// was sitting in past_due we clear that here.
async function handleInvoicePaid(invoice) {
  const subId = invoice.subscription;
  if (!subId) return;

  const ws = await supabase.select('workspaces', {
    select: 'id,owner_id,stripe_subscription_status',
    eq: { stripe_subscription_id: subId },
    single: true,
  }).catch(() => null);
  if (!ws) return;

  await supabase.update('workspaces', {
    stripe_last_invoice_status: 'paid',
    stripe_subscription_status: ws.stripe_subscription_status === 'past_due'
      ? 'active'
      : ws.stripe_subscription_status,
    stripe_last_event_at: new Date().toISOString(),
  }, { eq: { id: ws.id } });
}

// invoice.payment_failed flips the workspace into past_due so the SPA can
// surface a "fix your card" banner. Stripe will retry the invoice per the
// retry schedule configured on the Stripe Dashboard.
async function handleInvoiceFailed(invoice) {
  const subId = invoice.subscription;
  if (!subId) return;

  const ws = await supabase.select('workspaces', {
    select: 'id,owner_id,stripe_subscription_status',
    eq: { stripe_subscription_id: subId },
    single: true,
  }).catch(() => null);
  if (!ws) return;

  await supabase.update('workspaces', {
    stripe_last_invoice_status: invoice.status || 'open',
    stripe_subscription_status: 'past_due',
    stripe_last_event_at: new Date().toISOString(),
  }, { eq: { id: ws.id } });

  await logAdminAction({
    actor: ws.owner_id,
    action: 'billing.invoice.failed',
    targetType: 'workspace',
    targetId: ws.id,
    before: { stripe_subscription_status: ws.stripe_subscription_status },
    after:  { stripe_subscription_status: 'past_due' },
    reason: `Invoice ${invoice.id} payment failed`,
  }).catch(() => {});
}
