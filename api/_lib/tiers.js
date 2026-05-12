// ═════════════════════════════════════════════════════════════════════════
// [PULSE-SPECIFIC] Stays in this repo. PULSE's commercial model (Creator /
// Brand / Agency tiers, USD/SAR pricing, per-tier caps on accounts, comp-
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
    price_sar: 115,
    platforms: 7,
    accounts_per_platform: 1,
    competitors: 5,
    runs_per_month: 30,
  },
  brand: {
    label: 'Brand',
    price_usd: 149,
    price_sar: 560,
    platforms: 7,
    accounts_total: 21,
    competitors: 15,
    runs_per_month: 120,
  },
  agency: {
    label: 'Agency',
    price_usd: 599,
    price_sar: 2250,
    platforms: 7,
    accounts_total: -1, // unlimited
    competitors: 50,
    runs_per_month: 600,
  },
};

export function tierFor(workspace) {
  return TIERS[workspace?.tier] || TIERS.creator;
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
  const tier = tierFor(workspace);
  const rows = await supabase.select('competitors', {
    select: 'id',
    eq: { workspace_id: workspace.id },
  }).catch(() => []);
  const used = (rows || []).length;
  return { used, limit: tier.competitors, exceeded: used >= tier.competitors };
}
