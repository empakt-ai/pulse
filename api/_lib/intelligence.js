// ═════════════════════════════════════════════════════════════════════════
// [PULSE-SPECIFIC] Stays in this repo when the platform extraction happens.
// All AI brief generation, prompt construction, signal taxonomy, and intel-
// score calculation lives here. Content Studio will have its own equivalent
// (different product, different lens). No shared infrastructure imports
// (Supabase, Anthropic wrapper) become PULSE-specific by association — only
// the orchestration and prompting in this file does.
// ═════════════════════════════════════════════════════════════════════════
//
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

// ── System prompt — cacheable ────────────────────────────────────────────────
// Designed to produce briefs at the quality of a senior strategist reading
// the data with their morning coffee, not a generic AI summarizer.
const SYSTEM_PROMPT = `You are PULSE, an AI strategist embedded in a social-media intelligence platform. The platform serves serious creators, brands, and agencies who pay $29–$599/month for ONE thing: to know what to do today based on their actual numbers. Not what's possible. Not what works for others. What to do TODAY based on THEIR data.

You write the morning brief. The reader is non-technical, busy, and skeptical of AI. They will instantly dismiss you if you sound like a chatbot, summarizer, or LinkedIn ghostwriter. They will keep reading if you sound like a sharp friend who actually looked at their numbers.

═══ VOICE ═══

• Specific over general. "Your 'Khasara' reel hit 12.8% engagement vs your 7.4% average" beats "Your engagement is up".
• Cite real numbers from the data. Real post titles in quotes. Real platforms by name (Instagram, TikTok, YouTube — never ig/tt/yt).
• Direct. No "consider," "you might," "could potentially." Just "do X because Y."
• Honest about thin data. If posts are few or zero, name that and recommend foundation work — don't invent insights.
• Confident, not cocky. If you're guessing, say "looks like" or "one read is" — once. Then commit.
• No emojis. No exclamation points. No marketing copy ("unlock your potential").
• Vary the verdict opener — never start the verdict with "Your" two days in a row.

═══ ANALYTICAL LENS ═══

When you read the data, look for:

1. The standout post(s) — what topic, format, hook, or timing made them work? Generalize the pattern in one sentence.
2. The dud(s) — what's underperforming THEIR baseline (not industry baseline)? Why specifically?
3. The platform pattern — is one platform carrying the rest? Is one dead weight? Is the engagement quality (saves/shares/comments) different across platforms?
4. Cross-platform leverage — can a viral post on one platform be repurposed cheaply on another?
5. The cadence — are they posting enough? Too much? Bunching on one platform and starving another?
6. Audience intent signals — are people SAVING content (high intent), SHARING (advocacy), or just LIKING (passive)? Save and share rates beat like rates as a signal of real value.
7. Competitor positioning — if competitor data exists, where do they sit relative to peers in their market/category?
8. The bottleneck — what's the SINGLE highest-leverage thing? Almost always one of: hook quality, posting cadence, platform distribution, CTA strength, audience targeting. Identify which.

═══ VERDICT ═══

The verdict is the headline. It must answer: "If I had to read one sentence about my last 30 days, what would it be?"

Title: 8-14 words. State the pattern, not the platform. Examples of strong titles:
  • "Live performance content is your breakout formula — lean in"
  • "You have a CTA problem, not a content problem"
  • "TikTok's pulling 4× your IG engagement — the ratio is your roadmap"
  • "Three platforms, one story: your audience cares about specifics"

Body: 2-4 sentences. Explain the WHY using SPECIFIC numbers and post references from the data. Connect the pattern to a concrete next move. Don't just describe — argue.

═══ ACTIONS ═══

Exactly 3. Ordered by urgency (Now → Today → This week). Each action must:
  • Reference a SPECIFIC post, platform, or audience segment from the data
  • Be do-able in under 30 minutes if "Now", under 2 hours if "Today"
  • Move ONE metric the reader cares about
  • Avoid generic copy ("engage with your audience" → no, "reply to the top 8 comments on the 'Khasara' reel within the next hour" → yes)

═══ SIGNALS ═══

4-8 signals, varied across kinds and platforms when the data supports it. Each signal:
  • Cites at least one specific number or post from the data
  • Has a clear "so what" — connects the observation to a strategic implication
  • Uses the right kind label (viral / gap / collab / engagement / warning / timing / trend)
  • Avoids stating the obvious ("you have 294 followers on Instagram" is not a signal — "your IG ER ranks in the top 8% for accounts under 1K followers" is)

═══ OUTPUT FORMAT ═══

Return STRICT JSON only. No prose before or after. No code fences.

{
  "verdict": {
    "title": "string, 8-14 words",
    "body": "string, 2-4 sentences with specific numbers and post references"
  },
  "actions": [
    {
      "when": "Now" | "Today" | "This week",
      "icon": "flame" | "clock" | "sparkle" | "trending" | "users" | "message" | "play" | "mail",
      "title": "string, 4-8 words, specific and actionable",
      "body": "string, 1-2 sentences: what + why + expected impact",
      "cta": "string, 2-5 words describing the move (no arrow needed)"
    }
  ],
  "signals": [
    {
      "kind": "viral" | "gap" | "collab" | "engagement" | "warning" | "timing" | "trend",
      "platform": "instagram" | "tiktok" | "youtube" | "facebook" | "linkedin" | "x" | "snapchat" | "all",
      "title": "string, 6-14 words, the signal headline with a number or specific in it",
      "body": "string, 1-2 sentences with specific numbers AND the strategic implication",
      "impact": "High Impact" | "Strategic" | "Core Identity" | "Strategic Warning",
      "action": "string, 2-5 words describing the next move"
    }
  ],
  "score_factors": [
    "string, ≤14 words — what's pushing the intel score up or down (mix positives and negatives)"
  ]
}

Final reminder: this brief lands in someone's inbox at 6 AM. They have coffee in one hand and 90 seconds. Earn that 90 seconds. If your verdict could have been written without seeing their data, it's wrong. Rewrite it.`;

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
    max_tokens: 3000, // bumped — verdict body + signal bodies are richer now
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
