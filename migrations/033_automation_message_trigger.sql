-- 033_automation_message_trigger.sql
-- P3 (in-DM keyword trigger): let an automation fire on a keyword in an inbound
-- DM, not just a comment.
--
-- comment_automations stays the single config table the UI reads/writes (it's
-- the superset "engage automation" config now, despite the name). `trigger_type`
-- selects what starts the rule:
--   'comment' (default) — a keyword comment → private-reply DM (Zernio-hosted or
--                         native, exactly as before).
--   'message'           — a keyword in an inbound DM → auto-reply in the thread.
--
-- Zernio's hosted comment-automations are COMMENT-only, so a message-triggered
-- rule has no hosted twin: it always runs on OUR engine (engine='native',
-- linked via flow_id). That means message triggers need AUTOMATION_ENGINE on —
-- enforced in the API (nativeGuard), not here.
--
-- Additive + idempotent. No RLS change (comment_automations already service-only).

ALTER TABLE comment_automations
  ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'comment';   -- 'comment' | 'message'

NOTIFY pgrst, 'reload schema';
