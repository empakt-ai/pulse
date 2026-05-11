// Intelligence generator — turns 30 days of workspace data into a daily AI brief:
//   - 1 verdict (the dark hero card on Brief)
//   - 3 prioritized actions
//   - 4-8 cross-platform signals
//   - Intelligence score /100 (deterministic formula, LLM annotates factors)
//
// Output is written to the `signals` table (kinds: 'verdict', 'action', plus the
// standard 'viral'/'gap'/'collab'/'engagement'/'warning'/'timing'/'trend'). The
// /api/brief endpoint segregates by kind on read.

import { supabase } from './supabase.js';
import { messages, parseJsonResponse, estimateCostCents } from './anthropic.js';

const MODEL = 'claude-sonnet-4-6';

// ── Deterministic intel score (don't trust the LLM for math) ───────────────────
// Inputs: per-platform avg engagement vs category baselines, growth velocity,
// content cadence. Output 0-100.
function computeIntelScore({ accounts, posts, snapshots }) {
  if (!accounts?.length || !posts?.length) return null;

  // 1) Engagement-rate quality (40 points)
  // Benchmark: 6% eng rate is "excellent" for most platforms → cap at 12%
  const ownPosts = posts.filter(p => p.source === 'own');
  if (!ownPosts.length) return null;
  const avgEng = ownPosts.reduce((s, p) => s + (p.engagement_rate || 0), 0) / ownPosts.length;
  const engScore = Math.min(40, (avgEng / 12) * 40);

  // 2) Content cadence (20 points): posts in last 30 days, capped at 30 posts
  const recentPosts = ownPosts.filter(p => {
    if (!p.posted_at) return false;
    return (Date.now() - new Date(p.posted_at).getTime()) < 30 * 86400000;
  });
  const cadenceScore = Math.min(20, (recentPosts.length / 30) * 20);

  // 3) Platform coverage (15 points): 5 active platforms = full marks
  const activePlatforms = new Set(ownPosts.map(p => p.platform));
  const coverageScore = Math.min(15, activePlatforms.size * 3);

  // 4) Growth velocity (15 points): viral/rising posts in last 30d
  const viralCount = recentPosts.filter(p => p.signal === 'viral').length;
  const risingCount = recentPosts.filter(p => p.signal === 'rising').length;
  const velocityScore = Math.min(15, viralCount * 5 + risingCount * 2);

  // 5) Follower scale (10 points): log10 of total followers
  const totalFollowers = accounts.reduce((s, a) => s + (a.followers || 0), 0);
  const scaleScore = Math.min(10, Math.log10(Math.max(1, totalFollowers)) * 2);

  return Math.round(engScore + cadenceScore + coverageScore + velocityScore + scaleScore);
}

// ── Aggregate the workspace into a compact prompt payload ─────────────────────
function buildPayload({ workspace, accounts, posts, snapshots, competitors }) {
  const ownPosts = posts.filter(p => p.source === 'own');
  const byPlatform = {};

  for (const a of accounts) {
    const plPosts = ownPosts.filter(p => p.platform === a.platform);
    const avgEng = plPosts.length
      ? plPosts.reduce((s, p) => s + (p.engagement_rate || 0), 0) / plPosts.length
      : 0;
    const totalViews = plPosts.reduce((s, p) => s + (p.views || 0), 0);
    byPlatform[a.platform] = {
      handle: a.platform_username,
      followers: a.followers || 0,
      posts_30d: plPosts.length,
      total_views_30d: totalViews,
      avg_engagement_rate: Math.round(avgEng * 100) / 100,
      viral_count_30d: plPosts.filter(p => p.signal === 'viral').length,
      rising_count_30d: plPosts.filter(p => p.signal === 'rising').length,
    };
  }

  // Top 10 posts by views, trimmed down
  const topPosts = [...ownPosts]
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, 10)
    .map(p => ({
      platform: p.platform,
      caption: (p.caption || '').slice(0, 120),
      posted_at: p.posted_at,
      views: p.views, likes: p.likes, comments: p.comments,
      saves: p.saves, shares: p.shares,
      engagement_rate: p.engagement_rate,
      signal: p.signal,
    }));

  return {
    workspace: {
      user_type: workspace.user_type,
      category: workspace.category,
      market: workspace.market,
      account_age: workspace.account_age,
      tier: workspace.tier,
    },
    platforms: byPlatform,
    top_posts: topPosts,
    competitors: (competitors || []).slice(0, 10).map(c => ({
      platform: c.platform, handle: c.handle, followers: c.followers || 0,
    })),
  };
}

