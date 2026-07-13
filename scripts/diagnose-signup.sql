-- ============================================================================
-- Signup failure — diagnosis + repair
--
-- Symptom: new users can't create an account. Email+password signup fails;
-- magic link "works" when tested with an EXISTING account.
--
-- Why that asymmetry points here: a magic link for an existing user does NOT
-- insert a new auth.users row, so it never fires the signup trigger. Email+
-- password signup (and a magic link for a brand-new email) ALWAYS inserts a
-- new auth.users row, which fires the on_auth_user_created trigger →
-- public.handle_new_user() (and possibly handle_new_profile()). If that
-- trigger raises, GoTrue aborts the INSERT and returns HTTP 500
-- "Database error saving new user" — which is exactly what a broken
-- SECURITY DEFINER signup trigger looks like from the client.
--
-- The trigger bodies are NOT in the repo (they pre-date the numbered
-- migrations and live only in the Supabase project), so STEP 1 dumps them so
-- we can see what they actually do. Run STEP 1 first and read the output.
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor.
-- ============================================================================


-- ── STEP 1 — INTROSPECT (read-only) ─────────────────────────────────────────

-- 1a. The exact source of the signup trigger functions.
SELECT n.nspname AS schema, p.proname AS function,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname IN ('handle_new_user', 'handle_new_profile');

-- 1b. Which triggers fire on auth.users, and whether they're enabled.
--     (tgenabled: 'O' = enabled, 'D' = disabled.)
SELECT t.tgname AS trigger, c.relname AS table, t.tgenabled AS enabled,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'auth' AND c.relname = 'users' AND NOT t.tgisinternal;

-- 1c. Columns the trigger must satisfy — any NOT NULL column WITHOUT a default
--     on workspaces/profiles is a candidate breaker (the trigger's INSERT would
--     have to supply it explicitly; if a later migration added one, signup 500s).
SELECT table_name, column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('workspaces', 'profiles')
  AND is_nullable = 'NO'
  AND column_default IS NULL
ORDER BY table_name, ordinal_position;

-- 1d. CHECK / FK constraints on those tables that a trigger INSERT could trip.
SELECT conrelid::regclass AS table, conname, contype,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN ('public.workspaces'::regclass, 'public.profiles'::regclass)
  AND contype IN ('c', 'f')
ORDER BY conrelid::regclass::text, conname;

-- 1e. DECISIVE end-to-end reproduction. Wrapped in a transaction that ALWAYS
--     rolls back, so it creates nothing permanent. If signup is broken by the
--     trigger, this raises the SAME error GoTrue surfaces — printed right here,
--     no dashboard log-diving needed. If it succeeds, the trigger is fine and
--     the problem is Auth CONFIG (see NOTE at the bottom), not the DB.
BEGIN;
DO $$
DECLARE
  uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, aud, role, created_at, updated_at)
  VALUES (uid, 'signup-probe-' || uid || '@example.com', 'authenticated', 'authenticated', now(), now());
  RAISE NOTICE 'SIGNUP TRIGGER OK — auth.users insert + trigger succeeded for %', uid;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SIGNUP TRIGGER FAILED — SQLSTATE % : %', SQLSTATE, SQLERRM;
END $$;
ROLLBACK;


-- ── STEP 2 — REPAIR (apply ONLY after STEP 1 shows the trigger raising) ──────
-- This is a TEMPLATE. Do not run it blind — reconcile it against the STEP 1a
-- dump so it keeps whatever business logic the current trigger has (referrals,
-- trial stamping, profile creation, etc.). The three things that make it
-- resilient to "can't create account":
--   1. SECURITY DEFINER + pinned search_path (matches migration 007).
--   2. Fully-qualified inserts that populate every NOT NULL-without-default
--      column found in STEP 1c.
--   3. It never lets a non-critical failure abort the auth.users insert:
--      the workspace/profile bootstrap is best-effort, so a hiccup degrades
--      to "user exists, workspace missing" (recoverable in-app) instead of
--      "signup 500". Remove the EXCEPTION guard if you'd rather signup hard-
--      fail than create a user without a workspace.
--
-- CREATE OR REPLACE FUNCTION public.handle_new_user()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public, pg_temp
-- AS $$
-- BEGIN
--   BEGIN
--     INSERT INTO public.profiles (id)            -- add every NOT NULL col from 1c
--     VALUES (NEW.id)
--     ON CONFLICT (id) DO NOTHING;
--
--     INSERT INTO public.workspaces (owner_id, name)   -- + NOT NULL cols from 1c
--     VALUES (NEW.id, 'My Workspace')
--     ON CONFLICT DO NOTHING;
--   EXCEPTION WHEN OTHERS THEN
--     RAISE WARNING 'handle_new_user bootstrap failed for %: %', NEW.id, SQLERRM;
--   END;
--   RETURN NEW;
-- END $$;
--
-- -- Re-pin the lockdown from migration 007 (CREATE OR REPLACE resets grants):
-- REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;

-- ============================================================================
-- NOTE — if STEP 1e prints "SIGNUP TRIGGER OK", the DB is fine and signup is
-- failing on Auth CONFIGURATION. Check, in Supabase Dashboard → Authentication:
--   • Providers → Email: "Enable Email provider" and "Enable Sign-ups" ON.
--   • "Confirm email": if ON, signups need a working SMTP + a Site URL /
--     redirect allowlist that includes the app origin, or the user is stuck at
--     "check your inbox". Custom SMTP not configured → the built-in email is
--     rate-limited to a few/hour and silently drops the rest.
--   • Rate limits → "Sign ups / sign ins": a low cap returns 429 on the Nth
--     new account (the client now surfaces this exact message).
--   • URL Configuration → Site URL + Redirect URLs must include the prod origin.
-- ============================================================================
