# Mashal — Supabase Auth email templates

Branded HTML email templates for the Supabase Auth flows. The actual
templates that get sent live in Supabase Dashboard → Auth → Email
Templates; these files are the canonical source of truth and exist here
so the styling is version-controlled.

## Install

For each template:

1. Open the file, copy its contents.
2. Supabase Dashboard → Authentication → Email Templates → pick the matching template.
3. Set the subject line as listed below.
4. Paste the HTML into the Message body, replacing the default Supabase template.
5. Save.

Repeat for each template. Supabase saves immediately — no deploy needed.

## Template map

| File | Supabase template | Subject line | When it fires |
|---|---|---|---|
| `magic-link.html` | Magic Link | `Sign in to Mashal` | User requests OTP sign-in. |
| `confirm-signup.html` | Confirm signup | `Confirm your Mashal account` | New email + password signup. |
| `reset-password.html` | Reset Password | `Reset your Mashal password` | Forgot-password flow. |
| `change-email.html` | Change Email Address | `Confirm your new email for Mashal` | User changes the email on file. Sent to both old AND new addresses. |
| `invite-user.html` | Invite User | `You've been invited to Mashal` | Admin invites a new user via `inviteUserByEmail`. |

## Editing

- All CSS is inline. Email clients strip `<style>` blocks.
- Layout uses `<table role="presentation">` for Outlook compatibility.
- Fonts use a system-font stack (`-apple-system, Segoe UI, Roboto, …`).
  Don't try to load Bricolage Grotesque / Geist via Google Fonts — most
  email clients block remote CSS.
- Container max-width is 520px; layout is single column on mobile.
- Brand colors: paper `#F5F1E8`, card `#FBFAF6`, line `#E5E1D6`, ink
  `#0A0A0B`, mute `#9A958A`, magenta eyebrow `#FF3D8A`, ultra link
  `#6B5BFF`.

## After editing

1. Update the file here, commit.
2. Copy the new HTML into Supabase for the matching template.
3. Test by triggering the flow against a real inbox.

## SMTP

These templates assume Supabase Auth → SMTP Settings is wired to Resend
(see project notes). Sender address must use a domain verified in Resend
(`mashal.app`).
