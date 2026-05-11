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

// Count usage_log entries this month for the workspace.
export async function getMonthlyUsage(workspaceId) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  const params = new URLSearchParams({
    select: 'id,cost_cents,status',
    workspace_id: `eq.${workspaceId}`,
    created_at: `gte.${start.toISOString()}`,
  });
  const rows = await supabase.select('usage_log', {
    select: 'id,cost_cents,status',
    eq: { workspace_id: workspaceId },
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