// ── System prompt — cacheable (1hr extended cache TTL would help if cron batches) ──
const SYSTEM_PROMPT = `You are PULSE, the AI brain inside a social-media intelligence platform for serious creators, brands, and agencies. Your job is to read a workspace's last 30 days of data and write a sharp morning brief that tells them exactly what to do today.

Voice rules:
- Direct, specific, and confident. No hedging, no marketing fluff.
- Use the creator's actual numbers and post titles. Don't invent details.
- If data is thin (few posts, low followers), say so honestly and recommend foundation work — don't fake insights.
- Reference platforms by real name (Instagram, TikTok, YouTube, etc.) — not by code (ig/tt/yt).

Output STRICT JSON only. No prose outside the JSON. Schema:

{
  "verdict": {
    "title": "string, 6-14 words, the headline insight for today",
    "body": "string, 1-2 sentences explaining the why and the leverage"
  },
  "actions": [
    {
      "when": "Now" | "Today" | "This week",
      "icon": "flame" | "clock" | "sparkle" | "trending" | "users" | "message" | "play" | "mail",
      "title": "string, 3-7 words, the action to take",
      "body": "string, 1 sentence on why this action and what the impact is",
      "cta": "string, 2-4 words ending with arrow — e.g. 'Open comments →'"
    }
    // exactly 3 actions, ordered by urgency
  ],
  "signals": [
    {
      "kind": "viral" | "gap" | "collab" | "engagement" | "warning" | "timing" | "trend",
      "platform": "instagram" | "tiktok" | "youtube" | "facebook" | "linkedin" | "x" | "snapchat" | "all",
      "title": "string, the signal headline",
      "body": "string, 1-2 sentences with specific numbers from the data",
      "impact": "High Impact" | "Strategic" | "Core Identity" | "Strategic Warning",
      "action": "string, 2-4 words, the suggested next step"
    }
    // 4-8 signals, varied across kinds and platforms when possible
  ],
  "score_factors": [
    "string, ≤12 words — what's pushing the intel score up or down"
    // 2-4 factors
  ]
}`;

function buildUserMessage(payload) {
  return `Generate today's PULSE brief for this workspace.\n\nDATA:\n${JSON.stringify(payload, null, 2)}\n\nReturn the JSON only.`;
}

// ── Persist generated brief into signals table ─────────────────────────────────
async function persist({ workspace, brief, intelScore, usage, model }) {
  // Soft-delete prior brief rows so the screen reads the latest
  await supabase.update('signals', { is_read: true },
    { eq: { workspace_id: workspace.id } }
  ).catch(() => {});

  const rows = [];
  const now = new Date().toISOString();
  const baseMeta = { generated_at: now, model, intel_score: intelScore };

  // Verdict
  rows.push({
    workspace_id: workspace.id,
    kind: 'verdict',
    platform: 'all',
    title: brief.verdict?.title || 'Brief generated',
    body: brief.verdict?.body || '',
    impact: 'High Impact',
    action: 'Read brief',
    metadata: { ...baseMeta, score_factors: brief.score_factors || [] },
  });

  // Actions
  (brief.actions || []).slice(0, 3).forEach((a, i) => {
    rows.push({
      workspace_id: workspace.id,
      kind: 'action',
      platform: 'all',
      title: a.title || `Action ${i + 1}`,
      body: a.body || '',
      impact: a.when || 'Today',
      action: a.cta || 'Open →',
      metadata: { ...baseMeta, when: a.when, icon: a.icon, order: i },
    });
  });

  // Signals
  (brief.signals || []).slice(0, 8).forEach(s => {
    rows.push({
      workspace_id: workspace.id,
      kind: s.kind || 'engagement',
      platform: s.platform || 'all',
      title: s.title || 'Signal',
      body: s.body || '',
      impact: s.impact || 'Strategic',
      action: s.action || 'Review',
      metadata: baseMeta,
    });
  });

  if (rows.length) {
    await supabase.insert('signals', rows).catch(e => {
      console.error('[intelligence] failed to insert signals:', e.message);
    });
  }
}

// ── Main entrypoint ────────────────────────────────────────────────────────────
export async function generateBrief(workspace) {
  // 1) Gather data
  const [accounts, posts, snapshots, competitors] = await Promise.all([
    supabase.select('connected_accounts', { select: '*', eq: { workspace_id: workspace.id } }).catch(() => []),
    supabase.select('posts', { select: '*', eq: { workspace_id: workspace.id }, order: 'posted_at.desc', limit: 200 }).catch(() => []),
    supabase.select('account_snapshots', { select: '*', eq: { workspace_id: workspace.id }, order: 'snapshot_date.desc', limit: 30 }).catch(() => []),
    supabase.select('competitors', { select: '*', eq: { workspace_id: workspace.id } }).catch(() => []),
  ]);

  if (!accounts?.length || !posts?.length) {
    return { skipped: 'insufficient_data', accounts: accounts?.length || 0, posts: posts?.length || 0 };
  }

  // 2) Deterministic intel score
  const intelScore = computeIntelScore({ accounts, posts, snapshots });

  // 3) Build prompt
  const payload = buildPayload({ workspace, accounts, posts, snapshots, competitors });

  // 4) Call Claude
  const result = await messages({
    model: MODEL,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildUserMessage(payload) }],
    max_tokens: 2048,
    temperature: 0.6,
  });

  const brief = parseJsonResponse(result.text);
  if (!brief) {
    return { error: 'LLM returned unparseable output', raw: result.text?.slice(0, 500) };
  }

  // 5) Persist
  await persist({ workspace, brief, intelScore, usage: result.usage, model: result.model });

  const costCents = estimateCostCents(result.usage, result.model);

  // 6) Log usage
  await supabase.insert('usage_log', {
    workspace_id: workspace.id,
    run_type: 'intelligence',
    platform: 'all',
    records_fetched: (brief.signals?.length || 0) + (brief.actions?.length || 0) + 1,
    cost_cents: costCents,
    status: 'completed',
  }).catch(() => {});

  return {
    ok: true,
    intelScore,
    verdict: brief.verdict?.title,
    actions: brief.actions?.length || 0,
    signals: brief.signals?.length || 0,
    usage: result.usage,
    cost_cents: costCents,
  };
}
