# Incident: new users can't create an account (July 2026)

## Symptom

New users can't sign up. Reported as:

- **Email + password signup** — "definitely not working."
- **Magic link** — "I think that works, but double-check."

## The key clue: the magic-link asymmetry

Magic link appears to work while password signup doesn't — but that asymmetry
is a **red herring about the mechanism** and actually the strongest pointer to
the root cause:

- A magic link requested for an **existing** account does **not** insert a new
  `auth.users` row. It just issues a one-time token for a user that already
  exists. Nothing signup-specific runs.
- Email + password signup — **and a magic link for a brand-new email address**
  (`create_user: true`) — **always inserts a new `auth.users` row.** That insert
  fires the `on_auth_user_created` trigger → `public.handle_new_user()` (and
  possibly `public.handle_new_profile()`), which bootstraps the user's
  `workspaces` / `profiles` rows.

So "magic link works" was almost certainly tested with an existing account. The
real dividing line isn't password-vs-magic-link — it's **existing user vs. new
user**. Anything that makes _new-user creation_ fail breaks both password
signup and new-email magic links, while leaving existing-user sign-in untouched.

## Root cause (prime suspect)

`handle_new_user()` is a `SECURITY DEFINER` trigger on `auth.users` (see
`migrations/007_security_cleanup.sql`, which hardens but does not define it).
Its body is **not** in the repo — it predates the numbered migrations and lives
only in the Supabase project.

If that trigger raises for any reason — a NOT NULL column added to
`workspaces`/`profiles` that it doesn't populate, a CHECK/FK it violates, an RLS
or `search_path` regression — Postgres aborts the `auth.users` INSERT and GoTrue
returns:

```
HTTP 500  { "code": "unexpected_failure", "message": "Database error saving new user" }
```

That is the classic "can't create account" failure, and it matches the
symptom exactly.

### Why we couldn't confirm it directly from this environment

- No `SUPABASE_SERVICE_KEY` is present here (repo only), so we can't query the DB.
- The session's egress policy **blocks the Supabase host** (the proxy returns
  `403` on CONNECT to `gyiiccstlrgzfbwgtuww.supabase.co`), so we can't reproduce
  against the live Auth API either.

Confirmation therefore needs one of: the exact error string from the browser
Network tab / Supabase Auth logs, or running the diagnostic SQL below.

## Fixes applied (in this branch)

### 1. Surface the real auth error — `js/core/auth.jsx`, `src/spa/screens.jsx`

The client only read `error_description || msg`, so a modern GoTrue
`{ code, message }` error (including "Database error saving new user") collapsed
to a generic "Sign up failed" — hiding the one line that explains the failure.

- Added an `authError()` helper that reads every GoTrue error shape
  (`error_description` / `message` / `msg` / `error`, plus `code` / `error_code`)
  and attaches `status`, `code`, and the raw body.
- The Auth screen now logs the full `{ step, status, code, message, raw }` to
  the console on failure and shows the true message to the user.

This is a zero-behavior-change diagnostic improvement: the next failed signup
shows _why_ it failed, in the UI and in devtools.

### 2. Diagnostic + repair SQL — `scripts/diagnose-signup.sql`

- **STEP 1** (read-only) dumps the `handle_new_user` / `handle_new_profile`
  function bodies, the `auth.users` triggers, the NOT NULL-without-default
  columns and constraints on `workspaces`/`profiles`, and runs a **decisive
  transactional probe** that inserts a throwaway `auth.users` row and rolls
  back — printing the exact SQLSTATE/message if the trigger raises.
- **STEP 2** is a hardened `handle_new_user()` template (SECURITY DEFINER,
  pinned `search_path`, best-effort bootstrap so a hiccup can't 500 signup),
  to apply once STEP 1 shows the real trigger body.

## How to close this out

1. **Fastest confirmation** — reproduce a password signup and read the exact
   error: browser DevTools → Network → the failing `POST …/auth/v1/signup`
   response, or Supabase Dashboard → Authentication → Logs. With the client fix
   deployed, the reason also appears inline and in the console.
2. Or run **STEP 1** of `scripts/diagnose-signup.sql` in the Supabase SQL Editor;
   the STEP 1e probe prints `SIGNUP TRIGGER FAILED — SQLSTATE … : …` or
   `SIGNUP TRIGGER OK`.
3. **If the trigger raises** → apply the reconciled STEP 2 repair.
4. **If STEP 1e prints OK** → the DB is fine and the failure is Auth
   **configuration** (see the NOTE block in the SQL): Email provider / Sign-ups
   enabled, "Confirm email" + SMTP + Site URL / redirect allowlist, and the
   signup rate limit.

## Status

- ✅ Client now surfaces the true auth error (deployed with this branch).
- ⏳ Definitive backend fix pending one input we can't get from this
  environment: the exact GoTrue error string, or the STEP 1 SQL output.
