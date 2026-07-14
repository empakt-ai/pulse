// ═════════════════════════════════════════════════════════════════════════
// [MIXED] Mostly SHARED — workspace CRUD is a generic multi-tenant primitive
// — but the GET response embeds Mashal-specific tier + usage data.
//
//   SHARED (move to platform service):
//     • GET list of workspaces a user owns
//     • POST create workspace
//     • PATCH workspace fields (name, user_type, category, country,
//       focus_regions, account_age)
//
//   Mashal-SPECIFIC (stays here, or becomes a sibling endpoint):
//     • tier metadata in GET response (label, price, runs_per_month cap)
//     • usage block (monthly run count vs cap)
//
// Proposed split: shared service exposes /workspaces with the raw row data;
// Mashal adds a /pulse/workspace-context endpoint that joins tier + usage.
// ═════════════════════════════════════════════════════════════════════════
//
// Workspaces endpoint. A user may own multiple workspaces — each one is
// effectively a separate subscription (separate account slots, competitor
// quota, AI run quota). The active workspace for any request is selected via
// the `x-workspace-id` header (see api/_lib/auth.js).
//
//   GET    /api/workspaces            → returns the active workspace + the
//                                       full owned list + tier + usage
//   POST   /api/workspaces  { name }  → create a new workspace
//   PATCH  /api/workspaces  { ... }   → update the active workspace's settings

import { authenticate, json, trialLockoutEnvelope } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';
import { tierFor, getMonthlyUsage } from './_lib/tiers.js';
import { recordReferralAttribution } from './_lib/referral.js';
import { assertRole } from './_lib/permissions.js';

// Insert the owner's workspace_members row right after a workspace is
// created so the auth layer (which routes access through workspace_members
// — migration 024) immediately recognises it. ON CONFLICT DO NOTHING in
// case the migration backfill or another path got there first.
async function ensureOwnerMembership(workspace, ownerId) {
  if (!workspace?.id || !ownerId) return;
  try {
    await supabase.upsert('workspace_members', {
      user_id:      ownerId,
      workspace_id: workspace.id,
      role:         'owner',
      accepted_at:  workspace.created_at || new Date().toISOString(),
    }, { onConflict: 'user_id,workspace_id' });
  } catch (e) {
    console.warn('[workspaces] ensureOwnerMembership failed (non-fatal):', e.message);
  }
}

