// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// Two detectors that run on every sync, both intelligence-free:
//
//   detectContentPieces — group posts that represent the same content
//                         across platforms (same caption fingerprint
//                         within ±48 hours). Writes content_pieces rows
//                         and updates posts.content_piece_id.
//
//   detectSeries        — group content pieces by numbered marker
//                         (Part N, Episode N, #N, Vol N). Writes series
//                         rows, links content_pieces.series_id,
//                         backfills posts.series_id, recomputes trend.
// ═════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase.js';

const CONTENT_WINDOW_MS = 48 * 3600 * 1000;   // ±48h: identical-caption cross-platform grouping
// Reworded-per-platform cross-posts — and platforms whose API hands back a
// different caption than the user typed (TikTok often returns its own
// title/description) — won't share an exact fingerprint. Measured on a real
// reworded pair, the FULL captions overlapped only ~0.35 Jaccard but the
// opening HOOK (first ~60 chars) overlapped ~0.56: creators keep the hook
// consistent across platforms even when they reword the body. So the fuzzy pass
// matches on the TITLE hook, never across different series numbers (Part 1 vs
// Part 2), for a platform the cluster lacks.
//
// The window was ±45min, which missed the common real-world pattern the
// operator flagged: the same upload cross-posted "the same day, within an
// hour" — a reworded caption 50min apart split into two single-platform pieces
// and the brief wrongly reported a "missed cross-post". Widened to ±90min so
// "within an hour" cross-posts (plus scheduling/clock lag) are caught, while
// still far tighter than the 48h identical-caption window so unrelated posts
// that merely share a theme don't merge.
const CROSSPOST_WINDOW_MS = 90 * 60 * 1000;   // ±90min for the fuzzy cross-platform pass
const TITLE_PREFIX_CHARS = 60;                 // hook length compared for fuzzy matching
const SIM_THRESHOLD = 0.45;                    // min Jaccard on title tokens (3+ token titles)
const SHORT_TITLE_TOKENS = 3;                  // below this, Jaccard is too coarse — see below

