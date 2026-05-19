-- ═════════════════════════════════════════════════════════════════════════
-- 023_referrals.sql
-- Two-table referral system. Creator-tier only at v1.
--
--   referral_codes — one row per user. The user's shareable code, lazy-
--                    created on first GET. rewards_earned is the credit
--                    counter capped at max_rewards (default 3).
--
--   referrals     — one row per attribution. Created when a referee signs
--                    up using the code; status progresses
--                    pending → converted → rewarded, or → rejected if the
--                    handle-dedup gate rejects the trial.
--
-- Reward fires on the referee's FIRST Stripe payment (handled in
-- api/stripe-webhook.js → checkout.session.completed). Stripe credit is
-- applied via customer.balance — see api/_lib/referral.js.
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS referral_codes (
  user_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code           TEXT NOT NULL UNIQUE,
  rewards_earned INTEGER NOT NULL DEFAULT 0,
  max_rewards    INTEGER NOT NULL DEFAULT 3,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);

CREATE TABLE IF NOT EXISTS referrals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referee_user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referee_workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code_used            TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','converted','rewarded','rejected','expired')),
  signed_up_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  converted_at         TIMESTAMPTZ NULL,
  reward_applied_at    TIMESTAMPTZ NULL,
  reject_reason        TEXT NULL,
  -- One referral row per referee workspace — a workspace can only ever
  -- be attributed to a single referrer. Re-signups under a duplicate
  -- handle are blocked upstream by handle_registry (migration 015).
  UNIQUE (referee_workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referee  ON referrals(referee_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status   ON referrals(status);

NOTIFY pgrst, 'reload schema';
