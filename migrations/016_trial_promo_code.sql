-- ═════════════════════════════════════════════════════════════════════════
-- 016_trial_promo_code.sql
-- Captures an optional promo code at signup. Cheap one-column add so we
-- can attribute trials to specific campaigns / referral sources from
-- day one. Actual discount math will happen via Stripe's built-in
-- promotion codes at checkout time; this column is intent-only.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS trial_promo_code TEXT NULL;

NOTIFY pgrst, 'reload schema';
