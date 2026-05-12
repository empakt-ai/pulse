-- ═════════════════════════════════════════════════════════════════════════
-- 014_historic_backfill.sql
-- One-shot historic backfill via Apify for own accounts.
--
-- Zernio only serves data from the account's connection date forward, so
-- a workspace that just signed up has no history to reason about. Apify
-- scrapers can pull the last ~50-100 posts off any public profile,
-- giving the brief, growth, content and targets screens real signal to
-- work with on day one.
--
-- This column records when a backfill ran so we never charge the user
-- (or burn Apify quota) twice. NULL = never backfilled.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE connected_accounts
  ADD COLUMN IF NOT EXISTS historic_backfilled_at TIMESTAMPTZ NULL;

-- Tell PostgREST about the new column so the schema cache picks it up
-- without a process restart.
NOTIFY pgrst, 'reload schema';
