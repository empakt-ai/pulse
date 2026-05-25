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
// Phase 2 actions:
//   GET    ?action=users                      → list with workspace + sign-in counts
//   GET    ?action=user-detail&id=…           → profile, workspaces, sign-in history
//   POST   ?action=user-set                   → toggle is_admin / is_disabled
//   GET    ?action=briefs                     → brief generation history (read-only)
//   GET    ?action=sources                    → source health aggregates (read-only)
//   GET    ?action=reports                    → reports queue list (read-only)
//
// Phase 3 actions:
//   POST   ?action=self-tier-override         → set/clear caller's tier_override
//                                               (only honored when caller is admin)
//
// Phase 5 actions:
//   GET    ?action=overview                   → cross-module roll-up for the
//                                               Overview dashboard landing tile
//
// Phase 4 actions (this commit):
//   GET    ?action=billing                    → workspace list with Stripe state
//   GET    ?action=billing-detail&id=…        → one workspace + Stripe invoices
//   POST   ?action=billing-refresh            → force-pull subscription from Stripe
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
import { getSubscription, listInvoices, TIER_BY_PRICE } from './_lib/stripe.js';
import { sendEmail } from './_lib/email.js';

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

  // ── Users list ───────────────────────────────────────────────────────
  // Joins auth.users + profiles + workspace count + sign-in stats.
  // Returns one row per auth.users entry. Search and ordering happen
  // client-side — cardinality stays manageable until we cross several
  // hundred users, at which point we'll add a server-side search param.
  if (action === 'users' && req.method === 'GET') {
    const [users, profiles, workspaces, signins] = await Promise.all([
      listAuthUsers({}),
      supabase.select('profiles', {
        select: 'id,is_admin,is_disabled,disabled_at,disabled_reason,tier_override',
        limit: 5000,
      }).catch(() => []),
      supabase.select('workspaces', { select: 'owner_id', limit: 5000 }).catch(() => []),
      supabase.select('user_sign_in_log', {
        select: 'user_id,signed_in_at',
        order: 'signed_in_at.desc',
        limit: 10000,
      }).catch(() => []),
    ]);

    const profileById = indexBy(profiles, 'id');
    const wsCount = new Map();
    for (const w of workspaces || []) {
      wsCount.set(w.owner_id, (wsCount.get(w.owner_id) || 0) + 1);
    }
    const signinStats = new Map(); // user_id → { count, last }
    for (const e of signins || []) {
      const s = signinStats.get(e.user_id) || { count: 0, last: null };
      s.count += 1;
      if (!s.last || e.signed_in_at > s.last) s.last = e.signed_in_at;
      signinStats.set(e.user_id, s);
    }

    const out = (users || []).map(u => {
      const p = profileById.get(u.id) || {};
      const s = signinStats.get(u.id) || { count: 0, last: null };
      return {
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at || s.last || null,
        sign_in_count: s.count,
        workspace_count: wsCount.get(u.id) || 0,
        is_admin: !!p.is_admin,
        is_disabled: !!p.is_disabled,
        disabled_at: p.disabled_at || null,
        disabled_reason: p.disabled_reason || null,
        tier_override: p.tier_override || null,
      };
    });
    // Newest sign-up at the top — easiest to spot new accounts.
    out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return json(res, 200, { users: out });
  }

  // ── User detail ─────────────────────────────────────────────────────
  // Single profile row + every workspace they own + every sign-in event
  // we've recorded for them.
  if (action === 'user-detail' && req.method === 'GET') {
    const id = (req.query?.id || '').toString();
    if (!id) return json(res, 400, { error: 'id required' });

    const userList = await listAuthUsers({ ids: [id] });
    const user = userList?.[0] || null;
    if (!user) return json(res, 404, { error: 'User not found' });

    const [profile, owned, signins, auditRows] = await Promise.all([
      supabase.select('profiles', {
        select: '*', eq: { id }, single: true,
      }).catch(() => null),
      supabase.select('workspaces', {
        select: 'id,name,tier,trial_ends_at,trial_converted_at,created_at',
        eq: { owner_id: id },
        order: 'created_at.asc',
      }).catch(() => []),
      supabase.select('user_sign_in_log', {
        select: '*', eq: { user_id: id }, order: 'signed_in_at.desc', limit: 200,
      }).catch(() => []),
      supabase.select('admin_audit_log', {
        select: '*',
        eq: { target_type: 'user', target_id: id },
        order: 'created_at.desc',
        limit: 50,
      }).catch(() => []),
    ]);

    return json(res, 200, {
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
        confirmed_at: user.confirmed_at,
      },
      profile: profile || {},
      workspaces: (owned || []).map(w => ({
        ...w,
        trial_state: deriveTrialState(w).state,
      })),
      sign_ins: signins || [],
      audit_log: auditRows || [],
    });
  }

  // ── User-set (toggle is_admin / is_disabled) ────────────────────────
  // Two fields admin can flip on a profile. Reason required, audit-
  // logged with before/after. We deliberately don't allow editing the
  // tier_override here — that's a self-managed knob the admin sets on
  // their own profile via a future Settings → "View as" surface.
  if (action === 'user-set' && req.method === 'POST') {
    const body = parseBody(req);
    const r = requireReason(body);
    if (r.envelope) return json(res, r.envelope.status, r.envelope.body);

    const userId = String(body?.user_id || '').trim();
    if (!userId) return json(res, 400, { error: 'user_id is required' });

    const patch = {};
    if (typeof body.is_admin === 'boolean')    patch.is_admin = body.is_admin;
    if (typeof body.is_disabled === 'boolean') {
      patch.is_disabled = body.is_disabled;
      patch.disabled_at = body.is_disabled ? new Date().toISOString() : null;
      patch.disabled_reason = body.is_disabled ? r.reason : null;
    }
    if (!Object.keys(patch).length) {
      return json(res, 400, { error: 'Nothing to update — provide is_admin and/or is_disabled' });
    }

    // Self-protection: an admin can't disable themselves or revoke their
    // own is_admin (would lock everyone out of the console). Use a
    // different admin account if a second exists.
    if (userId === auth.user.id) {
      if (patch.is_admin === false) {
        return json(res, 400, { error: "You can't revoke your own admin flag. Use another admin account." });
      }
      if (patch.is_disabled === true) {
        return json(res, 400, { error: "You can't disable your own account." });
      }
    }

    const before = await supabase.select('profiles', {
      select: 'is_admin,is_disabled,disabled_at,disabled_reason',
      eq: { id: userId },
      single: true,
    }).catch(() => null);
    if (!before) return json(res, 404, { error: 'Profile not found' });

    let rows;
    try {
      rows = await supabase.update('profiles', patch, { eq: { id: userId } });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
    const after = rows?.[0] || null;

    // Two audit entries when both fields change — keeps the action name
    // namespace clean (`user.admin.update` vs `user.disabled.update`).
    if ('is_admin' in patch) {
      await logAdminAction({
        actor: auth.user.id,
        action: 'user.admin.update',
        targetType: 'user',
        targetId: userId,
        before: { is_admin: before.is_admin },
        after:  { is_admin: after?.is_admin },
        reason: r.reason,
      });
    }
    if ('is_disabled' in patch) {
      await logAdminAction({
        actor: auth.user.id,
        action: 'user.disabled.update',
        targetType: 'user',
        targetId: userId,
        before: {
          is_disabled: before.is_disabled,
          disabled_reason: before.disabled_reason,
        },
        after: {
          is_disabled: after?.is_disabled,
          disabled_reason: after?.disabled_reason,
        },
        reason: r.reason,
      });
    }

    return json(res, 200, { profile: after });
  }

  // ── Briefs (read-only diagnostic) ───────────────────────────────────
  // Joins signals (verdicts) with usage_log (intelligence runs) for
  // status / failures. Useful for "why did this brief fail?" support
  // questions. Filter by workspace_id, model, or status.
  if (action === 'briefs' && req.method === 'GET') {
    const q = req.query || {};
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 200));

    const filter = {
      select: 'id,workspace_id,title,model_used,latency_ms,tokens_used,generated_at,metadata',
      eq: { kind: 'verdict' },
      order: 'generated_at.desc',
      limit,
    };
    if (q.workspace_id) filter.eq.workspace_id = q.workspace_id;
    const verdicts = await supabase.select('signals', filter).catch(() => []);

    // Pull recent failed intelligence runs for the same window so the
    // UI can show "12 succeeded, 3 failed in the last 200" cleanly.
    const usageFilter = {
      select: 'id,workspace_id,status,cost_cents,run_at,records_fetched',
      eq: { run_type: 'intelligence' },
      order: 'id.desc',
      limit,
    };
    if (q.workspace_id) usageFilter.eq.workspace_id = q.workspace_id;
    const runs = await supabase.select('usage_log', usageFilter).catch(() => []);

    // Map workspace_id → name for display.
    const wsIds = [...new Set([
      ...(verdicts || []).map(v => v.workspace_id),
      ...(runs || []).map(r => r.workspace_id),
    ].filter(Boolean))];
    const workspaces = wsIds.length ? await supabase.select('workspaces', {
      select: 'id,name', in: { id: wsIds },
    }).catch(() => []) : [];
    const wsById = indexBy(workspaces, 'id');
    const nameOf = (id) => wsById.get(id)?.name || null;

    // Apply post-filters that PostgREST can't trivially express.
    let entries = (verdicts || []).map(v => ({
      id: v.id,
      workspace_id: v.workspace_id,
      workspace_name: nameOf(v.workspace_id),
      title: v.title,
      model_used: v.model_used || v.metadata?.model || null,
      latency_ms: v.latency_ms,
      tokens_used: v.tokens_used,
      generated_at: v.generated_at,
      prompt_version: v.metadata?.prompt_version || null,
      score_factors: v.metadata?.score_factors || [],
    }));
    if (q.model) entries = entries.filter(e => (e.model_used || '').toLowerCase() === String(q.model).toLowerCase());

    const failed_runs = (runs || []).filter(r => r.status === 'failed').map(r => ({
      ...r,
      workspace_name: nameOf(r.workspace_id),
    }));
    const totals = {
      verdicts: entries.length,
      failed_runs: failed_runs.length,
      total_runs: (runs || []).length,
    };

    return json(res, 200, { briefs: entries, failed_runs, totals });
  }

  // ── Sources (read-only diagnostic) ──────────────────────────────────
  // Aggregates usage_log into a per-source health view. Keyed by
  // run_type (intelligence / sync / scrape / backfill / etc.) and
  // bucketed by 1h / 24h / 7d windows. Each bucket reports counts +
  // failure rate so a regression is visible without grep.
  if (action === 'sources' && req.method === 'GET') {
    const sinceHour = new Date(Date.now() - 3600_000).toISOString();
    const sinceDay  = new Date(Date.now() - 86400_000).toISOString();
    const sinceWeek = new Date(Date.now() - 7 * 86400_000).toISOString();

    const rows = await supabase.select('usage_log', {
      select: 'run_type,status,run_at,workspace_id,cost_cents',
      gte: { run_at: sinceWeek },
      order: 'id.desc',
      limit: 5000,
    }).catch(() => []);

    // Group counts by run_type + status. Walk once, distribute into the
    // three windows by timestamp comparison.
    const grouped = {};
    const ensure = (rt) => {
      if (!grouped[rt]) {
        grouped[rt] = {
          run_type: rt,
          window_1h:  { total: 0, failed: 0 },
          window_24h: { total: 0, failed: 0 },
          window_7d:  { total: 0, failed: 0 },
          cost_cents_7d: 0,
        };
      }
      return grouped[rt];
    };
    for (const r of rows || []) {
      const rt = r.run_type || 'unknown';
      const g = ensure(rt);
      const ts = r.run_at;
      const failed = r.status === 'failed';
      const inc = (b) => { b.total += 1; if (failed) b.failed += 1; };
      if (ts >= sinceWeek) { inc(g.window_7d); g.cost_cents_7d += (r.cost_cents || 0); }
      if (ts >= sinceDay)  inc(g.window_24h);
      if (ts >= sinceHour) inc(g.window_1h);
    }

    // Per-workspace fallback usage: workspaces with the most failed
    // intelligence runs in 24h. Useful "who's hurting?" lens.
    const fallbackByWs = new Map();
    for (const r of rows || []) {
      if (r.run_type !== 'intelligence') continue;
      if (r.run_at < sinceDay) continue;
      const cur = fallbackByWs.get(r.workspace_id) || { total: 0, failed: 0 };
      cur.total += 1;
      if (r.status === 'failed') cur.failed += 1;
      fallbackByWs.set(r.workspace_id, cur);
    }
    const wsIds = [...fallbackByWs.keys()];
    const workspaces = wsIds.length ? await supabase.select('workspaces', {
      select: 'id,name', in: { id: wsIds },
    }).catch(() => []) : [];
    const wsById = indexBy(workspaces, 'id');
    const per_workspace = [...fallbackByWs.entries()]
      .map(([id, stats]) => ({
        workspace_id: id,
        workspace_name: wsById.get(id)?.name || '—',
        ...stats,
      }))
      .filter(r => r.failed > 0)
      .sort((a, b) => b.failed - a.failed)
      .slice(0, 20);

    return json(res, 200, {
      sources: Object.values(grouped).sort((a, b) => a.run_type.localeCompare(b.run_type)),
      per_workspace_fallbacks: per_workspace,
    });
  }

  // ── Self tier-override ───────────────────────────────────────────────
  // Sets / clears the caller's own profiles.tier_override. We restrict
  // to "self" so one admin can't surreptitiously rewrite another
  // admin's view. Reason required, audit-logged. auth.js only honors
  // tier_override when the row's is_admin=true, so a non-admin row with
  // an override (set via SQL) still gets ignored at request time.
  if (action === 'self-tier-override' && req.method === 'POST') {
    const body = parseBody(req);
    const r = requireReason(body);
    if (r.envelope) return json(res, r.envelope.status, r.envelope.body);

    const raw = body?.tier_override;
    let next = null;
    if (raw === null || raw === '') {
      next = null;
    } else if (typeof raw === 'string' && ['creator', 'brand', 'agency'].includes(raw.toLowerCase())) {
      next = raw.toLowerCase();
    } else {
      return json(res, 400, { error: "tier_override must be 'creator' | 'brand' | 'agency' | null" });
    }

    const before = await supabase.select('profiles', {
      select: 'tier_override',
      eq: { id: auth.user.id },
      single: true,
    }).catch(() => null);

    const rows = await supabase.update('profiles', { tier_override: next }, { eq: { id: auth.user.id } });
    const after = rows?.[0] || null;

    await logAdminAction({
      actor: auth.user.id,
      action: 'user.tier_override.update',
      targetType: 'user',
      targetId: auth.user.id,
      before: { tier_override: before?.tier_override ?? null },
      after:  { tier_override: after?.tier_override ?? null },
      reason: r.reason,
    });

    return json(res, 200, { tier_override: after?.tier_override ?? null });
  }

  // ── Reports queue (read-only) ──────────────────────────────────────
  // Lists every report with status filter. Joins workspace name for the
  // display. Mutating actions (retry / cancel) land in a follow-up — the
  // existing /api/reports POST creates new reports rather than retrying,
  // so retry needs its own thinking.
  if (action === 'reports' && req.method === 'GET') {
    const q = req.query || {};
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 200));
    const filter = {
      select: 'id,workspace_id,kind,period,status,error,generated_at,emailed_at,summary',
      order: 'generated_at.desc',
      limit,
    };
    if (q.status) filter.eq = { ...(filter.eq || {}), status: q.status };
    if (q.kind)   filter.eq = { ...(filter.eq || {}), kind: q.kind };
    const reports = await supabase.select('reports', filter).catch(() => []);

    const wsIds = [...new Set((reports || []).map(r => r.workspace_id).filter(Boolean))];
    const workspaces = wsIds.length ? await supabase.select('workspaces', {
      select: 'id,name', in: { id: wsIds },
    }).catch(() => []) : [];
    const wsById = indexBy(workspaces, 'id');

    const out = (reports || []).map(r => ({
      ...r,
      workspace_name: wsById.get(r.workspace_id)?.name || null,
    }));
    const totals = {
      total:     out.length,
      rendering: out.filter(r => r.status === 'rendering').length,
      ready:     out.filter(r => r.status === 'ready').length,
      failed:    out.filter(r => r.status === 'failed').length,
    };
    return json(res, 200, { reports: out, totals });
  }

  // ── Billing list ─────────────────────────────────────────────────────
  // Every workspace with its Stripe state side-by-side with its trial
  // state. The admin uses this to spot drift (e.g. trial_converted_at
  // set but no subscription_id), past_due workspaces, and renewals
  // landing in the next few days.
  if (action === 'billing' && req.method === 'GET') {
    const [workspaces, profiles] = await Promise.all([
      supabase.select('workspaces', {
        select: 'id,name,owner_id,tier,trial_converted_at,stripe_subscription_id,stripe_subscription_status,stripe_price_id,stripe_current_period_end,stripe_cancel_at_period_end,stripe_last_invoice_status,stripe_last_event_at',
        order: 'created_at.desc',
        limit: 500,
      }).catch(() => []),
      supabase.select('profiles', {
        select: 'id,stripe_customer_id',
        limit: 5000,
      }).catch(() => []),
    ]);
    const ownerIds = [...new Set((workspaces || []).map(w => w.owner_id).filter(Boolean))];
    const users = await listAuthUsers({ ids: ownerIds });
    const userById = indexBy(users, 'id');
    const profileById = indexBy(profiles, 'id');

    const out = (workspaces || []).map(w => {
      const profile = profileById.get(w.owner_id);
      const tierFromPrice = w.stripe_price_id ? TIER_BY_PRICE[w.stripe_price_id] : null;
      return {
        id: w.id,
        name: w.name,
        owner_email: userById.get(w.owner_id)?.email || null,
        stripe_customer_id: profile?.stripe_customer_id || null,
        tier: w.tier,
        tier_from_price: tierFromPrice,
        stripe_subscription_id: w.stripe_subscription_id,
        stripe_subscription_status: w.stripe_subscription_status,
        stripe_current_period_end: w.stripe_current_period_end,
        stripe_cancel_at_period_end: !!w.stripe_cancel_at_period_end,
        stripe_last_invoice_status: w.stripe_last_invoice_status,
        stripe_last_event_at: w.stripe_last_event_at,
        trial_converted_at: w.trial_converted_at,
      };
    });
    return json(res, 200, { workspaces: out });
  }

  // ── Billing detail (one workspace + Stripe invoices) ─────────────────
  if (action === 'billing-detail' && req.method === 'GET') {
    const id = (req.query?.id || '').toString();
    if (!id) return json(res, 400, { error: 'id required' });

    const ws = await supabase.select('workspaces', {
      select: '*', eq: { id }, single: true,
    }).catch(() => null);
    if (!ws) return json(res, 404, { error: 'Workspace not found' });

    const profile = ws.owner_id ? await supabase.select('profiles', {
      select: 'id,stripe_customer_id',
      eq: { id: ws.owner_id },
      single: true,
    }).catch(() => null) : null;

    let invoices = [];
    if (profile?.stripe_customer_id) {
      try {
        const list = await listInvoices(profile.stripe_customer_id, { limit: 20 });
        invoices = (list?.data || []).map(inv => ({
          id: inv.id,
          number: inv.number,
          status: inv.status,
          amount_due: inv.amount_due,
          amount_paid: inv.amount_paid,
          currency: inv.currency,
          created: inv.created ? new Date(inv.created * 1000).toISOString() : null,
          period_end: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
          hosted_invoice_url: inv.hosted_invoice_url,
          invoice_pdf: inv.invoice_pdf,
        }));
      } catch (e) {
        // Don't fail the detail view if Stripe is unreachable — show
        // what we have on file plus a warning.
        invoices = [{ error: e.message }];
      }
    }

    return json(res, 200, {
      workspace: ws,
      profile,
      invoices,
    });
  }

  // ── Billing refresh (audit-logged) ───────────────────────────────────
  // Force-pull the subscription from Stripe and mirror state into our
  // tables. Useful when a webhook was lost or when we suspect drift.
  // Same patch shape as handleSubscriptionUpsert in stripe-webhook.js —
  // keeping the logic duplicated rather than shared avoids cross-file
  // coupling while the surface is small; revisit if a third caller
  // appears.
  if (action === 'billing-refresh' && req.method === 'POST') {
    const body = parseBody(req);
    const r = requireReason(body);
    if (r.envelope) return json(res, r.envelope.status, r.envelope.body);

    const workspaceId = String(body?.workspace_id || '').trim();
    if (!workspaceId) return json(res, 400, { error: 'workspace_id required' });

    const before = await supabase.select('workspaces', {
      select: 'id,owner_id,tier,stripe_subscription_id,stripe_subscription_status,stripe_price_id,stripe_current_period_end,stripe_cancel_at_period_end',
      eq: { id: workspaceId },
      single: true,
    }).catch(() => null);
    if (!before) return json(res, 404, { error: 'Workspace not found' });
    if (!before.stripe_subscription_id) {
      return json(res, 400, { error: 'No subscription_id on file — workspace has not converted from trial' });
    }

    let sub;
    try {
      sub = await getSubscription(before.stripe_subscription_id);
    } catch (e) {
      return json(res, e.status || 502, { error: `Stripe: ${e.message}` });
    }

    const item = (sub.items?.data || [])[0];
    const priceId = item?.price?.id || null;
    const derivedTier = priceId ? TIER_BY_PRICE[priceId] : null;
    const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;

    const patch = {
      stripe_subscription_status: sub.status,
      stripe_price_id: priceId,
      stripe_current_period_end: periodEnd,
      stripe_cancel_at_period_end: !!sub.cancel_at_period_end,
      stripe_last_event_at: new Date().toISOString(),
    };
    if (derivedTier && derivedTier !== before.tier) patch.tier = derivedTier;

    const updated = await supabase.update('workspaces', patch, { eq: { id: workspaceId } });
    const after = updated?.[0] || null;

    await logAdminAction({
      actor: auth.user.id,
      action: 'billing.refresh',
      targetType: 'workspace',
      targetId: workspaceId,
      before: {
        tier: before.tier,
        stripe_subscription_status: before.stripe_subscription_status,
        stripe_price_id: before.stripe_price_id,
        stripe_current_period_end: before.stripe_current_period_end,
      },
      after: {
        tier: patch.tier ?? before.tier,
        stripe_subscription_status: patch.stripe_subscription_status,
        stripe_price_id: patch.stripe_price_id,
        stripe_current_period_end: patch.stripe_current_period_end,
      },
      reason: r.reason,
    });

    return json(res, 200, { workspace: after });
  }

  // ── Overview (cross-module roll-up) ──────────────────────────────────
  // One round-trip for the Overview dashboard. Every read here is also
  // available individually elsewhere — this just consolidates so the
  // landing tile doesn't fan out five HTTP calls. Parallelised internally.
  if (action === 'overview' && req.method === 'GET') {
    const since24h = new Date(Date.now() - 86400_000).toISOString();
    const [workspaces, handles, runs24h, reports, recentAudit, settings] = await Promise.all([
      supabase.select('workspaces', {
        // Adding the stripe_* columns so the "needs attention" block can
        // flag past_due / cancel-pending / renewing-soon without a
        // second query.
        select: 'id,tier,trial_started_at,trial_ends_at,trial_converted_at,stripe_subscription_status,stripe_current_period_end,stripe_cancel_at_period_end',
        limit: 5000,
      }).catch(() => []),
      supabase.select('social_handles', {
        select: 'id,workspace_id,released_at',
        limit: 5000,
      }).catch(() => []),
      supabase.select('usage_log', {
        select: 'id,run_type,status,run_at,cost_cents',
        gte: { run_at: since24h },
        limit: 5000,
      }).catch(() => []),
      supabase.select('reports', {
        select: 'id,status',
        limit: 2000,
      }).catch(() => []),
      supabase.select('admin_audit_log', {
        select: '*',
        order: 'created_at.desc',
        limit: 10,
      }).catch(() => []),
      getPlatformSettings({ force: true }),
    ]);

    // Workspace totals — same shape as the Health endpoint we already
    // expose elsewhere, but kept inline here so the dashboard doesn't
    // need to know about both endpoints.
    const wsTotals = { total: (workspaces || []).length, trial_active: 0, trial_locked: 0, converted: 0, none: 0, by_tier: {} };
    for (const w of workspaces || []) {
      const s = deriveTrialState(w).state;
      if (s === 'active')    wsTotals.trial_active += 1;
      else if (s === 'locked')    wsTotals.trial_locked += 1;
      else if (s === 'converted') wsTotals.converted   += 1;
      else                        wsTotals.none        += 1;
      const t = w.tier || 'creator';
      wsTotals.by_tier[t] = (wsTotals.by_tier[t] || 0) + 1;
    }

    // "Needs attention" rollup — drives the prominent tile at the top of
    // the Overview screen. Counts shift in real time as the underlying
    // workspaces / subscriptions change; we recompute on every load so
    // there's never any cached staleness.
    const nowMs    = Date.now();
    const day24Ms  = 24 * 3600_000;
    const day7Ms   = 7  * 86400_000;
    const needsAttention = {
      trials_ending_24h:    0,
      subs_renewing_24h:    0,
      subs_past_due:        0,
      subs_canceling_soon:  0,
    };
    for (const w of workspaces || []) {
      const trial = deriveTrialState(w);
      if (trial.state === 'active' && (trial.daysLeft ?? 99) <= 1) {
        needsAttention.trials_ending_24h += 1;
      }
      const periodEnd = w.stripe_current_period_end ? new Date(w.stripe_current_period_end).getTime() : null;
      if (w.stripe_subscription_status === 'past_due') {
        needsAttention.subs_past_due += 1;
      }
      if (w.stripe_subscription_status === 'active' && periodEnd && (periodEnd - nowMs) <= day24Ms && (periodEnd - nowMs) >= 0) {
        needsAttention.subs_renewing_24h += 1;
      }
      if (w.stripe_cancel_at_period_end && periodEnd && (periodEnd - nowMs) <= day7Ms && (periodEnd - nowMs) >= 0) {
        needsAttention.subs_canceling_soon += 1;
      }
    }

    const handleTotals = {
      total: (handles || []).length,
      bound: (handles || []).filter(h => !h.released_at && !!h.workspace_id).length,
      released: (handles || []).filter(h => !!h.released_at).length,
    };

    const runTotals = {
      last_24h: (runs24h || []).length,
      failed_24h: (runs24h || []).filter(r => r.status === 'failed').length,
      briefs_24h: (runs24h || []).filter(r => r.run_type === 'intelligence').length,
      cost_cents_24h: (runs24h || []).reduce((s, r) => s + (r.cost_cents || 0), 0),
    };

    const reportTotals = {
      total: (reports || []).length,
      rendering: (reports || []).filter(r => r.status === 'rendering').length,
      ready: (reports || []).filter(r => r.status === 'ready').length,
      failed: (reports || []).filter(r => r.status === 'failed').length,
    };

    return json(res, 200, {
      needs_attention: needsAttention,
      workspaces: wsTotals,
      handles:    handleTotals,
      runs:       runTotals,
      reports:    reportTotals,
      settings: {
        ai_provider: settings?.ai_provider || 'gemini',
        flag_count:  Object.keys(settings?.feature_flags || {}).length,
        prompt_version: settings?.brief_prompt_version || 'v1',
      },
      recent_audit: recentAudit || [],
    });
  }

  // ── Support tickets (admin view) ──────────────────────────────────────
  // GET ?action=tickets[&status=open|...]  → list tickets, newest-first.
  // Decorates each row with the submitter's email so the admin UI can
  // render it without an additional per-row lookup.
  if (action === 'tickets' && req.method === 'GET') {
    const statusFilter = (req.query?.status || '').toString().toLowerCase();
    const params = { select: '*', order: 'created_at.desc', limit: 200 };
    if (TICKET_STATUSES.has(statusFilter)) params.eq = { status: statusFilter };
    const tickets = await supabase.select('support_tickets', params).catch(() => []);

    const userIds = [...new Set((tickets || []).map(t => t.user_id))];
    const users = userIds.length ? await listAuthUsers({ ids: userIds }) : [];
    const userById = indexBy(users, 'id');

    return json(res, 200, {
      tickets: (tickets || []).map(t => ({
        ...t,
        user_email: userById.get(t.user_id)?.email || null,
      })),
    });
  }

  // POST ?action=ticket-set { ticket_id, status, founder_note?, reason }
  // Updates the ticket's status + optional founder note, audit-logs, and
  // emails the submitter when the new status is one the user cares
  // about (accepted / in_progress / resolved / declined). Skips email on
  // open → in_review transitions to avoid pinging users on internal
  // triage events.
  if (action === 'ticket-set' && req.method === 'POST') {
    const body = parseBody(req);
    const r = requireReason(body);
    if (r.envelope) return json(res, r.envelope.status, r.envelope.body);

    const ticketId   = String(body.ticket_id || '').trim();
    const nextStatus = String(body.status    || '').toLowerCase().trim();
    const note       = body.founder_note != null ? String(body.founder_note).slice(0, 2000) : null;

    if (!ticketId)                       return json(res, 400, { error: 'ticket_id required' });
    if (!TICKET_STATUSES.has(nextStatus)) {
      return json(res, 400, { error: `status must be one of ${[...TICKET_STATUSES].join(', ')}` });
    }

    const before = await supabase.select('support_tickets', {
      select: '*', eq: { id: ticketId }, single: true,
    }).catch(() => null);
    if (!before) return json(res, 404, { error: 'Ticket not found' });

    const patch = {
      status:     nextStatus,
      updated_at: new Date().toISOString(),
    };
    if (note != null) patch.founder_note = note;
    if ((nextStatus === 'resolved' || nextStatus === 'declined') && !before.resolved_at) {
      patch.resolved_at = new Date().toISOString();
    }

    let after;
    try {
      const rows = await supabase.update('support_tickets', patch, { eq: { id: ticketId } });
      after = rows?.[0] || null;
    } catch (e) {
      return json(res, 500, { error: e.message });
    }

    await logAdminAction({
      actor:      auth.user.id,
      action:     'support.ticket.status',
      targetType: 'support_ticket',
      targetId:   ticketId,
      before:     { status: before.status, founder_note: before.founder_note || null },
      after:      { status: after?.status, founder_note: after?.founder_note || null },
      reason:     body.reason,
    }).catch(() => {});

    // Best-effort user notification — only on status changes the user
    // genuinely wants to hear about.
    let email_status = 'skipped';
    if (NOTIFY_STATUSES.has(nextStatus) && nextStatus !== before.status) {
      const users = await listAuthUsers({ ids: [before.user_id] });
      const recipient = users[0]?.email || null;
      if (recipient) {
        try {
          await sendEmail({
            to:      recipient,
            subject: `[Mashal] Update on your ${before.type}: ${before.subject}`.slice(0, 180),
            html:    ticketStatusEmailHtml({ status: nextStatus, ticket: before, note: patch.founder_note }),
            text:    ticketStatusEmailText({ status: nextStatus, ticket: before, note: patch.founder_note }),
          });
          email_status = 'sent';
        } catch (e) {
          email_status = 'failed';
          console.warn('[admin] ticket status email failed:', e.message);
        }
      }
    }

    return json(res, 200, { ticket: after, email_status });
  }

  return json(res, 400, { error: 'Unknown or unsupported action', action });
}

