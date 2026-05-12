// ═════════════════════════════════════════════════════════════════════════
// [PULSE-SPECIFIC] Stays in this repo. PULSE's commercial model (Creator /
// Brand / Agency tiers, USD pricing, per-tier caps on accounts, comp-
// etitors and AI runs) is a product decision, not a platform primitive.
// Content Studio will have its own pricing/quota module.
// ═════════════════════════════════════════════════════════════════════════
//
// Pricing tier limits + usage cap enforcement.

import { supabase } from './supabase.js';

export const TIERS = {
  creator: {
    label: 'Creator',
    price_usd: 29,
    platforms: 7,
    accounts_per_platform: 1,
    competitors: 5,
    runs_per_month: 30,
  },
  brand: {
    label: 'Brand',
    price_usd: 149,
    platforms: 7,
    accounts_total: 21,
    competitors: 15,
    runs_per_month: 120,
  },
  agency: {
    label: 'Agency',
    price_usd: 599,
    platforms: 7,
    accounts_total: -1, // unlimited
    competitors: 50,
    runs_per_month: 600,
  },
};

export function tierFor(workspace) {
  return TIERS[workspace?.tier] || TIERS.creator;
}

// Trial caps — applied while workspace.trial_active is true regardless of
// the workspace's tier (which is just the user's *intent* during trial).
// Numbers come from the trial spec: 1 workspace / 2 own accounts /
// 2 competitors / 10-post historic backfill / scrape-only sync.
export const TRIAL_LIMITS = {
  workspaces:        1,
  accounts_total:    2,
  competitors:       2,
  backfill_posts:    10,
  // Brief generation count cap during trial — generous but bounded so a
  // misuser can't burn unlimited Gemini quota in 7 days.
  runs_per_month:    20,
};

// Resolve "what cap applies right now" for a workspace. During an
// active trial all numeric caps clamp to TRIAL_LIMITS; otherwise the
// tier's own values apply. Locked-trial workspaces return zero
// everywhere — endpoints should refuse outright in that state.
export function effectiveLimits(workspace) {
  if (workspace?.trial_locked) {
    return { workspaces: 0, accounts_total: 0, competitors: 0, runs_per_month: 0, source: 'trial_locked' };
  }
  if (workspace?.trial_active) {
    return {
      workspaces:     TRIAL_LIMITS.workspaces,
      accounts_total: TRIAL_LIMITS.accounts_total,
      competitors:    TRIAL_LIMITS.competitors,
      runs_per_month: TRIAL_LIMITS.runs_per_month,
      backfill_posts: TRIAL_LIMITS.backfill_posts,
      source: 'trial',
    };
  }
  const t = tierFor(workspace);
  return {
    workspaces:     null,                                   // not currently capped per tier
    accounts_total: t.accounts_total ?? (t.accounts_per_platform ? t.accounts_per_platform * t.platforms : null),
    competitors:    t.competitors,
    runs_per_month: t.runs_per_month,
    backfill_posts: 100,
    source: 'tier',
  };
}

// Count usage_log entries this calendar month for the workspace.
// usage_log pre-dates our migration history, so we don't assume the
// timestamp column is named `created_at`. Pull every row for the
// workspace, then filter in JS against whichever timestamp-looking
// field exists — robust to schemas that use logged_at / run_at / etc.
// Only 'intelligence' rows count toward the brief quota; competitor
// scrapes and other run types are tracked separately.
export async function getMonthlyUsage(workspaceId) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const startMs = start.getTime();

  const rows = await supabase.select('usage_log', {
    select: '*',
    eq:  { workspace_id: workspaceId },
    order: 'id.desc',
    limit: 1000,
  }).catch(() => []);

  const pickTs = (r) => {
    const v = r.created_at || r.logged_at || r.run_at || r.inserted_at || r.timestamp;
    if (!v) return 0;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  };

  const inMonth = (rows || []).filter(r => {
    if (r.status === 'failed') return false;
    // Only count brief generations against the monthly quota — competitor
    // scrapes and other runs are operationally interesting but don't
    // affect the displayed counter.
    if (r.run_type && r.run_type !== 'intelligence') return false;
    const ts = pickTs(r);
    return ts === 0 ? false : ts >= startMs;
  });

  const used = inMonth.length;
  const cost_cents = inMonth.reduce((s, r) => s + (r.cost_cents || 0), 0);
  return { used, cost_cents };
}

export async function checkUsageCap(workspace) {
  const tier = tierFor(workspace);
  const limit = tier.runs_per_month;
  const { used } = await getMonthlyUsage(workspace.id);
  return {
    used,
    limit,
    exceeded: limit !== -1 && used >= limit,
  };
}

export async function checkCompetitorCap(workspace) {
  const limits = effectiveLimits(workspace);
  const rows = await supabase.select('competitors', {
    select: 'id',
    eq: { workspace_id: workspace.id },
  }).catch(() => []);
  const used = (rows || []).length;
  return { used, limit: limits.competitors, exceeded: used >= limits.competitors, source: limits.source };
}

// Same shape as checkCompetitorCap, for own connected_accounts.
export async function checkAccountCap(workspace) {
  const limits = effectiveLimits(workspace);
  const rows = await supabase.select('connected_accounts', {
    select: 'id',
    eq: { workspace_id: workspace.id, is_active: true },
  }).catch(() => []);
  const used = (rows || []).length;
  const limit = limits.accounts_total; // null = no cap
  return {
    used,
    limit,
    exceeded: limit !== null && limit !== -1 && used >= limit,
    source: limits.source,
  };
}