// ── Caption normalization ───────────────────────────────────────────────
// Strip markers + emojis + punctuation + collapse whitespace + lowercase,
// then take the first ~100 chars. Two posts on different platforms share a
// content piece when their fingerprints match. Captions that are very
// short normalize to empty and the post becomes its own content piece.
const SERIES_MARKER_RE = /\b(?:part|episode|ep|pt|volume|vol|chapter|day)\s*[#:.]?\s*\d+\b/gi;
const HASHTAG_MENTION_RE = /[#@][\p{L}\p{N}_.-]+/gu;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const PUNCT_RE = /[^\p{L}\p{N}\s]+/gu;

function fingerprint(caption) {
  if (!caption || typeof caption !== 'string') return '';
  const stripped = caption
    .replace(SERIES_MARKER_RE, ' ')   // remove "Part N" so series entries match
    .replace(/(?:^|\s)#\d+(?:\s|$)/g, ' ') // "#5"
    .replace(HASHTAG_MENTION_RE, ' ')
    .replace(EMOJI_RE, ' ')
    .replace(PUNCT_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  // First 100 normalized chars. Empty-string fingerprints (caption was just
  // emojis or hashtags) are returned as empty so callers can fall back to
  // the post id and avoid mis-grouping unrelated empty-caption posts.
  return stripped.slice(0, 100);
}

// Content-bearing tokens of a fingerprint (words 3+ chars). Drives the fuzzy
// cross-platform pass so the same upload links even when the caption differs
// across platforms.
function contentTokens(fp) {
  if (!fp) return new Set();
  return new Set(fp.split(' ').filter(t => t.length >= 3));
}

// Size of the intersection of two token sets: |A∩B|.
function intersize(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter;
}

// Jaccard similarity of two token sets: |A∩B| / |A∪B|. 0 when either is empty.
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  const inter = intersize(a, b);
  return inter / (a.size + b.size - inter);
}

// Detect the entry number for series matching. Returns { stem, number }
// when a marker is present, otherwise null.
const SERIES_PATTERNS = [
  /\b(part|episode|ep|pt|volume|vol|chapter|day)\s*[#:.]?\s*(\d+)\b/i,
  /(?:^|\s)#(\d+)(?:\s|$)/,
];
function seriesMatch(caption) {
  if (!caption) return null;
  for (const re of SERIES_PATTERNS) {
    const m = caption.match(re);
    if (m) {
      const number = Number(m[2] ?? m[1]);
      if (!Number.isFinite(number)) continue;
      const stem = fingerprint(caption); // marker already stripped
      if (!stem) continue;
      return { stem, number, marker: m[0] };
    }
  }
  return null;
}

// ── Content-piece detection ─────────────────────────────────────────────
// For each post in the workspace that has no content_piece_id yet, group
// by fingerprint + 48h window. Returns { created, linked, pieces }.
export async function detectContentPieces(workspace) {
  // Pull every post for this workspace. The detector is cheap relative to a
  // refresh and keeps the linkage consistent across historical backfills.
  const posts = await supabase.select('posts', {
    select: 'id,platform,caption,posted_at,views,content_piece_id',
    eq: { workspace_id: workspace.id, source: 'own' },
    order: 'posted_at.asc',
  }).catch(() => []);
  if (!posts?.length) return { created: 0, linked: 0, pieces: 0 };

  // Single-pass, time-ordered clustering. Each post joins an existing cluster
  // when it's the SAME content, otherwise it starts a new one. "Same content"
  // is decided by three tiers, strongest first — the time tolerance scales with
  // how strong the caption match is:
  //   Tier 1 — identical caption fingerprint within ±48h. Exact cross-posts and
  //            re-uploads of the same caption; generous window (same day+).
  //   Tier 2 — a platform the cluster lacks, within ±90min, no series clash,
  //            and TITLE-token Jaccard >= 0.45 (both titles 3+ tokens). The
  //            reworded-per-platform case ("medicine tracking app" on IG vs
  //            "complete medication tracking app" on TikTok): the full captions
  //            diverge (~0.35) but the hooks match (~0.56), so an exact match
  //            alone split them into two single-platform pieces and the brief
  //            wrongly reported a "missed cross-post".
  //   Tier 3 — same gates as Tier 2 but for SHORT titles (< 3 tokens), where
  //            Jaccard is too coarse: require the shorter title to sit entirely
  //            inside the longer one (2+ shared tokens). Catches brief captions
  //            ("new drop" ↔ "new drop today") the old 3-token floor dropped.
  // The tight ±90min window + title focus + series guard keep Tiers 2–3 from
  // merging distinct content that merely shares a series name or hashtags.
  const clusters = [];
  for (const p of posts) {
    const fp = fingerprint(p.caption);
    const titleTokens = contentTokens(fp.slice(0, TITLE_PREFIX_CHARS));
    const seriesNum = seriesMatch(p.caption || '')?.number ?? null;
    const ts = p.posted_at ? new Date(p.posted_at).getTime() : 0;
    let target = null;
    for (const c of clusters) {
      const dt = Math.abs(ts - c.anchorTs);
      // A different series entry number is never the same content — Part 1 and
      // Part 2 must not fuse even when they share a fingerprint. fingerprint()
      // strips the "Part N" marker on purpose (so series entries group under one
      // series), which makes templated episodes collide; this guard keeps that
      // stripping from bleeding into content-piece grouping. Applies to ALL
      // tiers, including the exact-fingerprint match.
      const seriesClash = seriesNum != null && c.seriesNum != null && seriesNum !== c.seriesNum;

      // Tier 1 — identical caption fingerprint. Wide window (same day+).
      if (fp && fp === c.fp && !seriesClash && dt <= CONTENT_WINDOW_MS) { target = c; break; }

      // Tiers 2 & 3 — reworded cross-post. Only for a platform the cluster
      // lacks, and only within the tight cross-post window.
      if (dt > CROSSPOST_WINDOW_MS || c.platforms.has(p.platform) || seriesClash) continue;

      // Tier 2 — both titles have enough tokens to trust a Jaccard overlap.
      if (titleTokens.size >= SHORT_TITLE_TOKENS
          && c.titleTokens.size >= SHORT_TITLE_TOKENS
          && jaccard(titleTokens, c.titleTokens) >= SIM_THRESHOLD) { target = c; break; }

      // Tier 3 — short caption: require the shorter title fully inside the
      // longer one (containment == 1), with at least two shared tokens.
      const minTokens = Math.min(titleTokens.size, c.titleTokens.size);
      if (minTokens >= 2 && intersize(titleTokens, c.titleTokens) === minTokens) { target = c; break; }
    }
    if (target) {
      target.posts.push(p);
      target.platforms.add(p.platform);
    } else {
      clusters.push({ fp, titleTokens, seriesNum, anchorTs: ts, platforms: new Set([p.platform]), posts: [p] });
    }
  }

  let created = 0, linked = 0;
  const livePieceIds = new Set();
  const postLinks = [];     // [{ post_id, piece_id }]
  const piecesToWrite = []; // clusters with no existing piece to reuse

  for (const cluster of clusters) {
    const cp = cluster.posts;
    const platforms = [...cluster.platforms];
    const totalViews = cp.reduce((s, p) => s + (p.views || 0), 0);
    const byViews = [...cp].sort((a, b) => (b.views || 0) - (a.views || 0));
    const best = byViews[0];
    const worst = byViews[byViews.length - 1];
    const firstPostedAt = cp
      .map(p => p.posted_at)
      .filter(Boolean)
      .sort((a, b) => String(a).localeCompare(String(b)))[0] || null;
    const title = (cp.find(p => p.caption)?.caption || '').slice(0, 80) || null;

    const aggregate = {
      fingerprint: cluster.fp || '',
      title,
      first_posted_at: firstPostedAt,
      detected_platforms: platforms,
      total_views: totalViews,
      best_platform: best?.platform || null,
      best_views: best?.views || 0,
      worst_views: worst?.views || 0,
      updated_at: new Date().toISOString(),
    };

    // Stable id: reuse a piece these posts already point to (keeps ids steady
    // and absorbs a previously-split piece into the merged one). Pick the id
    // the most posts already share.
    const idCounts = new Map();
    for (const p of cp) {
      if (p.content_piece_id) idCounts.set(p.content_piece_id, (idCounts.get(p.content_piece_id) || 0) + 1);
    }
    const pieceId = idCounts.size
      ? [...idCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
      : null;

    if (pieceId) {
      livePieceIds.add(pieceId);
      await supabase.update('content_pieces', aggregate, { eq: { id: pieceId } }).catch(() => {});
      for (const p of cp) {
        if (p.content_piece_id !== pieceId) postLinks.push({ post_id: p.id, piece_id: pieceId });
      }
    } else {
      piecesToWrite.push({ workspace_id: workspace.id, ...aggregate, _cluster: cp });
    }
  }

  // Insert brand-new pieces in one batch, then link their posts.
  if (piecesToWrite.length) {
    const toInsert = piecesToWrite.map(({ _cluster, ...rest }) => rest);
    const inserted = await supabase.insert('content_pieces', toInsert).catch(() => []);
    for (let i = 0; i < piecesToWrite.length; i++) {
      const id = inserted?.[i]?.id;
      if (!id) continue;
      created += 1;
      livePieceIds.add(id);
      for (const p of piecesToWrite[i]._cluster) postLinks.push({ post_id: p.id, piece_id: id });
    }
  }

  // Apply post → piece links. One-by-one: PostgREST can't take per-row values
  // in a batch update. ~50 posts/workspace/sync, well within the budget.
  for (const link of postLinks) {
    await supabase.update('posts',
      { content_piece_id: link.piece_id },
      { eq: { id: link.post_id } }).catch(() => {});
    linked += 1;
  }

  // Drop orphaned pieces — any content_piece for this workspace no longer
  // backed by a post (e.g. the losing half of a merge). Left alone they keep
  // their stale single-platform stats and re-emit the false missed-crosspost
  // signal, so they must go. Safe: nothing references them after re-linking.
  const allPieces = await supabase.select('content_pieces', {
    select: 'id', eq: { workspace_id: workspace.id },
  }).catch(() => []);
  for (const row of (allPieces || [])) {
    if (!livePieceIds.has(row.id)) {
      await supabase.delete('content_pieces', { eq: { id: row.id } }).catch(() => {});
    }
  }

  return { created, linked, pieces: clusters.length };
}

// ── Series detection + trend calc ───────────────────────────────────────
export async function detectSeries(workspace) {
  // Posts with a series marker in the caption.
  const posts = await supabase.select('posts', {
    select: 'id,platform,caption,posted_at,views,engagement_rate,content_piece_id,series_id',
    eq: { workspace_id: workspace.id, source: 'own' },
    order: 'posted_at.asc',
  }).catch(() => []);
  if (!posts?.length) return { created: 0, updated: 0, series: 0 };

  // Group matched posts by stem. Stems are platform-agnostic on purpose —
  // a series that ran on IG + TikTok groups together.
  const groups = new Map();
  for (const p of posts) {
    const m = seriesMatch(p.caption || '');
    if (!m) continue;
    if (!groups.has(m.stem)) groups.set(m.stem, { stem: m.stem, entries: [] });
    groups.get(m.stem).entries.push({ post: p, number: m.number });
  }
  // A real series needs at least 2 DISTINCT entry numbers (Part 1, Part 2).
  // Two cross-posts of the same "Part 1" don't make a series — they're
  // already grouped as a single content_piece. Drop any group whose unique
  // number count is < 2.
  for (const k of [...groups.keys()]) {
    const uniqNumbers = new Set(groups.get(k).entries.map(e => e.number));
    if (uniqNumbers.size < 2) groups.delete(k);
  }

  if (!groups.size) return { created: 0, updated: 0, series: 0 };

  const existing = await supabase.select('series', {
    select: 'id,detected_name', eq: { workspace_id: workspace.id },
  }).catch(() => []);
  const existingByStem = new Map((existing || []).map(r => [r.detected_name, r]));

  let created = 0, updated = 0;
  for (const g of groups.values()) {
    const entries = g.entries.sort((a, b) => a.number - b.number);
    // Aggregate by entry number first — Part 1 cross-posted to IG + TT
    // counts as one entry whose views are the SUM across platforms. Without
    // this, the trend comparison would be apples-to-oranges (IG views vs TT
    // views) and would wrongly flag every series as growing or declining.
    const byNumber = new Map();
    for (const e of entries) {
      const slot = byNumber.get(e.number) || { number: e.number, views: 0, posted_at: e.post.posted_at };
      slot.views += e.post.views || 0;
      // Keep the latest posted_at across cross-posts.
      if (e.post.posted_at && (!slot.posted_at || e.post.posted_at > slot.posted_at)) {
        slot.posted_at = e.post.posted_at;
      }
      byNumber.set(e.number, slot);
    }
    const dedupedEntries = [...byNumber.values()].sort((a, b) => a.number - b.number);
    const views = dedupedEntries.map(e => e.views);
    const avgViews = Math.round(views.reduce((s, n) => s + n, 0) / dedupedEntries.length);
    const peakViews = Math.max(...views);
    const latestNumber = dedupedEntries[dedupedEntries.length - 1].number;
    const lastEntryAt = dedupedEntries[dedupedEntries.length - 1].posted_at || null;

    // Trend classification on the deduped (per-number) view totals.
    const first = views[0] || 0;
    const last = views[views.length - 1] || 0;
    const ageDays = lastEntryAt ? (Date.now() - new Date(lastEntryAt).getTime()) / 86400000 : Infinity;
    let trend = 'stable';
    if (ageDays > 14) trend = 'stale';
    else if (first > 0 && last > first * 1.2) trend = 'growing';
    else if (first > 0 && last < first * 0.7) trend = 'declining';

    const row = {
      workspace_id: workspace.id,
      detected_name: g.stem,
      post_count: entries.length,
      avg_views: avgViews,
      peak_views: peakViews,
      latest_number: latestNumber,
      trend,
      last_entry_at: lastEntryAt,
      updated_at: new Date().toISOString(),
    };

    let seriesId = null;
    const hit = existingByStem.get(g.stem);
    if (hit) {
      await supabase.update('series', row, { eq: { id: hit.id } }).catch(() => {});
      seriesId = hit.id;
      updated += 1;
    } else {
      const inserted = await supabase.insert('series', row).catch(() => null);
      seriesId = inserted?.[0]?.id || null;
      if (seriesId) created += 1;
    }
    if (!seriesId) continue;

    // Link content_pieces + posts to this series.
    const pieceIds = [...new Set(entries.map(e => e.post.content_piece_id).filter(Boolean))];
    for (const pid of pieceIds) {
      await supabase.update('content_pieces', { series_id: seriesId }, { eq: { id: pid } }).catch(() => {});
    }
    for (const e of entries) {
      if (e.post.series_id !== seriesId) {
        await supabase.update('posts', { series_id: seriesId }, { eq: { id: e.post.id } }).catch(() => {});
      }
    }
  }

  return { created, updated, series: groups.size };
}

// ── Combined entry point used by the sync flow ──────────────────────────
export async function detectContent(workspace) {
  const pieces = await detectContentPieces(workspace).catch(() => ({ created: 0, linked: 0, pieces: 0 }));
  const series = await detectSeries(workspace).catch(() => ({ created: 0, updated: 0, series: 0 }));
  return { pieces, series };
}

// Exported for the prompt builder.
export { fingerprint };
