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
import { parseJsonResponse } from './anthropic.js';
import { generateIntelligence } from './ai-router.js';
import { allRulesAsPromptText } from './platform-rules.js';

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
// Series detection — group posts whose captions contain "Part N", "Episode N",
// "Ep N", "Pt N", or "#N" markers under a shared series key (the caption with
// the marker stripped, lowercased and trimmed). Returns groups with 3+ entries
// so the prompt can generate a series performance comparison instead of a
// naive "do Part N+1" recommendation.
const SERIES_PATTERNS = [
  /\b(?:part|episode|ep|pt|chapter|day)\s*[#:.]?\s*(\d+)\b/i,
  /(?:^|\s)#(\d+)(?:\s|$)/,
];

function detectSeries(posts) {
  const groups = new Map();
  for (const p of posts) {
    const cap = p.caption || '';
    if (!cap) continue;
    let match = null;
    for (const re of SERIES_PATTERNS) {
      const m = cap.match(re);
      if (m) { match = m; break; }
    }
    if (!match) continue;
    const entryNumber = Number(match[1]);
    if (!Number.isFinite(entryNumber)) continue;
    // Series key = caption with the matched marker removed, normalized.
    const key = (cap.replace(match[0], '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80))
              + `::${p.platform}`;
    if (!key.replace(`::${p.platform}`, '').length) continue; // marker was the entire caption
    if (!groups.has(key)) groups.set(key, { key, platform: p.platform, entries: [] });
    groups.get(key).entries.push({
      number: entryNumber,
      caption: cap.slice(0, 100),
      posted_at: p.posted_at,
      views: p.views || 0,
      likes: p.likes || 0,
      comments: p.comments || 0,
      saves: p.saves || 0,
      shares: p.shares || 0,
      engagement_rate: p.engagement_rate || 0,
      signal: p.signal,
    });
  }
  // Only return series with 3+ entries — fewer than that and a "do Part N+1"
  // recommendation is the right call.
  const result = [];
  for (const g of groups.values()) {
    if (g.entries.length < 3) continue;
    g.entries.sort((a, b) => a.number - b.number);
    const views = g.entries.map(e => e.views);
    const engs  = g.entries.map(e => e.engagement_rate);
    g.summary = {
      total: g.entries.length,
      latest_number: g.entries[g.entries.length - 1].number,
      avg_views: Math.round(views.reduce((s, n) => s + n, 0) / g.entries.length),
      peak_views: Math.max(...views),
      avg_engagement_rate: Math.round((engs.reduce((s, n) => s + n, 0) / g.entries.length) * 100) / 100,
      trajectory: views[views.length - 1] > views[0] ? 'growing'
                : views[views.length - 1] < views[0] * 0.7 ? 'declining'
                : 'flat',
    };
    result.push(g);
  }
  return result;
}

function buildPayload({ workspace, accounts, posts, snapshots, competitors, contentPieces = [], seriesRows = [] }) {
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

  // Series from the DB — every series with 2+ entries. The prompt uses
  // these to suppress continuation recommendations and to generate
  // series_arc signals on declining trends. (The old in-prompt heuristic
  // is still defined below for compatibility but no longer in the payload.)
  const series = (seriesRows || []).map(s => {
    const entries = ownPosts
      .filter(p => p.series_id === s.id)
      .sort((a, b) => String(a.posted_at).localeCompare(String(b.posted_at)));
    return {
      id: s.id,
      detected_name: s.detected_name,
      name: s.name,
      post_count: s.post_count,
      avg_views: s.avg_views,
      peak_views: s.peak_views,
      latest_number: s.latest_number,
      trend: s.trend,
      last_entry_at: s.last_entry_at,
      entries: entries.slice(-8).map(p => ({
        platform: p.platform,
        caption: (p.caption || '').slice(0, 80),
        posted_at: p.posted_at,
        views: p.views || 0,
        engagement_rate: p.engagement_rate || 0,
      })),
    };
  });

  // Cross-platform content groups — pieces published to 2+ platforms.
  // Drives cross_platform_gap and missed_crosspost signals. Single-platform
  // pieces are surfaced via the missed_crosspost lens (top performers that
  // never made it elsewhere).
  const piecePosts = new Map();
  for (const p of ownPosts) {
    if (!p.content_piece_id) continue;
    if (!piecePosts.has(p.content_piece_id)) piecePosts.set(p.content_piece_id, []);
    piecePosts.get(p.content_piece_id).push(p);
  }
  const groups = (contentPieces || []).map(cp => {
    const ps = piecePosts.get(cp.id) || [];
    const perPlatform = ps.map(p => ({
      platform: p.platform,
      caption: (p.caption || '').slice(0, 80),
      views: p.views || 0,
      likes: p.likes || 0,
      comments: p.comments || 0,
      shares: p.shares || 0,
      saves: p.saves || 0,
      engagement_rate: p.engagement_rate || 0,
      posted_at: p.posted_at,
    }));
    return {
      id: cp.id,
      title: cp.title,
      first_posted_at: cp.first_posted_at,
      platforms: cp.detected_platforms || [],
      best_platform: cp.best_platform,
      best_views: cp.best_views,
      worst_views: cp.worst_views,
      per_platform: perPlatform,
    };
  });
  const cross_platform = groups.filter(g => (g.platforms || []).length >= 2).slice(0, 15);
  // Top single-platform pieces that didn't cross-post — candidates for the
  // missed_crosspost signal. Sorted by views so the prompt sees the best
  // misses first.
  const single_platform_top = groups
    .filter(g => (g.platforms || []).length === 1 && g.best_views > 0)
    .sort((a, b) => (b.best_views || 0) - (a.best_views || 0))
    .slice(0, 8);

  // Engagement velocity context — posts under 24h old. Lets the prompt
  // emit engagement_velocity signals on posts that are accelerating fast.
  const dayAgo = Date.now() - 86400000;
  const recent = ownPosts
    .filter(p => p.posted_at && new Date(p.posted_at).getTime() >= dayAgo)
    .map(p => ({
      platform: p.platform,
      caption: (p.caption || '').slice(0, 80),
      posted_at: p.posted_at,
      hours_old: Math.max(0.1, (Date.now() - new Date(p.posted_at).getTime()) / 3600000),
      views: p.views || 0,
      engagement_rate: p.engagement_rate || 0,
      views_per_hour: Math.round((p.views || 0) / Math.max(0.5, (Date.now() - new Date(p.posted_at).getTime()) / 3600000)),
    }))
    .sort((a, b) => b.views_per_hour - a.views_per_hour)
    .slice(0, 6);

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
    series,
    cross_platform_groups: cross_platform,
    single_platform_top,
    recent_24h: recent,
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

═══ CROSS-PLATFORM REASONING ═══

The payload contains \`cross_platform_groups\` — content pieces published to 2+ platforms (same caption fingerprint, within 48 hours). NEVER analyze a post in isolation. Always check whether a piece appears on multiple platforms before drawing conclusions.

When the same content performs significantly differently across platforms (>= 3× delta in views or eng rate), emit a \`cross_platform_gap\` signal. Reference the BEST platform and the WORST platform by name, the actual delta, AND a SPECIFIC fix using the platform best-practice rules below. Generic advice ("post more often") is forbidden — reference the specific rule (hook window, caption length, hashtag count, audio strategy, cross-post adaptation).

The payload also contains \`single_platform_top\` — pieces that performed well on one platform but never crossed to others. For the top 1–2 (by views), emit a \`missed_crosspost\` signal explaining which platform(s) the format would work on, citing the platform rule that supports it.

═══ SERIES HANDLING ═══

The payload's \`series\` field is the source of truth — pulled from the workspace's \`series\` table. Each entry has a \`trend\`: growing / stable / declining / stale. For each series with 2+ entries:
  • NEVER recommend "make Part N+1" as an action. The user is already producing the series — continuation is obvious and offensive to recommend.
  • INSTEAD emit a \`series_arc\` signal that names the trend, identifies the peak entry, and:
      - if \`trend = declining\`: recommend a format reset (cite specific changes: new hook style, different platform-rules audio strategy, etc).
      - if \`trend = growing\`: identify what's making it work and recommend doubling pace.
      - if \`trend = stale\` (no new entry in 14+ days): recommend a revival angle.
  • Use \`is_series: true\` on series_arc signals.
  • Cite the actual entry numbers, view counts, and trend from the payload.

═══ ENGAGEMENT VELOCITY ═══

The payload's \`recent_24h\` array contains posts under 24 hours old with a \`views_per_hour\` rate. When a post's views_per_hour is meaningfully higher than the user's typical platform average (compare to \`platforms.{platform}.total_views_30d / 30 / 24\`), emit an \`engagement_velocity\` signal with the actual ratio and a "what to do in the next 6 hours" action (reply to comments, cross-post, boost). Only emit when the lead is real — if the post is brand new (< 2 hours) the signal is noise unless the rate is exceptional.

═══ PLATFORM BEST-PRACTICE RULES ═══

Use these when generating cross_platform_gap, missed_crosspost, or series_arc fixes. Quote the specific rule you're applying — the user should be able to verify the recommendation against the rule.

${allRulesAsPromptText()}

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
      "kind": "viral" | "gap" | "collab" | "engagement" | "warning" | "timing" | "trend"
            | "cross_platform_gap" | "missed_crosspost" | "series_arc"
            | "hook_pattern" | "collaboration_multiplier" | "engagement_velocity"
            | "caption_language_split",
      "platform": "instagram" | "tiktok" | "youtube" | "facebook" | "linkedin" | "x" | "snapchat" | "all",
      "title": "string, 6-14 words, the signal headline with a number or specific in it",
      "body": "string, 1-2 sentences with specific numbers AND the strategic implication. For cross_platform_gap / missed_crosspost / series_arc, cite the specific platform-rule that supports the fix.",
      "impact": "High Impact" | "Strategic" | "Core Identity" | "Strategic Warning",
      "action": "string, 2-5 words describing the next move",
      "is_series": "boolean, optional — true on series_arc signals"
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

// Re-export the prompt-building flow so the compare-models endpoint can run
// the identical prompt against both providers without copying internal logic.
export function buildBriefPrompt({ workspace, accounts, posts, snapshots, competitors }) {
  const payload = buildPayload({ workspace, accounts, posts, snapshots, competitors });
  return { system: SYSTEM_PROMPT, user: buildUserMessage(payload) };
}

// ── Persist generated brief into signals table ─────────────────────────────────
async function persist({ workspace, brief, intelScore, usage, model, modelUsed, latencyMs, tokensUsed }) {
  // Soft-delete prior BRIEF rows (verdict/action/standard signals) so the
  // screen reads today's brief. Live-signal rows (kind='live') are kept —
  // they're an independent append-only feed and shouldn't be invalidated
  // when a new morning brief lands.
  const briefKinds = [
    'verdict', 'action',
    // Original kinds
    'viral', 'gap', 'collab', 'engagement', 'warning', 'audience', 'timing', 'trend',
    // Cross-platform content-intelligence kinds (migration 005)
    'cross_platform_gap', 'missed_crosspost', 'series_arc',
    'hook_pattern', 'collaboration_multiplier', 'engagement_velocity',
    'caption_language_split',
  ];
  await supabase.update('signals',
    { is_read: true },
    { eq: { workspace_id: workspace.id }, in: { kind: briefKinds } }
  ).catch(() => {});

  // Common per-row provenance fields. model_used / latency_ms / tokens_used
  // were added in migrations/005 so the UI can attribute generations.
  const provenance = {
    model_used: modelUsed || null,
    latency_ms: typeof latencyMs === 'number' ? latencyMs : null,
    tokens_used: typeof tokensUsed === 'number' ? tokensUsed : null,
  };

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
    ...provenance,
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
      ...provenance,
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
      is_series: !!s.is_series,
      ...provenance,
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
// ─── Live signals (8/13/18 local) ────────────────────────────────────────
// Pattern-detection only — no LLM call. Appends to the signals feed; does
// not replace or invalidate the morning brief. Each detection writes a
// `kind='live'` row with a deduplication key in metadata so we don't
// re-alert on the same trigger if the cron runs twice in the same window.
const FOLLOWER_MILESTONES = [10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000];
function fnum(n) {
  if (n == null) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 10e6 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 10e3 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export async function generateLiveSignals(workspace) {
  // Pull what we need to compare against the user's baseline.
  const [posts, snapshots, existingLive] = await Promise.all([
    supabase.select('posts', {
      select: 'id,platform,caption,views,engagement_rate,signal,posted_at,likes,comments',
      eq: { workspace_id: workspace.id, source: 'own' },
      order: 'posted_at.desc', limit: 60,
    }).catch(() => []),
    supabase.select('account_snapshots', {
      select: '*',
      eq: { workspace_id: workspace.id, account_type: 'own' },
      order: 'snapshot_date.desc', limit: 60,
    }).catch(() => []),
    supabase.select('signals', {
      select: 'id,metadata,generated_at',
      eq: { workspace_id: workspace.id, kind: 'live' },
      order: 'generated_at.desc', limit: 100,
    }).catch(() => []),
  ]);

  if (!posts?.length && !snapshots?.length) {
    return { new: 0, checked: 0, reason: 'insufficient_data' };
  }

  const existingKeys = new Set((existingLive || []).map(s => s.metadata?.dedup_key).filter(Boolean));
  const out = [];

  // Pattern 1 — viral threshold crossed (engagement_rate >= 12%)
  // Only consider posts from the last 7 days; older viral posts have already
  // been surfaced via the morning brief.
  const sevenDaysAgo = Date.now() - 7 * 86400000;
  for (const p of (posts || [])) {
    if ((p.engagement_rate || 0) < 12) continue;
    if (!p.posted_at || new Date(p.posted_at).getTime() < sevenDaysAgo) continue;
    const key = `viral_${p.id}`;
    if (existingKeys.has(key)) continue;
    out.push({
      workspace_id: workspace.id,
      kind: 'live',
      label: 'Viral',
      platform: p.platform,
      title: `Post crossed viral threshold (${p.engagement_rate}% engagement)`,
      body: `${(p.caption || 'Untitled post').slice(0, 140)}${(p.caption || '').length > 140 ? '…' : ''} — ${fnum(p.views)} views, ${fnum((p.likes || 0) + (p.comments || 0))} reactions.`,
      impact: 'High Impact',
      action: 'Open post',
      is_read: false,
      generated_at: new Date().toISOString(),
      metadata: { dedup_key: key, post_id: p.id, type: 'viral_crossed' },
    });
  }

  // Pattern 2 — follower milestone crossed
  // Group snapshots by (platform, handle), sort newest-first, compare the
  // latest reading to the previous one. Any milestone in between triggers.
  const series = {};
  for (const s of (snapshots || [])) {
    const k = `${s.platform}::${s.handle}`;
    (series[k] ||= []).push(s);
  }
  for (const arr of Object.values(series)) {
    arr.sort((a, b) => String(b.snapshot_date).localeCompare(String(a.snapshot_date)));
    if (arr.length < 2) continue;
    const latest = arr[0], previous = arr[1];
    if (latest.followers == null || previous.followers == null) continue;
    for (const m of FOLLOWER_MILESTONES) {
      if (previous.followers < m && latest.followers >= m) {
        const key = `milestone_${m}_${latest.platform}_${latest.handle}`;
        if (existingKeys.has(key)) continue;
        out.push({
          workspace_id: workspace.id,
          kind: 'live',
          label: 'Milestone',
          platform: latest.platform,
          title: `Crossed ${fnum(m)} followers on ${latest.platform}`,
          body: `${latest.handle || 'Your account'} ticked past ${fnum(m)} today (was ${fnum(previous.followers)} yesterday).`,
          impact: 'Milestone',
          action: null,
          is_read: false,
          generated_at: new Date().toISOString(),
          metadata: { dedup_key: key, type: 'follower_milestone', threshold: m, platform: latest.platform, handle: latest.handle },
        });
      }
    }
  }

  // Pattern 3 — engagement spike (post in last 48h whose eng rate is >2x
  // the rolling 30-day average for that platform).
  const fortyEightHoursAgo = Date.now() - 48 * 3600000;
  const byPlatformPosts = {};
  for (const p of (posts || [])) {
    (byPlatformPosts[p.platform] ||= []).push(p);
  }
  for (const [platform, group] of Object.entries(byPlatformPosts)) {
    if (group.length < 5) continue; // not enough baseline
    const baseline = group.reduce((s, p) => s + (p.engagement_rate || 0), 0) / group.length;
    if (baseline <= 0) continue;
    for (const p of group) {
      if (!p.posted_at || new Date(p.posted_at).getTime() < fortyEightHoursAgo) continue;
      if ((p.engagement_rate || 0) < baseline * 2) continue;
      if ((p.engagement_rate || 0) >= 12) continue; // already covered by viral pattern
      const key = `spike_${p.id}`;
      if (existingKeys.has(key)) continue;
      out.push({
        workspace_id: workspace.id,
        kind: 'live',
        label: 'Spike',
        platform,
        title: `Engagement spike — ${p.engagement_rate}% vs your ${baseline.toFixed(1)}% average`,
        body: `${(p.caption || 'A post').slice(0, 140)} is running ${((p.engagement_rate / baseline)).toFixed(1)}× hotter than your typical ${platform} post.`,
        impact: 'Strategic',
        action: 'Boost or cross-post',
        is_read: false,
        generated_at: new Date().toISOString(),
        metadata: { dedup_key: key, post_id: p.id, type: 'engagement_spike', baseline: Math.round(baseline * 100) / 100 },
      });
    }
  }

  if (out.length) {
    await supabase.insert('signals', out).catch(() => {});
  }
  return { new: out.length, checked: posts.length };
}

export async function generateBrief(workspace) {
  // 1) Gather data — including content_pieces + series so the prompt can
  //    reason about cross-platform groupings and ongoing numbered series
  //    rather than treating each post as an isolated row.
  const [accounts, posts, snapshots, competitors, contentPieces, seriesRows] = await Promise.all([
    supabase.select('connected_accounts', { select: '*', eq: { workspace_id: workspace.id } }).catch(() => []),
    supabase.select('posts', { select: '*', eq: { workspace_id: workspace.id }, order: 'posted_at.desc', limit: 200 }).catch(() => []),
    supabase.select('account_snapshots', { select: '*', eq: { workspace_id: workspace.id }, order: 'snapshot_date.desc', limit: 30 }).catch(() => []),
    supabase.select('competitors', { select: '*', eq: { workspace_id: workspace.id } }).catch(() => []),
    supabase.select('content_pieces', { select: '*', eq: { workspace_id: workspace.id }, order: 'first_posted_at.desc', limit: 60 }).catch(() => []),
    supabase.select('series', { select: '*', eq: { workspace_id: workspace.id }, order: 'last_entry_at.desc' }).catch(() => []),
  ]);

  if (!accounts?.length || !posts?.length) {
    return { skipped: 'insufficient_data', accounts: accounts?.length || 0, posts: posts?.length || 0 };
  }

  // 2) Deterministic intel score
  const intelScore = computeIntelScore({ accounts, posts, snapshots });

  // 3) Build prompt
  const payload = buildPayload({ workspace, accounts, posts, snapshots, competitors, contentPieces, seriesRows });

  // 4) Call the AI router — picks Claude or Gemini per workspace.ai_model
  //    with automatic fallback on provider failure.
  const result = await generateIntelligence({
    system: SYSTEM_PROMPT,
    user:   buildUserMessage(payload),
    model:  workspace.ai_model || 'claude',
    max_tokens: 3000,
    temperature: 0.6,
  });

  const brief = parseJsonResponse(result.text);
  if (!brief) {
    return { error: 'LLM returned unparseable output', raw: result.text?.slice(0, 500) };
  }

  // 5) Persist (with per-row provenance: model_used / latency_ms / tokens_used)
  await persist({
    workspace, brief, intelScore,
    usage: result.usage,
    model: result.raw_model,
    modelUsed: result.model_used,
    latencyMs: result.latency_ms,
    tokensUsed: result.tokens_used,
  });

  // 6) Log usage
  await supabase.insert('usage_log', {
    workspace_id: workspace.id,
    run_type: 'intelligence',
    platform: 'all',
    records_fetched: (brief.signals?.length || 0) + (brief.actions?.length || 0) + 1,
    cost_cents: result.cost_cents || 0,
    status: 'completed',
  }).catch(() => {});

  return {
    ok: true,
    intelScore,
    verdict: brief.verdict?.title,
    actions: brief.actions?.length || 0,
    signals: brief.signals?.length || 0,
    model_used: result.model_used,
    model_requested: result.model_requested,
    fallback_from: result.fallback_from,
    latency_ms: result.latency_ms,
    tokens_used: result.tokens_used,
    cost_cents: result.cost_cents,
  };
}
