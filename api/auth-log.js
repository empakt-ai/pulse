// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Sign-in event recorder. The SPA calls this once after every
// fresh sign-in so the admin Users module can show a complete login
// history (Supabase's auth.users only keeps `last_sign_in_at`).
//
// Not admin-gated — any authenticated user can record THEIR OWN sign-in.
// The user_id is taken from the validated Supabase token, not the body,
// so a client can't insert events for someone else.
//
//   POST /api/auth-log  { method?, session_id? }
//     method      — 'magic_link' | 'password' | 'oauth' | 'restored'
//     session_id  — opaque dedup key (e.g. JWT iat) so repeat calls in
//                   the same session don't double-log
//     → 200 { logged: true, id }
//     → 401 if no valid token
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // Best-effort dedup: if the SPA passes a session_id and we already have
  // an event for this user with the same key, no-op. Cheap because the
  // user+signed_in_at index covers the query.
  const sessionId = typeof body.session_id === 'string' ? body.session_id : null;
  if (sessionId) {
    const existing = await supabase.select('user_sign_in_log', {
      select: 'id',
      eq: { user_id: auth.user.id, session_id: sessionId },
      limit: 1,
    }).catch(() => []);
    if (existing?.length) {
      return json(res, 200, { logged: false, reason: 'duplicate', id: existing[0].id });
    }
  }

  // IP: Vercel sets x-forwarded-for; the first hop is the client. UA from
  // the standard header. Both are nullable — we never want auth-log to
  // fail just because a header is missing.
  const xff = (req.headers?.['x-forwarded-for'] || '').toString();
  const ip = xff.split(',')[0]?.trim() || null;
  const userAgent = (req.headers?.['user-agent'] || '').toString() || null;

  const allowedMethods = new Set(['magic_link', 'password', 'oauth', 'restored']);
  const method = allowedMethods.has(body.method) ? body.method : null;

  try {
    const rows = await supabase.insert('user_sign_in_log', {
      user_id: auth.user.id,
      ip,
      user_agent: userAgent,
      session_id: sessionId,
      method,
    });
    return json(res, 200, { logged: true, id: rows?.[0]?.id || null });
  } catch (e) {
    // Don't surface the failure — the user is signed in regardless.
    // Vercel logs catch the error for debugging.
    console.error('[auth-log] insert failed:', e.message);
    return json(res, 200, { logged: false, reason: 'insert_failed' });
  }
}