// Status workflow for support_tickets — mirrored from migration 025's
// CHECK constraint. NOTIFY_STATUSES is the subset where the submitter
// actually wants an email; in_review and back-to-open transitions are
// internal triage and stay silent.
const TICKET_STATUSES = new Set(['open','in_review','accepted','in_progress','resolved','declined']);
const NOTIFY_STATUSES = new Set(['accepted','in_progress','resolved','declined']);

const STATUS_HEADLINE = {
  accepted:    "Your suggestion is on the build queue.",
  in_progress: "We've started on this.",
  resolved:    "We've shipped a fix / answered your question.",
  declined:    "We won't be doing this — here's why.",
};

function ticketStatusEmailHtml({ status, ticket, note }) {
  // SECURITY (audit, May 2026): full HTML escape — was only escaping `<`,
  // leaving attribute-context injection paths open via `"` and `'`.
  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
  const safeSubject = escapeHtml(String(ticket.subject).slice(0, 200));
  const safeNote = note ? escapeHtml(String(note)).replace(/\n/g, '<br/>') : null;
  const headline = STATUS_HEADLINE[status] || `Your ticket is now ${status}.`;
  return `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; background:#F5F1E8; padding:32px; color:#0A0A0B;">
  <div style="max-width:520px; margin:0 auto; background:#FFFFFF; border-radius:16px; padding:32px;">
    <div style="font-family: 'Geist Mono', monospace; font-size:11px; text-transform:uppercase; letter-spacing:0.14em; color:#6B5BFF;">Mashal · Ticket update</div>
    <h1 style="font-size:22px; margin:12px 0 6px;">${headline}</h1>
    <p style="font-size:13.5px; color:#5C5A53; margin:0 0 16px;">On your ${ticket.type}: <strong>${safeSubject}</strong></p>
    ${safeNote ? `<div style="font-size:14px; line-height:1.55; padding:14px; background:#F5F1E8; border-radius:10px; margin:0 0 18px;">${safeNote}</div>` : ''}
    <p style="font-size:12px; color:#8E8B84;">You can view this ticket and submit more from Settings → Suggestions inside Mashal.</p>
  </div>
</body></html>`;
}

function ticketStatusEmailText({ status, ticket, note }) {
  const headline = STATUS_HEADLINE[status] || `Your ticket is now ${status}.`;
  return `${headline}

On your ${ticket.type}: ${ticket.subject}

${note ? `${note}\n\n` : ''}You can view this ticket from Settings → Suggestions inside Mashal.`;
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