// Tier is intentionally NOT in this list — a client PATCH could otherwise
// upgrade itself from Creator to Agency for free. tier changes happen
// server-side only, via the conversion endpoint once payment lands.
const ALLOWED_FIELDS = ['name', 'user_type', 'category', 'market', 'account_age', 'country', 'focus_regions', 'timezone', 'weekly_digest_enabled', 'digest_email', 'brief_tone', 'brief_language', 'featured_on_homepage', 'trial_intent_tier', 'trial_promo_code'];

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });

  let workspace = auth.workspace;
  // Auto-create on first hit if no workspaces exist yet (defensive — the
  // Supabase signup trigger should have done this already).
  if (!workspace && (!auth.workspaces || !auth.workspaces.length)) {
    const now = new Date();
    const inserted = await supabase.insert('workspaces', {
      owner_id: auth.user.id,
      name: auth.user.email?.split('@')[0] || 'My Workspace',
      tier: 'creator',
      ai_model: 'gemini',
      trial_started_at: now.toISOString(),
      trial_ends_at: new Date(now.getTime() + 7 * 86400000).toISOString(),
      trial_intent_tier: 'creator',
    });
    workspace = inserted?.[0] || null;
    if (!workspace) return json(res, 500, { error: 'Workspace not found and could not be created' });
    await ensureOwnerMembership(workspace, auth.user.id);
  }

  // ── GET: full active context ──────────────────────────────────────────
  if (req.method === 'GET') {
    // Hard-block the read for a locked trial / lapsed subscription — the same
    // 402 the mutating routes return. Defense in depth: the SPA's paywall
    // already replaces the whole app UI when locked (so Settings isn't
    // reachable), but a raw API caller must not pull workspace/tier/usage
    // data after lockout.
    const lock = trialLockoutEnvelope(workspace);
    if (lock) return json(res, lock.status, lock.body);

    const tier = tierFor(workspace);
    const usage = await getMonthlyUsage(workspace.id).catch(() => ({ used: 0, cost_cents: 0 }));
    // SECURITY (audit, May 2026): owners see the full row; everyone else
    // sees a billing-stripped projection. Same logic as /api/brief.
    const stripBilling = (w) => {
      if (!w) return w;
      const {
        stripe_customer_id, stripe_subscription_id, stripe_subscription_status,
        stripe_price_id, stripe_current_period_end, stripe_cancel_at_period_end,
        stripe_last_invoice_status, stripe_last_event_at, trial_promo_code,
        ...rest
      } = w;
      return rest;
    };
    const isOwner = auth.role === 'owner';
    return json(res, 200, {
      workspace: isOwner ? workspace : stripBilling(workspace),
      workspaces: isOwner
        ? (auth.workspaces || [workspace])
        : (auth.workspaces || [workspace]).map(stripBilling),
      tier: { ...tier, key: workspace.tier || 'creator' },
      usage: { used: usage.used, limit: tier.runs_per_month, cost_cents: usage.cost_cents },
    });
  }

  // ── POST: create new workspace ────────────────────────────────────────
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const name = (body?.name || '').trim();
    if (!name) return json(res, 400, { error: 'name is required' });

    // Trial users get exactly one workspace. Any of the user's other
    // workspaces being on an active trial is enough to refuse — the
    // intent is to prevent fan-out before upgrading.
    const userWorkspaces = auth.workspaces || [];
    const onTrial = userWorkspaces.some(w => w.trial_active && !w.trial_converted_at);
    if (onTrial) {
      return json(res, 402, {
        error: 'Additional workspaces unlock after you upgrade from the trial.',
        trial: true,
      });
    }

    // Every new workspace enters a 7-day trial. tier here is the user's
    // *intent* — what they plan to upgrade to. We persist it in both
    // tier (so all existing tier-checks work) and trial_intent_tier (so
    // we know what the trial was anchored to even if the user toggles
    // tier later).
    const intentTier = body?.tier || 'creator';
    const now = new Date();
    const endsAt = new Date(now.getTime() + 7 * 86400000);
    try {
      const inserted = await supabase.insert('workspaces', {
        owner_id: auth.user.id,
        name,
        tier: intentTier,
        user_type: body?.user_type || 'creator',
        category: body?.category || null,
        country: body?.country || null,
        ai_model: body?.ai_model || 'gemini',
        trial_started_at: now.toISOString(),
        trial_ends_at: endsAt.toISOString(),
        trial_intent_tier: intentTier,
      });
      const created = inserted?.[0] || null;
      if (created) await ensureOwnerMembership(created, auth.user.id);
      return json(res, 200, { workspace: created });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  // ── PATCH: update settings for active workspace ───────────────────────
  if (req.method === 'PATCH') {
    // Settings edits are admin+. Members and viewers can't change
    // workspace-wide config (category, country, language, etc.).
    const denied = assertRole(auth, 'admin');
    if (denied) return json(res, denied.status, denied.body);

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const patch = {};
    for (const k of ALLOWED_FIELDS) if (k in (body || {})) patch[k] = body[k];
    if (!Object.keys(patch).length) return json(res, 400, { error: 'No valid fields to update' });

    // Validate the IANA timezone before persisting. A malformed value would be
    // accepted silently and then fall back to UTC inside the cron's localClock()
    // (api/cron/hourly.js) and brief.js localHour() — firing this customer's 6am
    // brief at the wrong local time with no error. Drop an invalid value rather
    // than fail the whole PATCH so the other fields still save. The browser
    // normally supplies a valid Intl resolvedOptions().timeZone; this guards
    // against tampering, stale clients, and bad backfills.
    if ('timezone' in patch) {
      const tz = patch.timezone;
      let valid = typeof tz === 'string' && tz.length > 0;
      if (valid) {
        try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); }
        catch { valid = false; }
      }
      if (!valid) {
        console.warn(`[workspaces] dropping invalid timezone ${JSON.stringify(tz)} for ws=${workspace.id}`);
        delete patch.timezone;
        if (!Object.keys(patch).length) return json(res, 400, { error: 'Invalid timezone' });
      }
    }

    // TIER GATES — Creator can't toggle features that the /pricing
    // comparison reserves for Pro Creator+. Strip these from the patch
    // silently and respond with the cleaned patch so the SPA can show
    // the locked state. Trial workspaces bypass this — they preview
    // the full feature set until conversion.
    const tier = String(workspace.tier || 'creator').toLowerCase();
    if (tier === 'creator' && !workspace.trial_active) {
      // Multilingual brief: force English on the persisted column too.
      if ('brief_language' in patch && patch.brief_language !== 'en') {
        delete patch.brief_language;
      }
      // Weekly digest email: Pro Creator+ only.
      if ('weekly_digest_enabled' in patch && patch.weekly_digest_enabled) {
        delete patch.weekly_digest_enabled;
      }
      // Brief tone presets: Agency only (pre-existing policy — Creator
      // gets 'encouraging' default in intelligence.js). Strip for safety.
      if ('brief_tone' in patch) {
        delete patch.brief_tone;
      }
    }

    // Mirror trial_intent_tier onto tier while the workspace is still on
    // an active trial. Tier is the user's *intent* during trial; the
    // actual feature caps come from trial_active clamping. We refuse to
    // touch tier once the trial converts — that's a paid-conversion
    // event handled server-side only.
    if ('trial_intent_tier' in patch && workspace.trial_active && !workspace.trial_converted_at) {
      const allowed = new Set(['creator', 'pro_creator', 'brand', 'agency']);
      if (allowed.has(patch.trial_intent_tier)) {
        patch.tier = patch.trial_intent_tier;
      }
    }
    // Normalise promo code: trim + uppercase so 'beta50' and 'BETA50'
    // collapse to the same record for analytics.
    if (patch.trial_promo_code != null) {
      patch.trial_promo_code = String(patch.trial_promo_code).trim().toUpperCase() || null;
    }

    try {
      const rows = await supabase.update('workspaces', patch, { eq: { id: workspace.id } });

      // Referral attribution — best-effort. If trial_promo_code was just
      // set and maps to a real referral_codes row, log a referrals entry
      // in 'pending' state. Self-referrals, non-referral promo codes, and
      // duplicate attributions are dropped silently by the helper.
      if (patch.trial_promo_code) {
        try {
          await recordReferralAttribution({
            refereeWorkspaceId: workspace.id,
            refereeUserId:      auth.user.id,
            code:               patch.trial_promo_code,
          });
        } catch (e) {
          console.warn('[workspaces] referral attribution failed (non-fatal):', e.message);
        }
      }

      return json(res, 200, { workspace: rows?.[0] || null });
    } catch (e) {
      // Schema fallback: strip newer columns and retry if their migration
      // hasn't been applied. 002 added country/focus_regions; 004 added
      // timezone.
      if (/country|focus_regions|timezone/.test(e.message)) {
        const { country, focus_regions, timezone, ...legacyPatch } = patch;
        if (Object.keys(legacyPatch).length) {
          const rows = await supabase.update('workspaces', legacyPatch, { eq: { id: workspace.id } });
          return json(res, 200, {
            workspace: rows?.[0] || null,
            warning: 'Some newer columns not yet supported — run pending migrations in Supabase.',
          });
        }
      }
      return json(res, 500, { error: e.message });
    }
  }

  // ── DELETE: remove a workspace owned by the caller ─────────────────────
  // Cascade-deletes all child rows (accounts, posts, signals, competitors,
  // reports, etc.) via the ON DELETE CASCADE foreign keys defined in the
  // original schema. Refuses to delete the user's last workspace — they
  // need at least one to keep the app functional.
  if (req.method === 'DELETE') {
    const targetId = req.query?.id;
    if (!targetId) return json(res, 400, { error: 'id is required' });

    // Delete is owner-only — billing holder is the only one who can
    // remove the workspace. assertRole reads auth.role for the active
    // workspace, so we re-resolve for the target instead.
    const targetMembership = await supabase.select('workspace_members', {
      select: 'role',
      eq: { user_id: auth.user.id, workspace_id: targetId },
      single: true,
    }).catch(() => null);
    if (targetMembership?.role !== 'owner') {
      return json(res, 403, { error: 'Only the workspace owner can delete a workspace.' });
    }

    // Belt-and-braces ownership check on the workspace row itself.
    const target = await supabase.select('workspaces', {
      select: 'id,owner_id,name',
      eq: { id: targetId, owner_id: auth.user.id },
      single: true,
    }).catch(() => null);
    if (!target) return json(res, 404, { error: 'Workspace not found or not yours' });

    // Refuse if this would leave the user with zero workspaces.
    const all = await supabase.select('workspaces', {
      select: 'id', eq: { owner_id: auth.user.id },
    }).catch(() => []);
    if ((all || []).length <= 1) {
      return json(res, 400, { error: 'Cannot delete your last workspace — create another one first.' });
    }

    try {
      await supabase.delete('workspaces', { eq: { id: targetId } });
      return json(res, 200, { ok: true, deleted: targetId });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  return json(res, 405, { error: 'Method not allowed' });
}
