// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Ad Intelligence module.
//
// Self-contained backend module. Owns benchmark lookup, spot-score math,
// the recommendation rule engine, and the brief-time builder that joins
// these onto the per-platform ad summary already computed in brief.js.
//
// brief.js calls one function — buildAdsIntel() — and attaches the result
// to its response payload. Nothing else in the codebase needs to know
// how spot scores or benchmarks work.
//
// Removing this module is a 3-line diff in brief.js + js/core/data.js.
// ═════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase.js';

// Each platform has a dominant placement we benchmark against when the
// caller doesn't specify a format. Keys match `per_platform[i].platform`
// in brief.js — the short keys produced by platformKey() (ig, fb, tt, x,
// li, google). The user's per_platform row aggregates across all an
// account's formats, so matching against the primary placement keeps
// the comparison meaningful and deterministic.
const PRIMARY_FORMAT = {
  ig:     'feed',
  fb:     'feed',
  tt:     'in_feed',
  x:      'promoted',
  google: 'search',
  li:     'feed',
};

// ── Benchmark lookup ─────────────────────────────────────────────────────
// Priority: network rollups (real cross-advertiser data) over seeded
// floor. Both live in ad_benchmarks; the source column flags which is
// which. Returns null if neither tier is present for the dimensions.
export async function getBenchmark({ category, region, platform, format = null, weeksBack = 12 }) {
  if (!category || !region || !platform) return null;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeksBack * 7);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const fmt = format || PRIMARY_FORMAT[platform] || null;

  // Network tier: average the most recent weeks across all network sources.
  // Network writes from brief.js currently set format=NULL, so this branch
  // ignores `fmt` and only filters on (platform, category, region).
  const networkRows = await supabase.select('ad_benchmarks', {
    select: 'avg_ctr,avg_cpm,avg_cpa,avg_roas,p25_ctr,p75_ctr,sample_size,source',
    eq: { platform, category, region },
    in: { source: ['network', 'apify_meta', 'apify_tiktok', 'apify_google'] },
    gte: { week_start: cutoffStr },
    order: 'week_start.desc',
    limit: 12,
  }).catch(() => []);

  if (networkRows && networkRows.length >= 3) {
    const n = networkRows.length;
    const sum = (k) => networkRows.reduce((s, r) => s + Number(r[k] || 0), 0);
    return {
      avg_ctr:     round4(sum('avg_ctr') / n),
      avg_cpm:     round2(sum('avg_cpm') / n),
      p25_ctr:     round4(sum('p25_ctr') / n),
      p75_ctr:     round4(sum('p75_ctr') / n),
      sample_size: networkRows.reduce((s, r) => s + Number(r.sample_size || 1), 0),
      source:      'network',
    };
  }

  // Seeded floor — single most recent row for the primary format.
  if (!fmt) return null;
  const seeded = await supabase.select('ad_benchmarks', {
    select: 'avg_ctr,avg_cpm,avg_cpa,avg_roas,p25_ctr,p75_ctr,sample_size',
    eq: { platform, category, region, source: 'seeded', format: fmt },
    order: 'week_start.desc',
    limit: 1,
    single: true,
  }).catch(() => null);
  if (seeded) return { ...seeded, source: 'seeded' };
  return null;
}

// ── Spot score (0–100) ───────────────────────────────────────────────────
// Where the brand's CTR falls on the category/region/platform distribution.
// 100 = at or above p75; 50 = at avg; 0 = at or below p25. Linear in
// between — good enough for a single dial; the underlying numbers are
// noisy enough that nonlinear smoothing would be false precision.
export function computeSpotScore(brandMetrics, benchmark) {
  if (!benchmark || !brandMetrics) return null;
  const ctr = Number(brandMetrics.ctr);
  if (!Number.isFinite(ctr)) return null;
  const avg = Number(benchmark.avg_ctr);
  if (!avg) return null;

  const p75 = Number(benchmark.p75_ctr) || avg * 1.3;
  const p25 = Number(benchmark.p25_ctr) || avg * 0.7;

  if (ctr >= p75) return 100;
  if (ctr <= p25) return 0;
  if (ctr >= avg) return Math.round(50 + ((ctr - avg) / Math.max(p75 - avg, 0.0001)) * 50);
  return Math.round(((ctr - p25) / Math.max(avg - p25, 0.0001)) * 50);
}

