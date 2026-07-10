-- 032_automation_buttons.sql
-- P3 (buttons): inline DM buttons on comment→DM automations.
--
-- Verified against Zernio's SDK (sendPrivateReplyToComment.buttons): 1–3 inline
-- buttons rendered via Meta's button_template. v1 ships URL buttons
-- ({type:'url', title, url}) — they render inside Instagram's Message Requests
-- folder (unlike quick-reply chips), which is exactly where a cold comment→DM
-- opener to a non-follower lands. Postback/phone types come later.
--
-- Attached to the primary DM: the private-reply opener (gate + plain). Works on
-- both surfaces — native flows attach them to the send_dm step; Zernio-hosted
-- rules pass them straight through on create/update.
--
-- Additive + idempotent.

ALTER TABLE comment_automations
  ADD COLUMN IF NOT EXISTS buttons jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
