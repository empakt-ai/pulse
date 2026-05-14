-- 007_security_cleanup.sql
-- Address Supabase linter warnings on the original Mashal schema (the
-- helper functions + views that pre-date our migrations).
--
-- Safe to run on a populated DB. Does NOT touch tier_limits / usage_summary
-- views — those need to be rewritten with their actual SELECTs and we
-- don't have those checked in. Leaving them for a follow-up.

-- ─── Lock down search_path on helper functions ───────────────────────────
-- Mutable search_path is a privilege-escalation vector for SECURITY DEFINER
-- functions: an attacker can prepend a malicious schema and have the
-- function execute their code. Pinning search_path to public neutralises it.
-- Use ALTER ... SET so we don't have to know the function bodies.
ALTER FUNCTION public.handle_new_user()    SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_profile() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at()     SET search_path = public, pg_temp;

-- ─── Revoke public EXECUTE on auth-trigger functions ─────────────────────
-- These functions should ONLY run from their auth trigger (on user signup).
-- The Supabase API auto-exposes every public function via /rest/v1/rpc,
-- which means anyone could call them with a synthesized payload. Revoke
-- so the trigger still runs (it executes as the table owner) but RPC
-- exposure is gone. rls_auto_enable is in the same boat.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()    FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_profile() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()    FROM anon, authenticated, public;

-- ─── Add minimal RLS policies on our new tables (defence in depth) ──────
-- These tables are only touched by the API with the service role key
-- (which bypasses RLS), so policies aren't strictly required. But adding
-- "owner can read" policies turns the linter INFO into a clean state and
-- lets the dashboard's data viewer show rows when you're logged in as
-- the owner (otherwise they appear empty in the Supabase UI).

DO $$
BEGIN
  -- content_pieces: workspace owner can read their own
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='content_pieces'
                                AND policyname='content_pieces_owner_read'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY content_pieces_owner_read ON public.content_pieces
        FOR SELECT TO authenticated
        USING (
          workspace_id IN (
            SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
          )
        )
    $POL$;
  END IF;

  -- series: workspace owner can read their own
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='series'
                                AND policyname='series_owner_read'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY series_owner_read ON public.series
        FOR SELECT TO authenticated
        USING (
          workspace_id IN (
            SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
          )
        )
    $POL$;
  END IF;

  -- inbox_events: workspace owner can read their own
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='inbox_events'
                                AND policyname='inbox_events_owner_read'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY inbox_events_owner_read ON public.inbox_events
        FOR SELECT TO authenticated
        USING (
          workspace_id IN (
            SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
          )
        )
    $POL$;
  END IF;
END $$;
