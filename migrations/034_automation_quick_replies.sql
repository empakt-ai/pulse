-- 034_automation_quick_replies.sql
-- P3 (interactive replies): quick-reply chips + richer button types.
--
-- Buttons already live in the `buttons` jsonb (032). This release widens their
-- shape from URL-only to Zernio's full DmButton set — {type:'url'|'postback'|
-- 'phone', title, url?, payload?, phone?} — which needs no schema change (jsonb).
--
-- Quick-reply chips are a distinct, mutually-exclusive interactive type
-- ({title, payload}, max 13) that render inline in an OPEN thread (not IG's
-- Requests folder), so they attach to in-thread sends — chiefly the DM-keyword
-- auto-reply. They're a native-engine concept and are never sent to Zernio's
-- hosted comment-automations.
--
-- Additive + idempotent. No RLS change (comment_automations already service-only).

ALTER TABLE comment_automations
  ADD COLUMN IF NOT EXISTS quick_replies jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
