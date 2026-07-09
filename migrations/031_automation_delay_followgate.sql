-- 031_automation_delay_followgate.sql
-- P1 (delay) + P2 (follow-gate) config on comment→DM automations.
--
-- comment_automations stays the config the UI reads/writes. These columns let a
-- rule ask for the two things Zernio's hosted automation can't do:
--   • a randomized send delay (delay_min_seconds..delay_max_seconds), and
--   • a verified follow-gate (require_follow, with optional custom copy).
--
-- When either is set the rule runs on OUR engine (engine='native', linked to an
-- automation_flows row via flow_id) instead of Zernio's hosted automation — and
-- carries NO Zernio twin, so nothing double-sends. Plain rules stay 'zernio'.
--
-- Additive + idempotent. No RLS change (comment_automations already service-only).

ALTER TABLE comment_automations
  ADD COLUMN IF NOT EXISTS delay_min_seconds integer,
  ADD COLUMN IF NOT EXISTS delay_max_seconds integer,
  ADD COLUMN IF NOT EXISTS require_follow    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS follow_prompt     text,
  ADD COLUMN IF NOT EXISTS reprompt          text,
  -- 'zernio' = Zernio hosted (instant); 'native' = Mashal engine (delay/gate).
  ADD COLUMN IF NOT EXISTS engine            text NOT NULL DEFAULT 'zernio',
  -- The native flow this rule compiled to (null while on Zernio).
  ADD COLUMN IF NOT EXISTS flow_id           uuid REFERENCES automation_flows(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
