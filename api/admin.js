// ═════════════════════════════════════════════════════════════════════════
// [ADMIN] Admin console backend. Single function, action-routed via
// ?action=... so we add admin capabilities without bumping the Vercel
// function count for every new screen.
//
// Phase 0 actions:
//   GET    ?action=me                         → identity + isAdmin echo
//   GET    ?action=settings                   → full platform_settings map
//   PATCH  ?action=settings                   → upsert keys (audit-logged)
//   GET    ?action=flags                      → feature_flags subset
//   PATCH  ?action=flags                      → set/remove flags (audit-logged)
//   GET    ?action=audit-log                  → recent audit rows + filters
//
// Phase 1 actions:
//   GET    ?action=workspaces                 → list with owner email + counts
//   GET    ?action=workspace-detail&id=…      → one workspace + everything
//   POST   ?action=trial-set                  → extend/end/convert/reset
//   GET    ?action=handles                    → registry list with filters
//   POST   ?action=handle-release             → release a handle
//   POST   ?action=handle-reassign            → bind to a different workspace
//
// Every write goes through requireAdmin → requireReason → mutation → log.
// The reason field is mandatory at both the API and DB layers.
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';
import { gate, requireReason, logAdminAction } from './_lib/admin.js';
import { getPlatformSettings, setSettings } from './_lib/platform-settings.js';
import { tierFor } from './_lib/tiers.js';
import { normaliseHandle } from './_lib/handle-registry.js';

const AI_PROVIDERS = new Set(['gemini', 'anthropic']);
const SETTABLE_KEYS = new Set(['ai_provider', 'feature_flags', 'brief_prompt_version', 'caps']);
const TRIAL_OPS = new Set(['extend', 'end', 'convert', 'reset']);

// Supabase service-role helper for auth.users — PostgREST doesn't expose
// auth.users directly, but the admin endpoint at /auth/v1/admin/users does.
// We fetch a flat list of (id, email) pairs and merge in JS so workspace
// rows can be presented with their owner's email without a per-row lookup.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gyiiccstlrgzfbwgtuww.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

