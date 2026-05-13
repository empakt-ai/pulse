// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Admin console infrastructure. Three responsibilities:
//   1. requireAdmin(auth) — gate every admin endpoint. Returns null when
//      the caller is an admin, or an { status, body } envelope to send.
//   2. requireReason(body) — every admin write demands a non-empty reason
//      string. Enforced both here and via NOT NULL CHECK in the schema.
//   3. logAdminAction(...) — append a row to admin_audit_log. Called from
//      every admin write path AFTER the underlying mutation succeeds, so
//      the log reflects what actually happened. Failures are swallowed
//      (logged to console) — we never want audit-log noise to fail the
//      user-facing action.
// ═════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase.js';

export function requireAdmin(auth) {
  if (auth?.isAdmin) return null;
  return { status: 403, body: { error: 'Admin only.' } };
}

// Pull the reason field from a parsed body. Returns the trimmed string on
// success, or an { status, body } envelope on failure. Caller is expected
// to short-circuit on the envelope:
//
//   const r = requireReason(body);
//   if (r.envelope) return json(res, r.envelope.status, r.envelope.body);
//   const reason = r.reason;
export function requireReason(body) {
  const raw = body?.reason;
  if (typeof raw !== 'string' || !raw.trim()) {
    return {
      envelope: { status: 400, body: { error: 'A reason is required for this action.' } },
    };
  }
  return { reason: raw.trim() };
}

// Append an audit row. Designed to never throw — admin endpoints await
// this but treat failures as best-effort. Returns the inserted row or
// null. Always pass the FULL before/after state of the affected entity
// so a future investigator doesn't need to reconstruct it from history.
//
//   actor       — uuid of the admin doing the action (from auth.user.id)
//   action      — namespaced verb, e.g. 'trial.extend', 'handle.release'
//   targetType  — 'workspace' | 'user' | 'handle' | 'platform_settings' | 'subscription' | 'report'
//   targetId    — id of the affected entity (uuid as text or composite key)
//   before      — pre-change state (object, null if creation)
//   after       — post-change state (object, null if deletion)
//   reason      — non-empty justification string (already validated)
export async function logAdminAction({
  actor,
  action,
  targetType,
  targetId = null,
  before = null,
  after = null,
  reason,
}) {
  try {
    const rows = await supabase.insert('admin_audit_log', {
      actor_user_id: actor,
      action,
      target_type: targetType,
      target_id: targetId == null ? null : String(targetId),
      before,
      after,
      reason,
    });
    return rows?.[0] || null;
  } catch (e) {
    // Audit-log writes shouldn't fail the user-facing action. Surface the
    // error so it's visible in Vercel function logs, then swallow it.
    console.error('[admin-audit] insert failed:', e.message, { action, targetType, targetId });
    return null;
  }
}

// Convenience for read endpoints (no audit, just admin gate). Returns
// { ok: true, auth } or { ok: false, status, body } to keep call sites
// terse.
export function gate(auth) {
  if (auth?.error) return { ok: false, status: auth.status, body: { error: auth.error } };
  const block = requireAdmin(auth);
  if (block) return { ok: false, status: block.status, body: block.body };
  return { ok: true, auth };
}