// ── Recommendation rule engine ───────────────────────────────────────────
// Pure function — no I/O. Takes the joined platform_intel list and the
// workspace's goal/category, returns up to 5 ranked recommendations.
export function buildRecommendations({ goal, category, region, currentSpend = [], platformIntel = [] }) {
  const recs = [];
  const active = new Set(currentSpend.map(r => r.platform));
  const totalSpend = currentSpend.reduce((s, r) => s + Number(r.spend || 0), 0);

  for (const p of platformIntel) {
    if (!p.benchmark || p.spot_score === null) continue;

    if (p.spot_score < 40) {
      const gap = p.benchmark.avg_ctr
        ? Math.round(((p.benchmark.avg_ctr - p.ctr) / p.benchmark.avg_ctr) * 100)
        : null;
      recs.push({
        platform: p.platform,
        format: null,
        reason: gap
          ? `CTR ${p.ctr}% is ${gap}% below the ${category} benchmark of ${p.benchmark.avg_ctr}%. Review creative or audience targeting.`
          : `Spot score ${p.spot_score}/100 — bottom quartile for your category. Review creative or audience.`,
        priority: p.spot_score < 20 ? 'high' : 'medium',
      });
    }

    if (p.spot_score > 80) {
      const share = totalSpend > 0 ? Math.round((Number(p.spend || 0) / totalSpend) * 100) : 0;
      if (share < 30) {
        recs.push({
          platform: p.platform,
          format: null,
          reason: `Spot score ${p.spot_score}/100 — top tier for your category. Currently only ${share}% of spend. Consider increasing allocation.`,
          priority: 'high',
        });
      }
    }
  }

  if (goal === 'leads' || goal === 'sales') {
    if (!active.has('tt')) {
      recs.push({
        platform: 'tt',
        format: 'in_feed',
        reason: `TikTok is absent from your mix. For ${category} brands focused on ${goal}, TikTok In-Feed typically delivers competitive CPAs. Test with a small budget.`,
        priority: 'medium',
        locked: false,
      });
    }
    if (!active.has('google')) {
      recs.push({
        platform: 'google',
        format: 'search',
        reason: `Google Search (high-intent channel) not connected yet. For ${goal}-focused campaigns, Search typically outperforms social on CPA. Unlocks when you connect Google Ads.`,
        priority: 'medium',
        locked: true,
        lockReason: 'Connect Google Ads in Settings to unlock',
      });
    }
  }

  if (goal === 'awareness' && (active.has('ig') || active.has('fb'))) {
    recs.push({
      platform: 'ig',
      format: 'reels',
      reason: `Meta Reels CPMs are typically 15–25% lower than Feed for ${category} awareness campaigns. If you're only running Feed placements, add Reels to your ad sets.`,
      priority: 'medium',
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return recs
    .sort((a, b) => (order[a.priority] - order[b.priority]) || ((a.locked ? 1 : 0) - (b.locked ? 1 : 0)))
    .slice(0, 5);
}

// ── Builder: brief.js calls this with the per-platform summary already
// computed and the workspace row. Returns the ads_intel payload + the
// adSettings used (or null), or null if no data / no settings.
export async function buildAdsIntel({ workspace, adsAllowed, adsCount, perPlatform }) {
  if (!adsAllowed || !adsCount || !perPlatform?.length) {
    return { intel: null, adSettings: null };
  }

  const adSettings = await supabase.select('workspace_ad_settings', {
    select: 'goal,category,regions,network_opt_in',
    eq: { workspace_id: workspace.id },
    single: true,
  }).catch(() => null);

  if (!adSettings?.category) {
    return { intel: null, adSettings: adSettings || null };
  }

  const region = adSettings.regions?.[0] || workspace.focus_regions?.[0] || 'global';

  // Look up each platform's benchmark in parallel — getBenchmark hits the
  // DB once per platform, so 4 connected platforms = 4 lookups. The whole
  // block is wrapped in try/catch by brief.js so a slow DB never breaks
  // the dashboard fetch.
  const platformIntel = await Promise.all(
    perPlatform.map(async (row) => {
      const benchmark = await getBenchmark({
        category: adSettings.category,
        region,
        platform: row.platform,
      });
      const spot_score = benchmark ? computeSpotScore({ ctr: row.ctr }, benchmark) : null;
      return { ...row, benchmark, spot_score };
    })
  );

  const recommendations = buildRecommendations({
    goal:         adSettings.goal,
    category:     adSettings.category,
    region,
    currentSpend: perPlatform,
    platformIntel,
  });

  const intel = {
    platform_intel: platformIntel,
    recommendations,
    goal:         adSettings.goal,
    category:     adSettings.category,
    region,
    data_quality: platformIntel.some(p => p.benchmark?.source === 'network') ? 'network' : 'seeded',
  };

  // Anonymised contribution to the network pool. Workspace identity is
  // never written; the row contributes only platform/category/region +
  // weekly CTR/CPM. Failures are non-fatal — the brief still returns.
  if (adSettings.network_opt_in) {
    const weekStart = getMondayOfCurrentWeek();
    const writes = perPlatform
      .filter(r => r.impressions > 0)
      .map(r => ({
        platform:    r.platform,
        format:      null,
        category:    adSettings.category,
        region,
        week_start:  weekStart,
        sample_size: 1,
        avg_ctr:     r.ctr,
        avg_cpm:     r.impressions > 0
          ? Math.round((r.spend / r.impressions) * 1000 * 100) / 100
          : null,
        source: 'network',
      }));
    if (writes.length) {
      await supabase.upsert('ad_benchmarks', writes, {
        onConflict: 'platform,category,region,week_start,source',
      }).catch(e => console.warn('[ads-intel] benchmark write failed (non-fatal):', e.message));
    }
  }

  return { intel, adSettings };
}

// ── Prompt builder ───────────────────────────────────────────────────────
// Returns a short string the intelligence generator can append to its
// prompt to make briefs reference ad spot scores + recommendations.
// Not wired into the prompt today — exported so the intel pipeline can
// adopt it without further changes to this module.
export function buildAdsIntelPrompt(intel) {
  if (!intel?.platform_intel?.length) return '';
  const lines = [];
  lines.push(`AD INTELLIGENCE (${intel.category} / ${intel.region} / goal: ${intel.goal || 'not set'}):`);
  for (const p of intel.platform_intel) {
    const bm = p.benchmark?.avg_ctr ?? 'n/a';
    const score = p.spot_score ?? 'n/a';
    lines.push(`- ${p.platform.toUpperCase()}: CTR ${p.ctr}% (benchmark ${bm}%, spot score ${score}/100)`);
  }
  if (intel.recommendations?.length) {
    lines.push('');
    lines.push('TOP AD RECOMMENDATIONS:');
    intel.recommendations.slice(0, 3).forEach((r, i) => {
      const fmt = r.format ? ' ' + r.format : '';
      lines.push(`${i + 1}. [${r.platform}${fmt}] ${r.reason}`);
    });
    lines.push('Reference ad intelligence in the brief verdict and actions where relevant.');
  }
  return lines.join('\n');
}

// ── Helpers ──────────────────────────────────────────────────────────────
export function getMondayOfCurrentWeek() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }
