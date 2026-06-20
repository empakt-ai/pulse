// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Stays in this repo when the platform extraction happens.
// All AI brief generation, prompt construction, signal taxonomy, and intel-
// score calculation lives here. Content Studio will have its own equivalent
// (different product, different lens). No shared infrastructure imports
// (Supabase, Anthropic wrapper) become Mashal-specific by association — only
// the orchestration and prompting in this file does.
// ═════════════════════════════════════════════════════════════════════════
//
// Intelligence generator — turns 30 days of workspace data into a daily AI brief:
//   - 1 verdict (the dark hero card on Brief)
//   - 6 prioritized actions (urgent + this-week + strategic)
//   - 4-8 cross-platform signals
//   - Intelligence score /100 (deterministic formula, LLM annotates factors)
//
// Output is written to the `signals` table (kinds: 'verdict', 'action', plus the
// standard 'viral'/'gap'/'collab'/'engagement'/'warning'/'timing'/'trend'). The
// /api/brief endpoint segregates by kind on read.

import { supabase } from './supabase.js';
import { parseJsonResponse } from './anthropic.js';
import { generateIntelligence } from './ai-router.js';
import { callStream as geminiCallStream } from './gemini.js';
import { allRulesAsPromptText } from './platform-rules.js';
import { checkUsageCap } from './tiers.js';
import { buildAdsIntel, buildAdsIntelPrompt } from './ads-intel.js';
import { getUpcomingCulturalMoments } from './cultural-calendar.js';
import { dispatchEvent as dispatchWebhookEvent } from './webhooks.js';

// Short keys for ads' platform aggregate — must match what brief.js emits
// in `per_platform[i].platform` so benchmark lookups in buildAdsIntel hit
// the seeded floor. Mirrors PLATFORM_TO_ICON in brief.js.
const ADS_PLATFORM_KEY = {
  instagram: 'ig', tiktok: 'tt', youtube: 'yt',
  facebook: 'fb', linkedin: 'li', x: 'x', snapchat: 'sc',
};

// Brief-time wrapper around buildAdsIntel. Skips the lookup entirely on
// tiers that can't see ads (Creator), workspaces with no ads, or empty
// settings. Returns the `intel` object that goes into the prompt payload
// (null when there's nothing to attach). All failures are swallowed so
// brief generation never blocks on ad benchmarks.
async function computeAdsIntelForBrief(workspace, posts) {
  try {
    const tierKey = String(workspace.tier || 'creator').toLowerCase();
    if (tierKey !== 'brand' && tierKey !== 'agency') return null;
    const ownAds = (posts || []).filter(p => p.source === 'own' && p.post_type === 'ad');
    if (!ownAds.length) return null;
    const perPlatform = aggregateAdsPerPlatform(ownAds);
    const { intel } = await buildAdsIntel({
      workspace,
      adsAllowed: true,
      adsCount: ownAds.length,
      perPlatform,
    });
    return intel;
  } catch (e) {
    console.warn('[intelligence] ads intel skipped (non-fatal):', e.message);
    return null;
  }
}

// Per-platform ad aggregate — same shape brief.js builds. Pulled out as
// a helper so generateBrief / generateBriefStream can hand the result
// straight to buildAdsIntel without re-running brief.js logic.
function aggregateAdsPerPlatform(ownAds) {
  const byPlat = {};
  for (const a of ownAds) {
    const pk = ADS_PLATFORM_KEY[a.platform] || a.platform;
    const row = byPlat[pk] || (byPlat[pk] = { platform: pk, count: 0, spend: 0, impressions: 0, clicks: 0 });
    row.count += 1;
    row.spend += Number(a.raw_data?.spend || 0);
    row.impressions += Number(a.views || 0);
    row.clicks += Number(a.raw_data?.clicks || 0);
  }
  return Object.values(byPlat).map(r => ({
    ...r,
    spend: Math.round(r.spend * 100) / 100,
    ctr: r.impressions ? Math.round((r.clicks / r.impressions) * 10000) / 100 : 0,
  })).sort((a, b) => b.spend - a.spend);
}

// Build the cap-exceeded skip payload. Shared so /generate and /stream
// return the same shape — the SPA's toast / banner handler can rely on
// `skipped === 'usage_cap_exceeded'` and read `message`/`used`/`limit`
// without branching on caller.
function capExceededPayload(cap) {
  const friendlyLimit = (cap.limit === null || cap.limit === -1) ? 'your plan' : `${cap.limit}`;
  const source = cap.source === 'trial_locked'
    ? 'Your trial has ended — upgrade to generate briefs.'
    : cap.source === 'trial'
      ? `You've used ${cap.used} of your ${cap.limit} trial regenerations. Upgrade to keep going.`
      : `You've used ${cap.used}/${friendlyLimit} brief regenerations this month. Upgrade or wait until next month to run another manual brief.`;
  return {
    skipped: 'usage_cap_exceeded',
    message: source,
    used: cap.used,
    limit: cap.limit,
    cap_source: cap.source,
  };
}

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

// ─── Hashtag extraction + correlation ──────────────────────────────────
// Pulls #hashtags out of caption text + raw_data (platforms variously
// store hashtags as inline tokens in caption, as a separate `hashtags`
// array in raw_data, or both). Unicode-aware so Arabic / Hindi / Urdu
// hashtags (#الرياض, #दिवाली, #اردو) survive extraction. Returns
// lowercase keys with display-case preserved for the prompt.
const HASHTAG_REGEX = /(?:^|\s|[(\[「『《])#([\p{L}\p{N}_]+)/gu;

function extractHashtagsFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  let m;
  HASHTAG_REGEX.lastIndex = 0;
  while ((m = HASHTAG_REGEX.exec(text)) !== null) {
    const tag = m[1];
    if (tag && tag.length >= 2) out.push(tag);
  }
  return out;
}

function extractHashtagsFromPost(post) {
  const tags = new Map(); // lowercase → display case
  // 1. Inline #tokens in caption.
  for (const tag of extractHashtagsFromText(post.caption || '')) {
    tags.set(tag.toLowerCase(), tag);
  }
  // 2. Some platforms expose a structured array on raw_data — IG's
  //    hashtags via Graph API, TikTok's hashtag list on items, etc.
  const raw = post.raw_data;
  if (raw && typeof raw === 'object') {
    const candidates = [raw.hashtags, raw.tags, raw.hashtag_names, raw.entities?.hashtags];
    for (const arr of candidates) {
      if (Array.isArray(arr)) {
        for (const h of arr) {
          // Strings, or { name } / { text } / { tag } objects.
          const name = typeof h === 'string' ? h : (h?.name || h?.text || h?.tag || h?.hashtagName);
          if (name && typeof name === 'string') {
            const cleaned = String(name).replace(/^#/, '').trim();
            if (cleaned.length >= 2) tags.set(cleaned.toLowerCase(), cleaned);
          }
        }
      }
    }
  }
  return [...tags.values()];
}

// Build the hashtag intelligence payload — top tags by frequency, by
// engagement weight, competitor overlap, and which tags travel with the
// workspace's viral signal posts. Designed to give the LLM enough signal
// to recommend specific hashtags by name in the brief actions.
function buildHashtagIntel(ownPosts, competitors, posts) {
  // Per-tag stats for own posts: frequency, total views, avg engagement
  // rate, viral count. We weight by views (more visible posts move the
  // needle more than a low-reach test that happened to use the tag).
  const ownStats = new Map(); // key (lowercase) → { tag, freq, views, engRateSum, viralCount, samples[] }
  for (const p of ownPosts) {
    const tags = extractHashtagsFromPost(p);
    for (const tag of tags) {
      const k = tag.toLowerCase();
      const cur = ownStats.get(k) || {
        tag, freq: 0, views: 0, engRateSum: 0, viralCount: 0,
        platforms: new Set(), samples: [],
      };
      cur.freq += 1;
      cur.views += Number(p.views || 0);
      cur.engRateSum += Number(p.engagement_rate || 0);
      if (p.signal === 'viral') cur.viralCount += 1;
      if (p.platform) cur.platforms.add(p.platform);
      if (cur.samples.length < 2 && p.views > 0) {
        cur.samples.push({
          caption: (p.caption || '').slice(0, 60),
          views: p.views, engagement_rate: p.engagement_rate,
        });
      }
      ownStats.set(k, cur);
    }
  }

  // Competitor stats — same shape, but tags are also flagged by which
  // competitors used them so the prompt can name the source.
  const compStats = new Map(); // key → { tag, freq, views, competitors: Set }
  const competitorPosts = (posts || []).filter(p => p.source === 'competitor');
  const compById = new Map((competitors || []).map(c => [c.id, c]));
  for (const p of competitorPosts) {
    const tags = extractHashtagsFromPost(p);
    const comp = compById.get(p.competitor_id);
    if (!tags.length || !comp) continue;
    for (const tag of tags) {
      const k = tag.toLowerCase();
      const cur = compStats.get(k) || {
        tag, freq: 0, views: 0,
        competitors: new Set(),
      };
      cur.freq += 1;
      cur.views += Number(p.views || 0);
      cur.competitors.add(comp.handle);
      compStats.set(k, cur);
    }
  }

  // Materialise to arrays and rank. We surface three lenses:
  //  1. Top hashtags on the workspace's OWN content (frequency-ranked)
  //  2. Hashtags carrying the highest engagement rate (own; min 2 uses)
  //  3. Competitor hashtags the workspace DOESN'T use (gap candidates)
  const ownArr = [...ownStats.values()].map(s => ({
    tag: s.tag,
    freq: s.freq,
    total_views: s.views,
    avg_engagement_rate: s.freq ? Math.round((s.engRateSum / s.freq) * 100) / 100 : 0,
    viral_count: s.viralCount,
    platforms: [...s.platforms],
    samples: s.samples,
  }));

  const ownTopByFreq = [...ownArr]
    .sort((a, b) => b.freq - a.freq || b.total_views - a.total_views)
    .slice(0, 10);

  const ownTopByEngagement = ownArr
    .filter(t => t.freq >= 2)
    .sort((a, b) => b.avg_engagement_rate - a.avg_engagement_rate)
    .slice(0, 10);

  // Gap = competitor hashtag used 2+ times across competitors that the
  // workspace itself hasn't used at all. Sorted by total views so the
  // prompt sees the biggest misses first.
  const ownTagSet = new Set([...ownStats.keys()]);
  const compGapArr = [...compStats.values()]
    .filter(s => !ownTagSet.has(s.tag.toLowerCase()) && s.freq >= 2)
    .map(s => ({
      tag: s.tag,
      competitor_uses: s.freq,
      total_competitor_views: s.views,
      competitor_count: s.competitors.size,
      competitors: [...s.competitors].slice(0, 5),
    }))
    .sort((a, b) => b.total_competitor_views - a.total_competitor_views)
    .slice(0, 10);

  // Overlap = tags both the workspace and competitors use. Useful for
  // "you're in the right conversation, but underperforming" framing.
  const overlapArr = ownArr
    .filter(t => compStats.has(t.tag.toLowerCase()))
    .map(t => {
      const c = compStats.get(t.tag.toLowerCase());
      return {
        tag: t.tag,
        own_freq: t.freq,
        own_avg_engagement_rate: t.avg_engagement_rate,
        competitor_freq: c.freq,
        competitor_total_views: c.views,
        competitor_count: c.competitors.size,
      };
    })
    .sort((a, b) => b.competitor_total_views - a.competitor_total_views)
    .slice(0, 8);

  // Skip the section entirely if there's effectively no hashtag data
  // (some workspaces don't use them at all — Snapchat / X workspaces in
  // particular). The LLM shouldn't see an empty hashtag block and feel
  // compelled to fabricate one.
  if (ownTopByFreq.length === 0 && compGapArr.length === 0) return null;

  return {
    own_top_by_frequency: ownTopByFreq,
    own_top_by_engagement: ownTopByEngagement,
    competitor_gap: compGapArr,
    overlap: overlapArr,
  };
}

function buildPayload({ workspace, accounts, posts, snapshots, competitors, contentPieces = [], seriesRows = [], adsIntel = null }) {
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

  // Upcoming cultural moments relevant to this workspace — drives
  // proactive timing signals in the brief. 45-day look-ahead covers
  // the practical preparation window for major retail/holiday content.
  const culturalMoments = getUpcomingCulturalMoments(
    workspace.country,
    workspace.focus_regions || [],
    45
  );

  // TIER GATE — multilingual brief is a Pro Creator+ feature. Creator
  // workspaces always get an English brief regardless of what they have
  // saved in workspace.brief_language. The /pricing comparison sells this
  // as a Pro Creator upgrade; force the LLM to honor that by overriding
  // the language in the prompt context before the model sees it.
  const wsTier = String(workspace?.tier || 'creator').toLowerCase();
  const briefLanguage = wsTier === 'creator'
    ? 'en'
    : (workspace.brief_language || 'en');

  return {
    workspace: {
      user_type: workspace.user_type,
      category: workspace.category,
      market: workspace.market,
      country: workspace.country,
      account_age: workspace.account_age,
      tier: workspace.tier,
      brief_language: briefLanguage,
    },
    platforms: byPlatform,
    top_posts: topPosts,
    series,
    cross_platform_groups: cross_platform,
    single_platform_top,
    recent_24h: recent,
    // Competitors — each entry now carries up to 5 of the competitor's
    // top recent posts (caption + metrics). Captions stay in their
    // original language so the prompt's LANGUAGE & CULTURAL INTELLIGENCE
    // section can do native-language analysis. Powers competitor
    // positioning, the rewrite block (which needs verbatim competitor
    // quotes), and caption_language_split signals.
    competitors: (competitors || []).slice(0, 10).map(c => {
      const cPosts = (posts || [])
        .filter(p => p.source === 'competitor' && p.competitor_id === c.id)
        .sort((a, b) => (b.views || 0) - (a.views || 0))
        .slice(0, 5)
        .map(p => ({
          caption: (p.caption || '').slice(0, 140),
          posted_at: p.posted_at,
          views: p.views || 0,
          likes: p.likes || 0,
          comments: p.comments || 0,
          engagement_rate: p.engagement_rate || 0,
        }));
      return {
        platform:     c.platform,
        handle:       c.handle,
        display_name: c.display_name || null,
        followers:    c.followers || 0,
        top_posts:    cPosts,
      };
    }),
    // Ad Intelligence — present only for workspaces with ads + configured
    // settings. Carries per-platform spot scores, the benchmark each was
    // compared against, and up to 5 ranked recommendations. The natural-
    // language version is appended separately in buildUserMessage so the
    // model gets both the structured payload and a direct nudge.
    ads_intel: adsIntel || null,
    // Hashtag intelligence — own + competitor patterns. Null for workspaces
    // that don't use hashtags (X-only, Snapchat-heavy). When present, the
    // prompt is instructed to name specific hashtags in actions, including
    // the gap-candidate list (tags competitors use but the workspace
    // doesn't) so the brief can recommend specific adds, not generic
    // "use more hashtags" copy.
    hashtag_intel: buildHashtagIntel(ownPosts, competitors, posts),
    // Cultural calendar — null when nothing relevant is upcoming in the
    // 45-day window. The instruction string tells the model how hard to
    // lean on the moments (immediate vs upcoming).
    cultural_calendar: culturalMoments.length > 0 ? {
      upcoming: culturalMoments,
      instruction: culturalMoments.some(e => e.urgency === 'immediate')
        ? 'URGENT: One or more cultural moments are happening NOW or within 3 days. Surface as the first or second action in the brief.'
        : culturalMoments.some(e => e.urgency === 'this_week')
        ? 'TIMELY: Cultural moments arrive this week. Include at least one action referencing the nearest event.'
        : 'UPCOMING: Cultural moments within 45 days. Reference the nearest one as a strategic action or signal.',
    } : null,
  };
}

// ── System prompt — cacheable ────────────────────────────────────────────────
// Designed to produce briefs at the quality of a senior strategist reading
// the data with their morning coffee, not a generic AI summarizer.
const SYSTEM_PROMPT = `You are Mashal, an AI strategist embedded in a social-media intelligence platform. The platform serves serious creators, brands, and agencies who pay $15–$449/month for ONE thing: to know what to do today based on their actual numbers. Not what's possible. Not what works for others. What to do TODAY based on THEIR data.

You write the morning brief. The reader is non-technical, busy, and skeptical of AI. They will instantly dismiss you if you sound like a chatbot, summarizer, or LinkedIn ghostwriter. They will keep reading if you sound like a sharp friend who actually looked at their numbers.

═══ VOICE ═══

• Specific over general. "Your 'Khasara' reel hit 12.8% engagement vs your 7.4% average" beats "Your engagement is up".
• Cite real numbers from the data. Real post titles in quotes. Real platforms by name (Instagram, TikTok, YouTube — never ig/tt/yt).
• Direct. No "consider," "you might," "could potentially." Just "do X because Y."
• Honest about thin data. If posts are few or zero, name that and recommend foundation work — don't invent insights.
• Confident, not cocky. If you're guessing, say "looks like" or "one read is" — once. Then commit.
• No emojis. No exclamation points. No marketing copy ("unlock your potential").
• Vary the verdict opener — never start the verdict with "Your" two days in a row.

═══ VOICE MIRRORING ═══

Before writing the brief body, read the workspace's last ~10 caption strings (in the DATA payload's posts array) and infer THEIR voice on five axes:

1. Formality — corporate-formal, conversational-professional, casual-friendly, or street/slang?
2. Code-switching rate — pure native language, native with a few English loanwords, heavy bilingual mixing, or English-dominant with native flavour?
3. Emoji density — none, sparing (1-2 per post), frequent (5+), or a signature recurring emoji?
4. Sentence length — short and punchy, medium narrative, or long flowing?
5. Humour register — dry, warm, irreverent, earnest, or none?

Mirror that register in the verdict body, action bodies, and signal bodies. The reader must feel the brief was written by someone who already talks like they do — not a generic AI. Titles can stay sharper and more punchy than the workspace's captions (a headline does headline work), but body copy should feel native to them.

Hard rules:
• A formal corporate brand (no slang, no emoji, "we", complete sentences) gets a brief in the same polished register — do NOT casualise it.
• A street-talking creator (slang, code-switching, emoji, fragments) gets a brief that uses that same register — do NOT formalise it. The "shudh"/Fusha/formal default of most LLMs is wrong for them.
• An agency generating a brief for ONE specific client workspace mirrors THAT client's voice, not an averaged agency house style. Client A and Client B under the same agency should read in two clearly different voices.
• If the workspace's captions are in a non-English language, the register and code-switching pattern of the captions overrides any default register rule for that language. Match THEM, not the textbook.
• Thin data caveat: if there are fewer than 5 posts with substantive captions, fall back to the SPOKEN REGISTER baseline in the LANGUAGE & CULTURAL INTELLIGENCE block — but never default to formal/literary register without evidence the workspace actually writes that way.

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

Exactly 6, distributed: 2 urgent (Now / Today), 2 medium (This week), 2 strategic (This month).
Ordered by urgency. Each action must:
  • Reference a SPECIFIC post, platform, or audience segment from the data
  • Be do-able in under 30 minutes if "Now", under 2 hours if "Today",
    finishable in a single sitting if "This week", a multi-step build if "This month"
  • Move ONE metric the reader cares about
  • Avoid generic copy ("engage with your audience" → no, "reply to the top 8 comments on the 'Khasara' reel within the next hour" → yes)
  • "This month" actions are strategic builds — content series launches, new
    formats to test, niche territory to claim. They should explain what to build,
    why it wins, and the success metric to watch.

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
      "when": "Now" | "Today" | "This week" | "This month",
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
  ],
  "formula": {
    "hook": "string, 1 sentence — the opening device that works for this workspace's audience right now. Cite the post + metric that proves it.",
    "differentiator": "string, 1 sentence — the angle this workspace owns that competitors can't copy (cultural, format, niche, identity).",
    "caption": "string, 1 sentence — caption structure that's outperforming. Language + length + ingredients.",
    "niche": "string, 1 sentence — the content territory this workspace should claim and why it's defensible.",
    "positioning": "string, 1 sentence — the brand's one-line positioning statement, written as if it would appear on their About page. Specific to who they serve and how they win.",
    "whats_working": [
      "string, ≤16 words — a specific thing in their current content that's earning reach"
    ],
    "whats_missing": [
      "string, ≤16 words — a specific thing their top competitors do that they don't"
    ],
    "unlock": "string, 1 sentence — the single highest-leverage change in their current content (cite the existing post/line/asset that proves they could)."
  },
  "rewrite": {
    "competitor_handle": "string — handle whose top post we're using as the model",
    "competitor_quote":  "string — the actual opening line of that competitor's top post (verbatim, ≤30 words)",
    "competitor_metric": "string — what made it work (e.g. '38 likes · top LI post', '32M plays · top TT video')",
    "your_quote":        "string — the actual opening line of one of this workspace's recent posts (verbatim, ≤30 words). Pick a post whose subject is comparable.",
    "your_metric":       "string — current performance of that post (e.g. '4 likes', '12 views')",
    "suggested_rewrite": "string — a rewritten opening line for the user's post, applying the competitor's hook structure but keeping the user's voice + topic.",
    "why":               "string, 1 sentence — why this rewrite would outperform the original."
  }
}

The "formula" object is a distilled playbook a creator can act on immediately.
Each field must reference a concrete pattern visible in this workspace's data
— not generic advice. If the data is too thin to derive a formula (fewer than
5 posts), return null instead of inventing one.

The "rewrite" object pairs a top competitor post with one of the user's
posts and shows what their post would look like in the competitor's winning
structure. Both quotes must be VERBATIM from the actual data — never invent
text. If no clean comparison exists, return null instead of fabricating one.

═══ COMPETITOR CONTENT ANALYSIS ═══

The payload's \`competitors\` field includes each competitor's top 5 recent posts with caption, posted_at, and engagement metrics. Read each competitor caption in its NATIVE language — never translate or transliterate it before analysing. Then:
• Compare hook structures, caption length, language register, and emoji/hashtag density against the user's top posts.
• Surface specific topics, formats, or local idioms the competitor uses that the user does not.
• If the user's content is in one language and a top-performing competitor publishes in another (e.g. user posts in English, competitor wins in Arabic in the same market), emit a \`caption_language_split\` signal — naming both languages, the engagement delta, and a recommended caption-language test for the user.
• When picking the \`rewrite.competitor_quote\`, it MUST be VERBATIM from one of the competitor.top_posts captions, in the original language (do not translate it). The matching \`your_quote\` must also be verbatim from one of the user's recent posts. Pair them on topic similarity, not language similarity.
• If a competitor has zero top_posts (e.g. scrape pending), skip them for the rewrite — never invent a competitor quote.

═══ HASHTAG INTELLIGENCE ═══

When \`hashtag_intel\` is present in the DATA, use it to recommend SPECIFIC hashtags by name rather than generic "use more hashtags" copy:

• \`hashtag_intel.own_top_by_engagement\` lists tags the workspace already uses that produce above-average engagement rates. When recommending a content move, name 1-3 of these as the natural hashtag set to keep using.
• \`hashtag_intel.competitor_gap\` lists tags 2+ tracked competitors use that the workspace does NOT use. These are the highest-leverage adds — competitors are demonstrably reaching audience via these tags. Pick the top 2-3 with the most competitor views behind them and recommend testing them on the workspace's next post of that content type. Name the competitors using them (e.g. "@nike, @adidas both ride #JustDoIt").
• \`hashtag_intel.overlap\` shows tags both the workspace and competitors use. If the workspace's avg_engagement_rate on an overlapping tag is materially below competitor performance on the same tag, that's a "same conversation, weaker hook" signal — frame as a hook/format issue, not a hashtag issue.
• Never recommend a hashtag the workspace already uses heavily (own_top_by_frequency frequency >= 4) as if it were new advice. Recommend NEW tags or REINFORCE existing winners — not both at once.
• Workspaces with empty hashtag_intel typically operate on X or Snapchat where hashtags don't drive distribution. In that case, skip hashtag mentions entirely; don't invent them.

═══ CULTURAL TIMING ═══

When cultural_calendar is present in the DATA:
• Treat upcoming cultural moments as first-class intelligence — not optional colour.
• If urgency is 'immediate': the brief's first or second action MUST address it. A brand that misses a cultural moment its competitors are riding is a real risk.
• If urgency is 'this_week': include at least one action or signal. Frame as a time-sensitive window.
• If urgency is 'upcoming': include as a strategic action. Give specific preparation advice, not vague "plan ahead" language.
• Reference the event by name. State how many days away it is. Recommend a specific content type.
• If the workspace category is in the event's category_boost list, weight the recommendation as higher priority.
• Do not surface cultural moments the brand has no plausible way to connect with (e.g. a B2B SaaS brand and Valentine's Day in a conservative market). Use judgement.

Final reminder: this brief lands in someone's inbox at 6 AM. They have coffee in one hand and 90 seconds. Earn that 90 seconds. If your verdict could have been written without seeing their data, it's wrong. Rewrite it.`;

// Tone presets layered on top of the base prompt. Per-workspace override
// via workspace.brief_tone; otherwise we pick a default from the tier
// (creators get 'encouraging', brand/agency get 'strategic').
const TONE_GUIDANCE = {
  analytical: `
═══ TONE OVERRIDE: ANALYTICAL ═══
Lead with the numbers. Every claim must reference a specific metric with the
exact value (e.g. "21,318 views, 11.4× catalogue median"). Minimise narrative
framing. Keep verdict body to 1-2 dense sentences of data observations. Cut
hype words ("strong", "great", "amazing"). Prefer percentages, ratios, and
absolute counts over adjectives.`,

  strategic: `
═══ TONE OVERRIDE: STRATEGIC ═══
Default balance. Numbers ground every claim, but the verdict argues a thesis
and the actions tie the numbers to a strategic move. Keep insights specific —
the goal is "this is what the data means and what to do" not "the data is X".`,

  executive: `
═══ TONE OVERRIDE: EXECUTIVE ═══
Brief reads like a one-paragraph memo to a CMO. Verdict body: 1-2 sentences
maximum. Each action: a single sentence, decision-first. Drop preamble, drop
hedging, drop "consider" / "you might". State the move. The data is in the
signals — the verdict is the call to make.`,

  encouraging: `
═══ TONE OVERRIDE: ENCOURAGING ═══
For solo creators who often stare at analytics and feel discouraged. Be the
partner who's already seen tomorrow's win.

THE RULE OF POSITIVE DELTA — never state a negative metric without
immediately pairing it with the opening it points to. "Views dipped 12%
week-over-week, but your save-rate climbed to 4.1% on the same posts —
the right people are watching." A dip is always a setup for a move.

OPPORTUNITY-FIRST FRAMING — lead each action with the door it opens, not
the gap it closes. Right: "Your audience clearly wants the mid-video
deep-dive — trim the next intro to 15 seconds and that retention spike
comes right back." Wrong: "Your intros are too long."

LANGUAGE — replace "lacking" with "untapped", "underperforming" with "in
its growth phase", "failure" with "still refining", "weak" with "warming
up". The data isn't a verdict on the creator; it's pointing at the next
move.

PERSPECTIVE — speak as the coach looking ahead to the 9 AM win, not a
judge ranking last week's stats. The verdict and actions should land like
"here's the door you can walk through today", not "here's where you fell
short". The honesty about thin data from the base prompt still applies —
encouragement never means inventing wins. When the data is thin, frame the
foundation work as the unlock it actually is.

KEEP — every quantitative specificity rule from the base prompt. Real
numbers. Real post titles. Real platform names. The encouragement comes
from the framing, never from softer or vaguer data.

VERBOSITY — medium-high. Give the verdict body and action bodies room to
breathe so the opening feels real, not clipped. Signals stay tight.`,
};

// ── Language + Cultural Intelligence context ─────────────────────────────────
// Returns a prompt block injected into every brief generation.
// Tells the AI:
//   1. What language(s) the content is likely in
//   2. How to analyse non-English content with proper depth
//   3. What cultural register and signals matter for this market
//   4. What language to write the brief output in
//
// This is the core of Mashal's global intelligence — not translation,
// but genuine cultural comprehension baked into every analysis.

const LANGUAGE_PROFILES = {
  SA: {
    name: 'Saudi Arabia',
    content_languages: ['Arabic (Gulf dialect)', 'English'],
    primary: 'ar',
    dialect_note: 'Saudi Khaleeji Arabic as spoken on Snapchat and TikTok — everyday register, not Modern Standard Arabic (Fusha). Read captions in their native dialect and write any Arabic in the brief in the same spoken Khaleeji register (e.g. "وش رايك", "تو", "يعطيك العافية" — not Fusha equivalents like "ما رأيك", "الآن"). Fusha reads as press-release voice and is wrong here unless the workspace itself publishes in Fusha.',
    cultural_signals: [
      'Ramadan content windows (pre-Ramadan hype, daily iftar posts, Laylat al-Qadr peak, Eid surge)',
      'Saudi National Day 23 September — patriotic content peaks sharply',
      'White Friday (November) — Saudi equivalent of Black Friday, highest e-commerce conversion window',
      'Eid Al-Fitr and Eid Al-Adha — gifting, fashion, food categories spike',
      'Arabic-first captions consistently outperform bilingual on engagement in this market',
      'Snapchat has unusually strong penetration — weight it appropriately',
      'Prayer times affect posting windows — post-Maghrib is peak scroll time',
    ],
    platform_notes: 'TikTok ad reach exceeds adult population. Snapchat Stories outperform Feed. Instagram skews female with high social commerce activity.',
  },
  AE: {
    name: 'United Arab Emirates',
    content_languages: ['Arabic', 'English'],
    primary: 'bilingual',
    dialect_note: 'UAE audience is highly bilingual and multicultural. Arabic content lives in spoken Khaleeji register with frequent English loanwords ("meeting", "deal", "launch") — not Fusha. Dubai-style code-switching is normal and expected. English content is equally valid, with a casual professional register. Bilingual captions typically outperform single-language. When writing Arabic in the brief, use the everyday Khaleeji speech the user would send in a WhatsApp message, not press-release Arabic.',
    cultural_signals: [
      'UAE National Day 2 December — high patriotic content engagement',
      'Dubai Shopping Festival (January) — retail and luxury peak',
      'Expo and major events drive content spikes',
      'Ramadan and Eid windows',
      'Aspirational and premium positioning outperforms discount-led copy',
    ],
    platform_notes: 'Highest Instagram ad reach in the region. LinkedIn unusually strong for B2B. TikTok purchasing power per viewer is high.',
  },
  KW: {
    name: 'Kuwait',
    content_languages: ['Arabic (Gulf dialect)', 'English'],
    primary: 'ar',
    dialect_note: 'Kuwaiti Khaleeji Arabic in its spoken everyday form — the way it lands in TikTok captions and Snapchat stories, not Fusha. Influencer endorsements carry disproportionate weight here; the brief should sound like advice from someone in the user\'s circle, not a press release. Analyse for influencer collaboration signals.',
    cultural_signals: [
      'Ramadan and Eid windows',
      'National Day 25 February and Liberation Day 26 February — back-to-back public holiday period',
      'Arabic-first content. Cultural humour and family scenarios outperform product-only posts',
    ],
    platform_notes: 'Highest per-capita Instagram penetration globally. Snapchat dominant for under-25.',
  },
  QA: {
    name: 'Qatar',
    content_languages: ['Arabic (Gulf dialect)', 'English'],
    primary: 'ar',
    dialect_note: 'Qatari Khaleeji Arabic in everyday spoken register, not Fusha. Sports and events carry high cultural weight (World Cup legacy, PSG connection). Multicultural expat audience means English is also viable — when in English, conversational professional register, not formal corporate.',
    cultural_signals: [
      'National Day 18 December',
      'Ramadan and Eid windows',
      'Sports events drive significant engagement spikes',
    ],
    platform_notes: 'High social media penetration. Instagram and TikTok primary.',
  },
  EG: {
    name: 'Egypt',
    content_languages: ['Arabic (Egyptian dialect)'],
    primary: 'ar',
    dialect_note: 'Egyptian Arabic in its everyday spoken form (Masri / ammiya) — the way it lives in cafe conversations and Reels captions, NOT Fusha. Words like "إزيك", "خالص", "بقى", "كده" belong; their Fusha equivalents read as stiff. Egyptian dialect is the most widely understood Arabic dialect across the region. Comedy and relatable everyday content travel furthest. Affordable/value framing strongly outperforms premium positioning.',
    cultural_signals: [
      'Ramadan is the single biggest content window in Egypt — TV, social, and ad spend all peak',
      'Eid windows for gifting and fashion',
      'Egyptian National Day and football (soccer) events drive spikes',
      'Value and affordability messaging resonates strongly given economic context',
    ],
    platform_notes: 'Facebook still primary for adults 30+. TikTok dominant for youth. YouTube strong for long-form.',
  },
  PK: {
    name: 'Pakistan',
    content_languages: ['Urdu', 'English', 'Regional languages (Punjabi, Sindhi, Pashto)'],
    primary: 'ur',
    dialect_note: 'Conversational urban Urdu as spoken in Karachi, Lahore, and Islamabad — the everyday register people actually use in WhatsApp voice notes and TikTok captions. NOT literary or formal Urdu (Adabi Urdu reads as 9 PM news anchor and is wrong for social media). Natural English code-switching is expected and welcome ("yaar", "bhai", "literally", "vibe", "scene" sit naturally in Urdu sentences and should not be translated out). Roman Urdu is acceptable in captions but the brief itself should be in proper Urdu script. Cricket references, family occasions, and food content are reliable engagement drivers across all regions.',
    cultural_signals: [
      'Pakistan Day 23 March and Independence Day 14 August — patriotic content peaks',
      'Ramadan and both Eid windows',
      'Cricket match days (especially Pakistan vs India) — single highest engagement spikes',
      'Wedding season (October–December and April–May) — fashion, jewellery, food, decor all peak',
      'Basant (regional) and other cultural festivals vary by province',
    ],
    platform_notes: 'TikTok dominant daily active. Facebook primary for 25+. YouTube strong for Urdu-language content. Instagram urban-skewed.',
  },
  IN: {
    name: 'India',
    content_languages: ['Hindi', 'English', 'Regional languages (Tamil, Telugu, Marathi, Bengali, Kannada)'],
    primary: 'hi',
    dialect_note: 'Everyday conversational Hindi as spoken in Mumbai/Delhi/Bengaluru — Hinglish code-switching is normal and expected ("matlab", "bhai", "actually", "literally", "bro" all sit naturally in Hindi sentences and should not be translated out). NOT shuddh Hindi or Sanskritised Hindi — that reads as Doordarshan news and is wrong for creator content. India is linguistically diverse: regional-language Reels reach 5–8× equivalent English content in their respective states. Analyse captions in their actual language; do not default to treating all Indian content as Hindi.',
    cultural_signals: [
      'Diwali (October/November) — largest gifting and retail window',
      'Holi (March)',
      'Raksha Bandhan, Dussehra, Navratri',
      'IPL cricket season (March–May) — massive engagement spike across categories',
      'Independence Day 15 August and Republic Day 26 January',
      'Wedding season (November–February)',
      'Regional festivals (Onam, Pongal, Bihu, Durga Puja) matter enormously in their states',
    ],
    platform_notes: 'Largest YouTube market globally. Instagram Reels driving highest reach. TikTok banned — replaced by Instagram Reels and YouTube Shorts.',
  },
  TR: {
    name: 'Turkey',
    content_languages: ['Turkish'],
    primary: 'tr',
    dialect_note: 'Turkish is the primary language. Content humour and storytelling have a distinct register — sarcasm and dry wit travel well. National pride content performs strongly around key dates.',
    cultural_signals: [
      'Republic Day 29 October',
      'Victory Day 30 August',
      'Ramadan and Eid windows (Turkey is majority Muslim)',
      'Summer season (June–August) — tourism, fashion, outdoor content peaks',
    ],
    platform_notes: 'Instagram very strong. TikTok growing rapidly. YouTube significant. Twitter/X has cultural relevance for opinion-forming content.',
  },
  BR: {
    name: 'Brazil',
    content_languages: ['Portuguese (Brazilian)'],
    primary: 'pt-BR',
    dialect_note: 'Brazilian Portuguese is distinct from European Portuguese in vocabulary, humour register, and cultural references. Do not treat them as equivalent. Brazilian content is high-energy, humour-forward, and community-oriented.',
    cultural_signals: [
      'Carnaval (February/March) — highest cultural engagement window of the year',
      'Festa Junina (June) — popular culture moment',
      'Black Friday (November) — Brazilian retail has fully adopted this',
      'Brazilian Independence Day 7 September',
      'Football (soccer) — any major Brazil match drives content spikes across all categories',
    ],
    platform_notes: 'Instagram and TikTok dominant. YouTube significant. WhatsApp key for community commerce (not directly trackable but important context).',
  },
  ID: {
    name: 'Indonesia',
    content_languages: ['Bahasa Indonesia', 'Javanese', 'Sundanese'],
    primary: 'id',
    dialect_note: 'Bahasa gaul — the everyday spoken Indonesian used on TikTok and Reels, NOT formal Bahasa Indonesia baku. Words like "banget", "sih", "kak", "anjir", "gue/lo" (Jakarta) or "aku/kamu" (Java) belong in the natural register; the formal "saya/anda" reads as government memo and is wrong for creator content. Local-language captions are essential — English content severely underperforms. TikTok Shop is a dominant commerce channel; live shopping during Maghrib (sunset) converts highest.',
    cultural_signals: [
      'Ramadan and Eid Al-Fitr (Lebaran) — single largest commerce window in Indonesia',
      'Harbolnas 12.12 (December 12) — Indonesia\'s largest online shopping day',
      '11.11 Singles Day',
      'Independence Day 17 August',
      'Batik Day 2 October — cultural pride content',
    ],
    platform_notes: 'Largest TikTok user base outside the US. TikTok Shop dominant commerce path. Instagram Reels strong. Facebook significant for older demographics.',
  },
  CA: {
    name: 'Canada',
    content_languages: ['English', 'French (Quebec)'],
    primary: 'en',
    dialect_note: 'English is primary in most provinces. Quebec French is a completely distinct market with its own cultural references, humour, and content preferences — do not treat Quebec French as European French.',
    cultural_signals: [
      'Canada Day 1 July',
      'Thanksgiving (second Monday of October — not November)',
      'Black Friday and Cyber Monday (November)',
      'Back to school (late August/September)',
      'Winter holiday season (December)',
      'Hockey playoff season (April–June) — national engagement event',
    ],
    platform_notes: 'Instagram, TikTok, and YouTube primary. LinkedIn active for professional/B2B. Snapchat relevant for under-25.',
  },
  US: {
    name: 'United States',
    content_languages: ['English', 'Spanish'],
    primary: 'en',
    dialect_note: 'English primary. Spanish content reaches a large and underserved audience on most platforms. Native vertical video without heavy branding consistently outperforms polished brand content.',
    cultural_signals: [
      'Super Bowl (February)',
      'Valentines Day, St. Patrick\'s Day, Easter',
      'Memorial Day weekend (late May)',
      'Fourth of July',
      'Labor Day (early September)',
      'Halloween (October)',
      'Thanksgiving (fourth Thursday November)',
      'Black Friday / Cyber Monday / holiday season',
    ],
    platform_notes: 'Highest TikTok watch-time of any market. Instagram Reels reach plateauing — carousels performing well. YouTube Shorts growing.',
  },
  GB: {
    name: 'United Kingdom',
    content_languages: ['English'],
    primary: 'en',
    dialect_note: 'British English register. Dry and observational humour travels far. US-style hyperbole reads as inauthentic to British audiences — avoid it.',
    cultural_signals: [
      'Bank holidays (Easter, May bank holidays, August bank holiday)',
      'Black Friday (November — fully adopted)',
      'Christmas and Boxing Day',
      'Back to school (September)',
      'Football (Premier League season September–May)',
      'Wimbledon (June–July)',
    ],
    platform_notes: 'Instagram Reels outpacing Feed. TikTok strong for beauty and lifestyle. YouTube long-form strong. LinkedIn significant B2B market.',
  },
};

// Fallback for countries not yet in the profiles above.
// Instructs the AI to do its best based on detected language.
const GENERIC_LANGUAGE_PROFILE = {
  name: 'Global',
  content_languages: ['Detected from content'],
  primary: 'en',
  dialect_note: 'Detect the language of each caption and analyse it in its native language. Do not assume English. If captions are in a non-English language, assess them for cultural meaning, tone, and local engagement signals in that language.',
  cultural_signals: [
    'Religious and national holidays relevant to the content language',
    'Local sports and cultural events',
    'Seasonal commerce windows',
  ],
  platform_notes: 'Apply platform-specific knowledge for the detected market.',
};

export function buildLanguageContext(workspace) {
  const country = (workspace?.country || 'GLOBAL').toUpperCase();
  const briefLanguage = workspace?.brief_language || 'en';

  const profile = LANGUAGE_PROFILES[country] || GENERIC_LANGUAGE_PROFILE;

  // Output language instruction
  const outputLanguageMap = {
    en:    'English',
    ar:    'Arabic',
    fr:    'French',
    tr:    'Turkish',
    ur:    'Urdu',
    'pt-BR': 'Brazilian Portuguese',
    id:    'Bahasa Indonesia',
    hi:    'Hindi',
    es:    'Spanish',
  };
  const outputLang = outputLanguageMap[briefLanguage] || 'English';

  // Spoken-register rules — applied whenever the brief is being written in
  // a language with a meaningful formal/spoken split. The default formal
  // register of most LLMs (Fusha Arabic, literary Urdu, shuddh Hindi,
  // baku Indonesian, European Portuguese forms) reads as press-release
  // voice on social media and is wrong for creator/brand briefs.
  const REGISTER_RULES = {
    ar:    'Use everyday spoken Arabic matching the market dialect (Khaleeji for GCC, Egyptian for Egypt, Levantine for the Levant) — NEVER Modern Standard Arabic (Fusha). Fusha is for press releases; the brief lands on a phone and must sound like a sharp friend talking, not a news anchor reading. Match the workspace\'s own caption dialect when in doubt.',
    ur:    'Use conversational urban Urdu (Karachi/Lahore register) — NEVER literary or formal Adabi Urdu. Allow natural English code-switching where it fits ("yaar", "bhai", "literally", "scene") — do not strip these out and do not translate them. Urdu script in output, but the cadence should be spoken-Urdu, not written-formal.',
    hi:    'Use conversational Hinglish — everyday Hindi with natural English code-switching ("matlab", "bhai", "literally", "actually"). NEVER shuddh Hindi or Sanskritised Hindi — that reads as Doordarshan and is wrong for creators. Devanagari script, but the voice should sound like a Mumbai/Delhi WhatsApp message, not a government textbook.',
    id:    'Use bahasa gaul — everyday Indonesian. NEVER formal "saya/anda" register. Particles like "sih", "banget", "kak", "dong" belong where they fit. The brief should sound like a Jakarta TikTok creator talking, not a government memo.',
    tr:    'Use everyday spoken Turkish, the register used on Instagram and TikTok — not literary or formal Turkish. Dry observational humour is welcome where the data supports it.',
    'pt-BR': 'Use Brazilian colloquial Portuguese — gírias, contractions, and the warm community register of Brazilian social media. NEVER European Portuguese forms (você over tu, não over não, etc.). High-energy and humour-forward where the data supports it.',
    fr:    'Use everyday conversational French as spoken in the relevant market (Quebec French if Canadian Quebec workspace, otherwise standard conversational French) — not academic or formal register.',
    es:    'Use everyday conversational Spanish matching the market dialect when discernible. Avoid overly formal register; social media Spanish is closer to spoken than written.',
  };
  const registerRule = REGISTER_RULES[briefLanguage];
  const registerBlock = registerRule
    ? `\n\nSPOKEN REGISTER (CRITICAL):\n${registerRule}\nIf the workspace\'s own captions show a more formal register than the everyday default, match THAT instead — see VOICE MIRRORING in the system prompt. The rule above is the baseline when the workspace\'s voice is ambiguous or absent.`
    : '';

  const outputInstruction = briefLanguage === 'en'
    ? ''
    : `\nOUTPUT LANGUAGE — Write the entire brief (verdict title, verdict body, all action titles and bodies, all signal titles and bodies) in ${outputLang}. All data labels (platform names, numbers, percentages) remain unchanged. Do not mix languages within a single field.${registerBlock}`;

  return `
═══ LANGUAGE & CULTURAL INTELLIGENCE ═══

MARKET: ${profile.name}
CONTENT LANGUAGES: ${profile.content_languages.join(', ')}

LANGUAGE ANALYSIS RULES:
• Read every caption in its actual language. Do not skip or summarise non-English captions.
• ${profile.dialect_note}
• When referencing post content in the brief, use the original language for titles/quotes, then provide context in the brief language.
• Assess engagement patterns, tone, and cultural resonance through the lens of this market — not through an English-language filter.
• Detect when content is deliberately bilingual and note whether this is helping or hurting based on the market profile above.

CULTURAL SIGNALS TO WATCH:
${profile.cultural_signals.map(s => `• ${s}`).join('\n')}

PLATFORM CONTEXT FOR THIS MARKET:
${profile.platform_notes}

CULTURAL TIMING: If any of the above cultural windows are within 3 weeks, the brief MUST include at least one action or signal addressing it. Do not wait for the brand to post about it first — surface the upcoming window proactively.
${outputInstruction}`;
}

// Resolve the tone for a workspace.
//
// Creator-tier always gets the encouraging coach tone. Migration 012
// gave brief_tone a NOT NULL default of 'strategic', and the ToneSwitcher
// UI is currently agency-only — so a Creator-tier row's brief_tone is
// never an "explicit choice", it's just the column default. We hijack
// that for them. If/when Creator tier gets the ToneSwitcher exposed,
// revisit this branch and let an explicit non-default value win.
//
// Brand/Agency: honour an explicit workspace.brief_tone if it maps to a
// known preset, otherwise the launch-default 'strategic'.
function resolveTone(workspace) {
  if (workspace?.tier === 'creator') return 'encouraging';
  const explicit = workspace?.brief_tone;
  if (explicit && TONE_GUIDANCE[explicit]) return explicit;
  return 'strategic';
}

function buildUserMessage(payload, tone, workspace) {
  const toneBlock = TONE_GUIDANCE[tone] ? `\n${TONE_GUIDANCE[tone]}\n` : '';
  // Language + cultural intelligence block. Tells the model what language
  // the content is in, how to read it through the right cultural lens,
  // and what language to write the brief output in.
  const langBlock = buildLanguageContext(workspace);
  // Natural-language nudge for ad intelligence. Only attached when the
  // workspace has configured Ad Intelligence settings + has ad data —
  // buildAdsIntelPrompt returns '' otherwise. Sits BELOW the JSON payload
  // so the model treats it as additional guidance, not data to summarise.
  const adsBlock = buildAdsIntelPrompt(payload.ads_intel);
  const adsTail = adsBlock ? `\n\n${adsBlock}` : '';
  return `Generate today's Mashal brief for this workspace.${toneBlock}${langBlock}\nDATA:\n${JSON.stringify(payload, null, 2)}${adsTail}\n\nReturn the JSON only.`;
}

// Re-export the prompt-building flow so the compare-models endpoint can
// run the identical prompt without copying internal logic. Tone is read
// from the workspace and threaded into the user message.
export function buildBriefPrompt({ workspace, accounts, posts, snapshots, competitors }) {
  const payload = buildPayload({ workspace, accounts, posts, snapshots, competitors });
  return { system: SYSTEM_PROMPT, user: buildUserMessage(payload, resolveTone(workspace), workspace) };
}

// Brief-kind signal rows that make up "the current morning brief". These are
// replaced wholesale on each generation; live-signal rows (kind='live') are an
// independent append-only feed and are never touched here.
const BRIEF_KINDS = [
  'verdict', 'action',
  // Original kinds
  'viral', 'gap', 'collab', 'engagement', 'warning', 'audience', 'timing', 'trend',
  // Cross-platform content-intelligence kinds (migration 005)
  'cross_platform_gap', 'missed_crosspost', 'series_arc',
  'hook_pattern', 'collaboration_multiplier', 'engagement_velocity',
  'caption_language_split',
];

// Soft-delete the prior morning brief so the dashboard reads the latest one.
async function clearPriorBrief(workspaceId) {
  await supabase.update('signals',
    { is_read: true },
    { eq: { workspace_id: workspaceId }, in: { kind: BRIEF_KINDS } }
  ).catch(() => {});
}

// When a scheduled brief can't be generated (no connected accounts, or no posts
// synced yet) we must NOT leave yesterday's brief sitting unread — the dashboard
// would render it as "today's brief" and it looks stale (this is exactly the
// "showing data from two days prior" report). Instead clear the prior brief and
// drop a single honest, dated verdict so every workspace still gets a fresh 6am
// card that explains what's happening. Best-effort: a failure here just leaves
// the prior state untouched.
async function writeNoDataBrief(workspace, reason) {
  await clearPriorBrief(workspace.id);
  const now = new Date().toISOString();
  const copy = reason === 'no_accounts'
    ? {
        title: 'Connect an account to get your first brief',
        body: 'No connected accounts on this workspace yet. Connect Instagram, TikTok, or YouTube in Settings and your first daily brief lands at 6am the next morning.',
        action: 'Connect an account',
      }
    : {
        title: 'No new activity to analyze this morning',
        body: 'We couldn’t find any posts to analyze for your connected accounts in this run. This usually clears once your latest posts finish syncing and your next brief will pick them up. If it keeps happening, re-check your connected accounts in Settings.',
        action: 'Review accounts',
      };
  await supabase.insert('signals', [{
    workspace_id: workspace.id,
    kind: 'verdict',
    platform: 'all',
    title: copy.title,
    body: copy.body,
    impact: 'Setup',
    action: copy.action,
    is_series: false,
    model_used: null,
    latency_ms: null,
    tokens_used: null,
    metadata: { generated_at: now, model: null, intel_score: null, status: reason, no_data: true },
  }]).catch((e) => console.warn('[intelligence] no-data brief insert failed:', e.message));
}

// Confirm a workspace is genuinely empty — with direct count queries that THROW
// on error rather than silently resolving to [] — before replacing its brief, so
// a transient failure in the bulk data fetch can never wipe a good brief. Then
// drop the appropriate no-data card. No-op when the counts come back non-empty.
async function handleInsufficientData(workspace) {
  let acctChk, postChk;
  try {
    [acctChk, postChk] = await Promise.all([
      supabase.select('connected_accounts', { select: 'id', eq: { workspace_id: workspace.id, is_active: true }, limit: 1 }),
      supabase.select('posts', { select: 'id', eq: { workspace_id: workspace.id }, limit: 1 }),
    ]);
  } catch (e) {
    console.warn(`[intelligence] insufficient_data confirm failed for ws=${workspace.id}, leaving brief intact: ${e.message}`);
    return;
  }
  if (!acctChk?.length) await writeNoDataBrief(workspace, 'no_accounts');
  else if (!postChk?.length) await writeNoDataBrief(workspace, 'no_posts');
  // else: data actually exists — the bulk fetch glitched; leave the brief intact.
}

// ── Persist generated brief into signals table ─────────────────────────────────
async function persist({ workspace, brief, intelScore, usage, model, modelUsed, latencyMs, tokensUsed }) {
  // Soft-delete prior BRIEF rows (verdict/action/standard signals) so the
  // screen reads today's brief. Live-signal rows (kind='live') are kept —
  // they're an independent append-only feed and shouldn't be invalidated
  // when a new morning brief lands.
  await clearPriorBrief(workspace.id);

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

  // PostgREST (Supabase REST) requires every row in a bulk insert to have
  // the EXACT same set of keys — otherwise it returns "All object keys
  // must match" (PGRST102). So every row below must carry is_series.

  // Verdict
  rows.push({
    workspace_id: workspace.id,
    kind: 'verdict',
    platform: 'all',
    title: brief.verdict?.title || 'Brief generated',
    body: brief.verdict?.body || '',
    impact: 'High Impact',
    action: 'Read brief',
    is_series: false,
    ...provenance,
    metadata: {
      ...baseMeta,
      score_factors: brief.score_factors || [],
      formula: brief.formula || null,
      rewrite: brief.rewrite || null,
    },
  });

  // Actions
  (brief.actions || []).slice(0, 6).forEach((a, i) => {
    rows.push({
      workspace_id: workspace.id,
      kind: 'action',
      platform: 'all',
      title: a.title || `Action ${i + 1}`,
      body: a.body || '',
      impact: a.when || 'Today',
      action: a.cta || 'Open →',
      is_series: false,
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
    try {
      await supabase.insert('signals', rows);
    } catch (e) {
      // Bubble up so the generate endpoint can surface "we generated a brief
      // but couldn't persist it" instead of returning success and leaving
      // the dashboard empty. The most common cause is a schema CHECK
      // constraint on signals.kind that doesn't know about new kinds —
      // run the latest migrations.
      const err = new Error(`Brief insert failed: ${e.message}`);
      err.persist_failed = true;
      err.body = e.body;
      throw err;
    }
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
  // Pull what we need to compare against the user's baseline. The
  // inbox_events read is best-effort — the table only exists once
  // migrations/006 is applied; on older DBs it returns [] and the
  // comment-burst pattern simply doesn't fire.
  const [posts, snapshots, existingLive, inboxEvents] = await Promise.all([
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
    supabase.select('inbox_events', {
      select: 'id,post_id,kind,author_handle,received_at',
      eq: { workspace_id: workspace.id, status: 'pending' },
      order: 'received_at.desc', limit: 200,
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

  // Pattern 4 — comment burst from inbox webhooks. When a single post
  // collects 10+ webhook-delivered comments in the last 2 hours, surface
  // an engagement_velocity signal urging the user to reply now (the
  // platform algorithm boosts posts whose authors engage with their own
  // comment thread). Counts only comment_* event kinds; DMs are handled
  // separately.
  const twoHoursAgo = Date.now() - 2 * 3600000;
  const commentsByPost = new Map();
  for (const e of (inboxEvents || [])) {
    if (!e.post_id) continue;
    if (!/^comment/i.test(e.kind || '')) continue;
    if (new Date(e.received_at).getTime() < twoHoursAgo) continue;
    commentsByPost.set(e.post_id, (commentsByPost.get(e.post_id) || 0) + 1);
  }
  for (const [postId, count] of commentsByPost.entries()) {
    if (count < 10) continue;
    const key = `comment_burst_${postId}`;
    if (existingKeys.has(key)) continue;
    const p = (posts || []).find(x => x.id === postId);
    if (!p) continue;
    out.push({
      workspace_id: workspace.id,
      kind: 'live',
      label: 'Reply now',
      platform: p.platform,
      title: `${count} new comments on a post in 2 hours`,
      body: `${(p.caption || 'A post').slice(0, 140)} just collected ${count} comments. Replying in the next hour extends algorithmic reach.`,
      impact: 'High Impact',
      action: 'Open thread',
      is_read: false,
      generated_at: new Date().toISOString(),
      metadata: { dedup_key: key, post_id: postId, type: 'comment_burst', count },
    });
  }

  if (out.length) {
    await supabase.insert('signals', out).catch(() => {});
  }

  // Mark consumed inbox events as processed so they don't trigger again
  // on the next live-signals run. Best-effort.
  const consumedIds = (inboxEvents || []).map(e => e.id).filter(Boolean);
  if (consumedIds.length) {
    await supabase.update('inbox_events',
      { status: 'processed' },
      { in: { id: consumedIds } }
    ).catch(() => {});
  }

  return { new: out.length, checked: posts.length, inbox: inboxEvents?.length || 0 };
}

// `manual` distinguishes a user-initiated regeneration (counts toward the
// monthly quota — usage_log.run_type = 'intelligence') from a system-fired
// regeneration (cron, Agency session-start auto-regen, first-brief bootstrap
// — usage_log.run_type = 'intelligence_auto', excluded from the counter).
// Defaults to true so callers that haven't been updated still record as
// user runs; auto-fire paths must pass { manual: false } explicitly.
export async function generateBrief(workspace, { manual = true } = {}) {
  // Cap-gate user-initiated runs only. System-fired runs (cron, session
  // auto-regen, first-brief bootstrap) are free — they record as
  // 'intelligence_auto' and don't count toward or against the quota.
  if (manual) {
    const cap = await checkUsageCap(workspace);
    if (cap.exceeded) return capExceededPayload(cap);
  }

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
    const reason = !accounts?.length ? 'no_accounts' : 'no_posts';
    console.warn(`[intelligence] skip ws=${workspace.id} insufficient_data accounts=${accounts?.length || 0} posts=${posts?.length || 0}`);
    // Don't leave the previous brief unread (it would render as "today's" and
    // look stale) — replace it with an honest, dated no-data card instead.
    await handleInsufficientData(workspace);
    return { skipped: 'insufficient_data', reason, accounts: accounts?.length || 0, posts: posts?.length || 0 };
  }

  // 2) Deterministic intel score
  const intelScore = computeIntelScore({ accounts, posts, snapshots });

  // 3) Ad intelligence — runs for Brand/Agency workspaces with ads + a
  // configured workspace_ad_settings row. Non-fatal: if the DB is slow
  // or settings aren't configured, buildAdsIntel returns intel:null and
  // the prompt skips the ad block.
  const adsIntel = await computeAdsIntelForBrief(workspace, posts);

  // 4) Build prompt
  const payload = buildPayload({ workspace, accounts, posts, snapshots, competitors, contentPieces, seriesRows, adsIntel });

  // 4) Call the AI router (Gemini-only during this phase). Tone is
  //    resolved from workspace.brief_tone first, then by tier — Creator
  //    defaults to 'encouraging', Brand/Agency to 'strategic'.
  const tone = resolveTone(workspace);
  const result = await generateIntelligence({
    system: SYSTEM_PROMPT,
    user:   buildUserMessage(payload, tone, workspace),
    max_tokens: 6000,
    temperature: 0.6,
  });

  const brief = parseJsonResponse(result.text);
  if (!brief) {
    return { error: 'LLM returned unparseable output', raw: result.text?.slice(0, 500) };
  }

  // 5) Persist (with per-row provenance: model_used / latency_ms / tokens_used)
  try {
    await persist({
      workspace, brief, intelScore,
      usage: result.usage,
      model: result.raw_model,
      modelUsed: result.model_used,
      latencyMs: result.latency_ms,
      tokensUsed: result.tokens_used,
    });
  } catch (e) {
    return {
      error: 'persist_failed',
      message: e.message,
      details: e.body,
      model_used: result.model_used,
      brief_preview: { verdict: brief.verdict?.title, signals: brief.signals?.length || 0 },
    };
  }

  // 6) Log usage. The legacy usage_log table has `run_at timestamptz`
  //    as a required column without a default — leaving it off made
  //    every insert silently fail (we used to swallow the error with
  //    a no-op catch), which is why the monthly counter was pinned at
  //    zero even after several real briefs.
  await supabase.insert('usage_log', {
    workspace_id: workspace.id,
    run_type: manual ? 'intelligence' : 'intelligence_auto',
    platform: 'all',
    records_fetched: (brief.signals?.length || 0) + (brief.actions?.length || 0) + 1,
    cost_cents: result.cost_cents || 0,
    status: 'completed',
    run_at: new Date().toISOString(),
  }).catch(e => console.warn('[intelligence] usage_log insert failed:', e.message));

  // Fire-and-forget webhook dispatch. Subscribers to `brief_generated`
  // receive a POST with the verdict title, intel score, and counts.
  // Never awaited — if a receiver is slow or down, brief generation
  // doesn't block on it. Wrapped in a no-op catch to be doubly safe.
  dispatchWebhookEvent(workspace.id, 'brief_generated', {
    verdict_title: brief.verdict?.title || null,
    intel_score: intelScore,
    action_count: brief.actions?.length || 0,
    signal_count: brief.signals?.length || 0,
    model_used: result.model_used,
    workspace_name: workspace.name || null,
    workspace_tier: workspace.tier || null,
  }).catch(() => { /* non-fatal */ });

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

// ─── Streaming variant ────────────────────────────────────────────────────
// Same flow as generateBrief but yields raw text chunks as Gemini emits
// them. The caller (api/intelligence/stream.js) forwards each chunk to
// the browser as SSE so the verdict text starts appearing in ~1s instead
// of waiting 5-10s for the full JSON. Persistence happens after the
// stream completes — same persist() + usage_log path as the synchronous
// version, so the resulting database state is identical.
//
// Generator yields:
//   { phase: 'gathering' }                — initial signal
//   { phase: 'generating' }               — prompt built, calling Gemini
//   { chunk: '...' }                      — text chunk from Gemini
//   { phase: 'persisting' }               — full text received, parsing + writing
//   { done: true, summary: {...} } | { error: 'persist_failed', ... } | etc.
export async function* generateBriefStream(workspace, { manual = true } = {}) {
  // Cap-gate user-initiated runs. System-fired runs bypass — same
  // policy as generateBrief().
  if (manual) {
    const cap = await checkUsageCap(workspace);
    if (cap.exceeded) {
      yield capExceededPayload(cap);
      return;
    }
  }

  yield { phase: 'gathering' };

  const [accounts, posts, snapshots, competitors, contentPieces, seriesRows] = await Promise.all([
    supabase.select('connected_accounts', { select: '*', eq: { workspace_id: workspace.id } }).catch(() => []),
    supabase.select('posts', { select: '*', eq: { workspace_id: workspace.id }, order: 'posted_at.desc', limit: 200 }).catch(() => []),
    supabase.select('account_snapshots', { select: '*', eq: { workspace_id: workspace.id }, order: 'snapshot_date.desc', limit: 30 }).catch(() => []),
    supabase.select('competitors', { select: '*', eq: { workspace_id: workspace.id } }).catch(() => []),
    supabase.select('content_pieces', { select: '*', eq: { workspace_id: workspace.id }, order: 'first_posted_at.desc', limit: 60 }).catch(() => []),
    supabase.select('series', { select: '*', eq: { workspace_id: workspace.id }, order: 'last_entry_at.desc' }).catch(() => []),
  ]);

  if (!accounts?.length || !posts?.length) {
    const reason = !accounts?.length ? 'no_accounts' : 'no_posts';
    console.warn(`[intelligence/stream] skip ws=${workspace.id} insufficient_data accounts=${accounts?.length || 0} posts=${posts?.length || 0}`);
    await handleInsufficientData(workspace);
    yield { skipped: 'insufficient_data', reason, accounts: accounts?.length || 0, posts: posts?.length || 0 };
    return;
  }

  const intelScore = computeIntelScore({ accounts, posts, snapshots });
  const adsIntel = await computeAdsIntelForBrief(workspace, posts);
  const payload = buildPayload({ workspace, accounts, posts, snapshots, competitors, contentPieces, seriesRows, adsIntel });
  const tone = resolveTone(workspace);

  yield { phase: 'generating' };

  const startMs = Date.now();
  let fullText = '';
  let usage = {};
  let model = 'gemini-2.5-flash';

  // Inline the stream call here so we forward chunks one-for-one to the
  // browser. Importing geminiCallStream keeps the SSE-parsing logic in
  // gemini.js where it can be reused by other streaming callers later.
  try {
    for await (const ev of geminiCallStream({
      system: SYSTEM_PROMPT,
      user:   buildUserMessage(payload, tone, workspace),
      max_tokens: 6000,
      temperature: 0.6,
    })) {
      if (ev.chunk) {
        fullText += ev.chunk;
        yield { chunk: ev.chunk };
      } else if (ev.done) {
        usage = ev.usage || {};
        model = ev.model || model;
      }
    }
  } catch (e) {
    yield { error: 'generation_failed', message: e.message };
    return;
  }

  yield { phase: 'persisting' };

  const brief = parseJsonResponse(fullText);
  if (!brief) {
    yield { error: 'parse_failed', raw: fullText.slice(0, 500) };
    return;
  }

  const latency_ms = Date.now() - startMs;
  const tokens_used = (usage.input_tokens || 0) + (usage.output_tokens || 0);

  try {
    await persist({
      workspace, brief, intelScore,
      usage,
      model,
      modelUsed: 'gemini',
      latencyMs: latency_ms,
      tokensUsed: tokens_used,
    });
  } catch (e) {
    yield { error: 'persist_failed', message: e.message, details: e.body };
    return;
  }

  await supabase.insert('usage_log', {
    workspace_id: workspace.id,
    run_type: manual ? 'intelligence' : 'intelligence_auto',
    platform: 'all',
    records_fetched: (brief.signals?.length || 0) + (brief.actions?.length || 0) + 1,
    cost_cents: 0,
    status: 'completed',
    run_at: new Date().toISOString(),
  }).catch(e => console.warn('[intelligence/stream] usage_log insert failed:', e.message));

  // Same fire-and-forget webhook dispatch as the synchronous variant.
  // The stream consumer has already received the verdict text by the
  // time this runs, so we don't yield anything about the webhook.
  dispatchWebhookEvent(workspace.id, 'brief_generated', {
    verdict_title: brief.verdict?.title || null,
    intel_score: intelScore,
    action_count: brief.actions?.length || 0,
    signal_count: brief.signals?.length || 0,
    model_used: model,
    workspace_name: workspace.name || null,
    workspace_tier: workspace.tier || null,
  }).catch(() => { /* non-fatal */ });

  yield {
    done: true,
    summary: {
      verdict: brief.verdict?.title,
      actions: brief.actions?.length || 0,
      signals: brief.signals?.length || 0,
      intelScore,
      latency_ms,
      tokens_used,
    },
  };
}
