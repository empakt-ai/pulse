// ═════════════════════════════════════════════════════════════════════════
// [ADMIN] Admin console backend. Single function, action-routed via
// ?action=... so we add admin capabilities without bumping the Vercel
// function count for every new screen.
//
// Phase 0 actions (this file):
//   GET    /api/admin?action=me               → identity + isAdmin echo
//   GET    /api/admin?action=settings         → full platform_settings map
//   PATCH  /api/admin?action=settings         → upsert keys (audit-logged)
//   GET    /api/admin?action=flags            → feature_flags subset
//   PATCH  /api/admin?action=flags            → set/remove flags (audit-logged)
//   GET    /api/admin?action=audit-log        → most-recent audit rows + filters
//
// Phase 1+ actions (added in their own commits): workspaces, users,
// trials, handles, briefs, sync-sources, reports, billing.
//
// Every write goes through requireAdmin → requireReason → mutation → log.
// The reason field is mandatory at both the API and DB layers.
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';
import { gate, requireReason, logAdminAction } from './_lib/admin.js';
import { getPlatformSettings, setSettings } from './_lib/platform-settings.js';

const AI_PROVIDERS = new Set(['gemini', 'anthropic']);
const SETTABLE_KEYS = new Set(['ai_provider', 'feature_flags', 'brief_prompt_version', 'caps']);

export default async function handler(req, res) {
  const auth = await authenticate(req);

  // `me` is the one action that's accessible to ANY authenticated user —
  // the admin SPA calls it to ask "should I render the admin UI for you?"
  // Everything else is admin-gated.
  const action = (req.query?.action || '').toString().toLowerCase();
  if (action === 'me') {
    if (auth.error) return json(res, auth.status, { error: auth.error });
    return json(res, 200, {
      user: { id: auth.user.id, email: auth.user.email },
      is_admin: !!auth.isAdmin,
    });
  }

  const g = gate(auth);
  if (!g.ok) return json(res, g.status, g.body);

  // ── Settings (full platform_settings map) ─────────────────────────────
  if (action === 'settings') {
    if (req.method === 'GET') {
      const values = await getPlatformSettings({ force: true });
      return json(res, 200, { settings: values });
    }
    if (req.method === 'PATCH') {
      const body = parseBody(req);
      const r = requireReason(body);
      if (r.envelope) return json(res, r.envelope.status, r.envelope.body);

      const patch = {};
      for (const [k, v] of Object.entries(body || {})) {
        if (k === 'reason') continue;
        if (!SETTABLE_KEYS.has(k)) continue;
        patch[k] = v;
      }
      // Per-key validation. Each branch keeps the value in canonical form
      // so the cache and the audit row agree with what's on disk.
      if ('ai_provider' in patch) {
        const provider = String(patch.ai_provider || '').toLowerCase();
        if (!AI_PROVIDERS.has(provider)) {
          return json(res, 400, { error: `ai_provider must be one of ${[...AI_PROVIDERS].join(', ')}` });
        }
        patch.ai_provider = provider;
      }
      if ('feature_flags' in patch) {
        const ff = patch.feature_flags;
        if (ff == null || typeof ff !== 'object' || Array.isArray(ff)) {
          return json(res, 400, { error: 'feature_flags must be an object' });
        }
      }
      if ('brief_prompt_version' in patch) {
        if (typeof patch.brief_prompt_version !== 'string' || !patch.brief_prompt_version.trim()) {
          return json(res, 400, { error: 'brief_prompt_version must be a non-empty string' });
        }
      }
      if ('caps' in patch) {
        if (patch.caps == null || typeof patch.caps !== 'object' || Array.isArray(patch.caps)) {
          return json(res, 400, { error: 'caps must be an object' });
        }
      }
      if (!Object.keys(patch).length) {
        return json(res, 400, { error: 'No valid keys to update' });
      }

      const before = await getPlatformSettings({ force: true });
      const after = await setSettings(patch, { userId: auth.user.id });

      // One audit row per key changed so the log filters cleanly by
      // `target_id = 'platform_settings:ai_provider'` etc.
      for (const k of Object.keys(patch)) {
        await logAdminAction({
          actor: auth.user.id,
          action: `settings.${k}.update`,
          targetType: 'platform_settings',
          targetId: `platform_settings:${k}`,
          before: { [k]: before[k] ?? null },
          after:  { [k]: after[k]  ?? null },
          reason: r.reason,
        });
      }

      return json(res, 200, { settings: after, updated: Object.keys(patch) });
    }
    return json(res, 405, { error: 'Method not allowed' });
  }

  // ── Feature flags (just the feature_flags slice, easier to reason about) ─
  if (action === 'flags') {
    if (req.method === 'GET') {
      const values = await getPlatformSettings({ force: true });
      return json(res, 200, { flags: values.feature_flags || {} });
    }
    if (req.method === 'PATCH') {
      const body = parseBody(req);
      const r = requireReason(body);
      if (r.envelope) return json(res, r.envelope.status, r.envelope.body);

      // Accept either { flags: {...} } (full replacement) or
      // { set: { key: bool }, remove: [keys] } (partial update). The
      // partial shape is easier to call from the admin UI on individual
      // toggle clicks; full replacement is the bulk-save path.
      const before = await getPlatformSettings({ force: true });
      const current = { ...(before.feature_flags || {}) };

      let next;
      if (body && typeof body.flags === 'object' && body.flags !== null && !Array.isArray(body.flags)) {
        next = { ...body.flags };
      } else {
        next = { ...current };
        if (body?.set && typeof body.set === 'object') {
          for (const [k, v] of Object.entries(body.set)) next[k] = !!v;
        }
        if (Array.isArray(body?.remove)) {
          for (const k of body.remove) delete next[k];
        }
      }

      const after = await setSettings({ feature_flags: next }, { userId: auth.user.id });
      await logAdminAction({
        actor: auth.user.id,
        action: 'settings.feature_flags.update',
        targetType: 'platform_settings',
        targetId: 'platform_settings:feature_flags',
        before: { feature_flags: current },
        after:  { feature_flags: after.feature_flags || {} },
        reason: r.reason,
      });
      return json(res, 200, { flags: after.feature_flags || {} });
    }
    return json(res, 405, { error: 'Method not allowed' });
  }

  // ── Audit log (read-only) ─────────────────────────────────────────────
  // Supports filtering by actor / target_type / target_id / action / a
  // date range. limit caps at 500 so a runaway filter doesn't burn the
  // function. Reads only — there's no PATCH/DELETE on audit entries.
  if (action === 'audit-log' && req.method === 'GET') {
    const q = req.query || {};
    const filter = { select: '*', order: 'created_at.desc' };
    const eq = {};
    if (q.actor)       eq.actor_user_id = q.actor;
    if (q.target_type) eq.target_type   = q.target_type;
    if (q.target_id)   eq.target_id     = q.target_id;
    if (q.action_name) eq.action        = q.action_name;
    if (Object.keys(eq).length) filter.eq = eq;
    if (q.since) filter.gte = { created_at: q.since };
    if (q.until) filter.lt  = { created_at: q.until };
    filter.limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
    const rows = await supabase.select('admin_audit_log', filter).catch(() => []);
    return json(res, 200, { entries: rows || [] });
  }

  return json(res, 400, { error: 'Unknown or unsupported action', action });
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  return body || {};
}