async function listAuthUsers({ ids = null, perPage = 1000 } = {}) {
  // Pull everyone in one shot for now — the workspace count is small.
  // If we cross ~1k users this needs paging. The `ids` filter narrows
  // post-fetch since the admin endpoint doesn't expose a server-side
  // id-set filter.
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=${perPage}`, {
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const users = data?.users || [];
    if (!ids) return users;
    const set = new Set(ids);
    return users.filter(u => set.has(u.id));
  } catch (e) {
    console.warn('[admin] listAuthUsers failed:', e.message);
    return [];
  }
}

// Build an in-memory index from a list. Cheap helper for the merge step.
function indexBy(rows, key) {
  const map = new Map();
  for (const r of rows || []) {
    if (r && r[key] != null) map.set(r[key], r);
  }
  return map;
}

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

  // ── Workspaces list ───────────────────────────────────────────────────
  // Returns every workspace with derived trial state, owner email, and
  // counts of accounts + competitors. The admin SPA renders this as the
  // searchable list. Counts come from bulk fetches that we group in JS —
  // simpler than coaxing PostgREST embedded counts through the REST
  // wrapper, and the cardinality stays manageable in early SaaS scale.
  if (action === 'workspaces' && req.method === 'GET') {
    const workspaces = await supabase.select('workspaces', {
      select: '*',
      order: 'created_at.desc',
      limit: 500,
    }).catch(() => []);

    // Parallelise the three lookups feeding the list view.
    const wsIds = (workspaces || []).map(w => w.id);
    const ownerIds = [...new Set((workspaces || []).map(w => w.owner_id).filter(Boolean))];
    const [accountsRows, competitorsRows, users] = await Promise.all([
      wsIds.length ? supabase.select('connected_accounts', {
        select: 'workspace_id,is_active',
        in: { workspace_id: wsIds },
        limit: 5000,
      }).catch(() => []) : [],
      wsIds.length ? supabase.select('competitors', {
        select: 'workspace_id',
        in: { workspace_id: wsIds },
        limit: 5000,
      }).catch(() => []) : [],
      listAuthUsers({ ids: ownerIds }),
    ]);

    const accountsByWs = new Map();
    for (const a of accountsRows || []) {
      if (!a.is_active) continue;
      accountsByWs.set(a.workspace_id, (accountsByWs.get(a.workspace_id) || 0) + 1);
    }
    const compsByWs = new Map();
    for (const c of competitorsRows || []) {
      compsByWs.set(c.workspace_id, (compsByWs.get(c.workspace_id) || 0) + 1);
    }
    const userById = indexBy(users, 'id');

    const out = (workspaces || []).map(w => {
      const trialState = deriveTrialState(w);
      const owner = userById.get(w.owner_id);
      return {
        id: w.id,
        name: w.name,
        owner_id: w.owner_id,
        owner_email: owner?.email || null,
        tier: w.tier || 'creator',
        trial_state: trialState.state,
        trial_days_left: trialState.daysLeft,
        trial_ends_at: w.trial_ends_at || null,
        trial_intent_tier: w.trial_intent_tier || null,
        trial_promo_code: w.trial_promo_code || null,
        accounts_count: accountsByWs.get(w.id) || 0,
        competitors_count: compsByWs.get(w.id) || 0,
        created_at: w.created_at,
        zernio_profile_id: w.zernio_profile_id || null,
      };
    });
    return json(res, 200, { workspaces: out });
  }

  // ── Workspace detail (one id, every angle) ───────────────────────────
  // Used by both the WorkspacesScreen drill-down and the TrialsScreen
  // (when the admin picks a workspace to act on, we re-fetch to make
  // sure trial state is fresh). Audit log is scoped to this workspace.
  if (action === 'workspace-detail' && req.method === 'GET') {
    const id = (req.query?.id || '').toString();
    if (!id) return json(res, 400, { error: 'id required' });

    const ws = await supabase.select('workspaces', {
      select: '*', eq: { id }, single: true,
    }).catch(() => null);
    if (!ws) return json(res, 404, { error: 'Workspace not found' });

    const [accounts, competitors, briefs, syncs, auditRows, owner] = await Promise.all([
      supabase.select('connected_accounts', {
        select: '*', eq: { workspace_id: id }, order: 'connected_at.asc',
      }).catch(() => []),
      supabase.select('competitors', {
        select: '*', eq: { workspace_id: id }, order: 'added_at.desc',
      }).catch(() => []),
      supabase.select('signals', {
        select: 'id,kind,title,impact,model_used,latency_ms,tokens_used,generated_at,metadata',
        eq: { workspace_id: id, kind: 'verdict' },
        order: 'generated_at.desc',
        limit: 10,
      }).catch(() => []),
      supabase.select('usage_log', {
        select: '*', eq: { workspace_id: id }, order: 'id.desc', limit: 20,
      }).catch(() => []),
      supabase.select('admin_audit_log', {
        select: '*',
        eq: { target_type: 'workspace', target_id: id },
        order: 'created_at.desc',
        limit: 50,
      }).catch(() => []),
      ws.owner_id
        ? listAuthUsers({ ids: [ws.owner_id] }).then(rs => rs[0] || null)
        : Promise.resolve(null),
    ]);

    const tier = tierFor(ws);
    const activeAccounts = (accounts || []).filter(a => a.is_active);
    const trialState = deriveTrialState(ws);

    return json(res, 200, {
      workspace: { ...ws, trial_state: trialState.state, trial_days_left: trialState.daysLeft },
      owner: owner ? { id: owner.id, email: owner.email, created_at: owner.created_at } : null,
      tier: {
        key: ws.tier || 'creator',
        label: tier.label,
        price_usd: tier.price_usd,
        runs_per_month: tier.runs_per_month,
        accounts_total: tier.accounts_total ?? (tier.accounts_per_platform ? tier.accounts_per_platform * tier.platforms : null),
        competitors_limit: tier.competitors,
      },
      usage: {
        accounts_active: activeAccounts.length,
        accounts_total:  (accounts || []).length,
        competitors:     (competitors || []).length,
      },
      accounts: accounts || [],
      competitors: competitors || [],
      briefs: briefs || [],
      sync_runs: syncs || [],
      audit_log: auditRows || [],
    });
  }

  // ── Trial controls (audit-logged) ────────────────────────────────────
  // The trial table on the workspace row is the only state we mutate
  // here. Stripe-side conversion lives outside this endpoint; `convert`
  // here just stamps trial_converted_at so the trial gate releases.
  if (action === 'trial-set' && req.method === 'POST') {
    const body = parseBody(req);
    const r = requireReason(body);
    if (r.envelope) return json(res, r.envelope.status, r.envelope.body);

    const wsId = String(body?.workspace_id || '').trim();
    const op   = String(body?.op || '').trim().toLowerCase();
    if (!wsId) return json(res, 400, { error: 'workspace_id is required' });
    if (!TRIAL_OPS.has(op)) {
      return json(res, 400, { error: `op must be one of ${[...TRIAL_OPS].join(', ')}` });
    }
    const days = Number.isFinite(+body?.days) ? Math.max(1, Math.min(60, +body.days)) : 7;

    const before = await supabase.select('workspaces', {
      select: '*', eq: { id: wsId }, single: true,
    }).catch(() => null);
    if (!before) return json(res, 404, { error: 'Workspace not found' });

    const now = new Date();
    let patch;
    if (op === 'extend') {
      patch = {
        trial_ends_at: new Date(now.getTime() + days * 86400_000).toISOString(),
        trial_locked: false,
      };
    } else if (op === 'end') {
      // Backdate ends_at by a minute so the trial-state derivation
      // immediately reads as locked even before the sweep cron runs.
      patch = {
        trial_ends_at: new Date(now.getTime() - 60_000).toISOString(),
        trial_locked: true,
      };
    } else if (op === 'convert') {
      patch = {
        trial_converted_at: now.toISOString(),
        trial_locked: false,
      };
    } else if (op === 'reset') {
      patch = {
        trial_started_at:   now.toISOString(),
        trial_ends_at:      new Date(now.getTime() + days * 86400_000).toISOString(),
        trial_converted_at: null,
        trial_locked:       false,
      };
    }

    let rows;
    try {
      rows = await supabase.update('workspaces', patch, { eq: { id: wsId } });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
    const after = rows?.[0] || null;

    // Snapshot only the fields we touched so the audit diff is readable.
    const snapKeys = ['trial_started_at', 'trial_ends_at', 'trial_converted_at', 'trial_locked'];
    const pickKeys = (row, keys) => Object.fromEntries(keys.map(k => [k, row?.[k] ?? null]));
    await logAdminAction({
      actor: auth.user.id,
      action: `trial.${op}`,
      targetType: 'workspace',
      targetId: wsId,
      before: pickKeys(before, snapKeys),
      after:  pickKeys(after, snapKeys),
      reason: r.reason,
    });

    return json(res, 200, { workspace: after, applied: op });
  }

  // ── Handles list ─────────────────────────────────────────────────────
  // Filters: platform, state ('bound' | 'released' | 'trial_locked').
  // workspace_name resolved client-side from the workspaces list — we
  // return workspace_id only here to keep the row narrow.
  if (action === 'handles' && req.method === 'GET') {
    const q = req.query || {};
    const filter = { select: '*', order: 'last_bound_at.desc', limit: 500 };
    const eq = {};
    if (q.platform) eq.platform = String(q.platform).toLowerCase();
    if (Object.keys(eq).length) filter.eq = eq;
    const rows = await supabase.select('social_handles', filter).catch(() => []);

    let filtered = rows || [];
    if (q.state === 'bound')        filtered = filtered.filter(h => !h.released_at && !!h.workspace_id);
    else if (q.state === 'released') filtered = filtered.filter(h => !!h.released_at);
    else if (q.state === 'trial_locked') filtered = filtered.filter(h => !!h.released_at && !!h.workspace_id);

    return json(res, 200, { handles: filtered });
  }

  // ── Handle release (audit-logged) ───────────────────────────────────
  // permanent:true nulls workspace_id (anyone can re-claim).
  // permanent:false sets released_at but keeps workspace_id so the
  // originating workspace can re-bind on upgrade — matches the trial-
  // expiry cron's behaviour.
  if (action === 'handle-release' && req.method === 'POST') {
    const body = parseBody(req);
    const r = requireReason(body);
    if (r.envelope) return json(res, r.envelope.status, r.envelope.body);

    const platform = String(body?.platform || '').trim().toLowerCase();
    const rawHandle = String(body?.handle || '');
    const handle = normaliseHandle(rawHandle);
    const permanent = !!body?.permanent;
    if (!platform || !handle) return json(res, 400, { error: 'platform and handle are required' });

    const rows = await supabase.select('social_handles', {
      select: '*', eq: { platform, handle }, limit: 1,
    }).catch(() => []);
    const before = rows?.[0];
    if (!before) return json(res, 404, { error: 'Handle not found' });

    const now = new Date().toISOString();
    const history = Array.isArray(before.history) ? before.history : [];
    const event = {
      kind: permanent ? 'release_permanent' : 'release_trial',
      reason: r.reason,
      actor: auth.user.id,
      at: now,
    };
    const patch = {
      released_at: now,
      history: [...history, event],
      ...(permanent ? { workspace_id: null } : {}),
    };
    const updated = await supabase.update('social_handles', patch, { eq: { id: before.id } });
    const after = updated?.[0] || null;

    await logAdminAction({
      actor: auth.user.id,
      action: permanent ? 'handle.release_permanent' : 'handle.release_trial',
      targetType: 'handle',
      targetId: `${platform}:${handle}`,
      before: {
        workspace_id: before.workspace_id, released_at: before.released_at, tier: before.tier,
      },
      after: {
        workspace_id: after?.workspace_id ?? null, released_at: after?.released_at ?? null, tier: after?.tier ?? null,
      },
      reason: r.reason,
    });

    return json(res, 200, { handle: after });
  }

  // ── Handle reassign (audit-logged) ──────────────────────────────────
  // Hard-binds the (platform, handle) row to a different workspace.
  // Clears released_at + history.kind:'admin_reassign' is appended so
  // the chain of custody is visible from the row alone.
  if (action === 'handle-reassign' && req.method === 'POST') {
    const body = parseBody(req);
    const r = requireReason(body);
    if (r.envelope) return json(res, r.envelope.status, r.envelope.body);

    const platform = String(body?.platform || '').trim().toLowerCase();
    const handle = normaliseHandle(body?.handle || '');
    const targetWsId = String(body?.workspace_id || '').trim();
    const tier = body?.tier ? String(body.tier).toLowerCase() : null;
    if (!platform || !handle || !targetWsId) {
      return json(res, 400, { error: 'platform, handle, workspace_id required' });
    }

    // Verify the target workspace exists before binding to it.
    const targetWs = await supabase.select('workspaces', {
      select: 'id,name,tier',
      eq: { id: targetWsId },
      single: true,
    }).catch(() => null);
    if (!targetWs) return json(res, 404, { error: 'Target workspace not found' });

    const rows = await supabase.select('social_handles', {
      select: '*', eq: { platform, handle }, limit: 1,
    }).catch(() => []);
    const before = rows?.[0] || null;

    const now = new Date().toISOString();
    const history = Array.isArray(before?.history) ? before.history : [];
    const event = {
      kind: 'admin_reassign',
      from_workspace_id: before?.workspace_id || null,
      to_workspace_id:   targetWsId,
      reason: r.reason,
      actor: auth.user.id,
      at: now,
    };
    const patch = {
      platform, handle,
      workspace_id: targetWsId,
      tier: tier || targetWs.tier || null,
      released_at: null,
      last_bound_at: now,
      history: [...history, event],
      ...(before ? {} : { first_claimed_at: now }),
    };

    let after;
    if (before) {
      const updated = await supabase.update('social_handles', patch, { eq: { id: before.id } });
      after = updated?.[0] || null;
    } else {
      const inserted = await supabase.insert('social_handles', patch);
      after = inserted?.[0] || null;
    }

    await logAdminAction({
      actor: auth.user.id,
      action: 'handle.reassign',
      targetType: 'handle',
      targetId: `${platform}:${handle}`,
      before: before ? {
        workspace_id: before.workspace_id, released_at: before.released_at, tier: before.tier,
      } : null,
      after: {
        workspace_id: after?.workspace_id ?? null, released_at: after?.released_at ?? null, tier: after?.tier ?? null,
      },
      reason: r.reason,
    });

    return json(res, 200, { handle: after });
  }

  return json(res, 400, { error: 'Unknown or unsupported action', action });
}

// Pure derivation of the trial-state label + days_left from a workspace
// row. Mirrors the logic in auth.js attachTrialState() but returns a
// structured object the admin UI can render directly.
function deriveTrialState(w) {
  if (!w) return { state: 'none', daysLeft: null };
  if (w.trial_converted_at) return { state: 'converted', daysLeft: null };
  if (!w.trial_started_at)  return { state: 'none', daysLeft: null };
  const endsAt = w.trial_ends_at ? new Date(w.trial_ends_at).getTime() : null;
  const now = Date.now();
  if (endsAt && now < endsAt) {
    return { state: 'active', daysLeft: Math.max(0, Math.ceil((endsAt - now) / 86400000)) };
  }
  return { state: 'locked', daysLeft: 0 };
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  return body || {};
}
