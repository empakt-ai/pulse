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
// Previously this built a URLSearchParams locally and never passed it to
// supabase.select — so it actually counted lifetime usage, which is why
// the dashboard counter looked "static". Now uses the proper gte filter
// on created_at against the start of the current UTC month.
export async function getMonthlyUsage(workspaceId) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  const rows = await supabase.select('usage_log', {
    select: 'id,cost_cents,status,created_at',
    eq:  { workspace_id: workspaceId },
    gte: { created_at: start.toISOString() },
  }).catch(() => []);
  const used = (rows || []).filter(r => r.status !== 'failed').length;
  const cost_cents = (rows || []).reduce((s, r) => s + (r.cost_cents || 0), 0);
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
