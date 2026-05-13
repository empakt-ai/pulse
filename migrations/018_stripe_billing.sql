-- ═════════════════════════════════════════════════════════════════════════
-- 018_stripe_billing.sql
-- Stripe state mirrored onto our tables. Single source of truth at Stripe;
-- we keep a denormalised cache so the dashboard, admin Billing screen,
-- and tier-gating logic don't have to hit Stripe on every request.
--
-- Customer = user (profiles.stripe_customer_id). One Customer per
-- signed-up user, used to pay for any number of workspaces the user
-- owns. Subscriptions are scoped per-workspace because PULSE bills
-- per-workspace.
--
-- The trial flow is unchanged: workspaces enter a 7-day trial on
-- creation, can convert via Stripe Checkout, and the webhook stamps
-- trial_converted_at + stripe_* columns when payment succeeds.
-- ═════════════════════════════════════════════════════════════════════════

-- ── Profile-level: one Stripe Customer per user ───────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_stripe_customer_id_unique
  ON profiles (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- ── Workspace-level: subscription state mirror ────────────────────────────
-- Every column here is a cached projection of the truth in Stripe. The
-- webhook handler keeps them current; the admin Billing screen exposes a
-- "force refresh from Stripe" action when divergence is suspected.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS stripe_subscription_id        TEXT        NULL,
  ADD COLUMN IF NOT EXISTS stripe_subscription_status    TEXT        NULL,        -- active | trialing | past_due | canceled | incomplete | unpaid
  ADD COLUMN IF NOT EXISTS stripe_price_id               TEXT        NULL,        -- the current plan's Price ID
  ADD COLUMN IF NOT EXISTS stripe_current_period_end     TIMESTAMPTZ NULL,        -- next renewal
  ADD COLUMN IF NOT EXISTS stripe_cancel_at_period_end   BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_last_invoice_status    TEXT        NULL,        -- paid | open | uncollectible | void | draft
  ADD COLUMN IF NOT EXISTS stripe_last_event_at          TIMESTAMPTZ NULL;        -- most recent webhook touched this row

CREATE INDEX IF NOT EXISTS workspaces_stripe_subscription_idx
  ON workspaces (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS workspaces_stripe_status_idx
  ON workspaces (stripe_subscription_status)
  WHERE stripe_subscription_status IS NOT NULL;

-- ── Webhook idempotency ───────────────────────────────────────────────────
-- Stripe sends each event up to a few times under retry conditions.
-- We deduplicate on event ID so a retried payment_succeeded doesn't
-- double-stamp trial_converted_at or write two audit rows.
CREATE TABLE IF NOT EXISTS stripe_events (
  id          TEXT        PRIMARY KEY,                      -- e.g. evt_1Abc...
  type        TEXT        NOT NULL,                         -- e.g. customer.subscription.updated
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ NULL,                            -- set when handler completes successfully
  error       TEXT        NULL,                             -- set when handler fails
  payload     JSONB       NULL                              -- full event body for debugging
);

CREATE INDEX IF NOT EXISTS stripe_events_received_idx ON stripe_events (received_at DESC);
CREATE INDEX IF NOT EXISTS stripe_events_type_idx     ON stripe_events (type, received_at DESC);

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stripe_events_no_client_access ON stripe_events;
CREATE POLICY stripe_events_no_client_access ON stripe_events
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
