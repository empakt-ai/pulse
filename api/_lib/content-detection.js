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

const CONTENT_WINDOW_MS = 48 * 3600 * 1000; // ±48 hours for cross-platform grouping

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

  // Group posts by fingerprint, then within each fingerprint group split
  // into 48-hour clusters keyed by the earliest post in the cluster.
  const byFp = new Map();
  for (const p of posts) {
    const fp = fingerprint(p.caption);
    const key = fp || `__solo_${p.id}`; // empty fingerprint → solo piece
    if (!byFp.has(key)) byFp.set(key, []);
    byFp.get(key).push(p);
  }

  // Existing pieces for this workspace, keyed by fingerprint for upsert.
  const existing = await supabase.select('content_pieces', {
    select: 'id,fingerprint,first_posted_at,detected_platforms',
    eq: { workspace_id: workspace.id },
  }).catch(() => []);
  const existingByFp = new Map((existing || []).map(r => [r.fingerprint, r]));

  let created = 0, linked = 0, pieces = 0;
  const piecesToWrite = [];
  const piecesToUpdate = [];
  const postLinks = []; // [{ post_id, piece_id }]

  for (const [key, group] of byFp.entries()) {
    if (!group.length) continue;
    // Cluster the group into 48h windows around the first post.
    group.sort((a, b) => String(a.posted_at || '').localeCompare(String(b.posted_at || '')));
    const clusters = [];
    for (const p of group) {
      const ts = p.posted_at ? new Date(p.posted_at).getTime() : 0;
      const existingCluster = clusters.find(c => {
        const firstTs = c.first ? new Date(c.first).getTime() : 0;
        return Math.abs(ts - firstTs) <= CONTENT_WINDOW_MS;
      });
      if (existingCluster) {
        existingCluster.posts.push(p);
      } else {
        clusters.push({ first: p.posted_at, posts: [p] });
      }
    }

    for (const cluster of clusters) {
      const fp = key.startsWith('__solo_') ? '' : key;
      // Aggregate stats for this cluster.
      const platforms = [...new Set(cluster.posts.map(p => p.platform))];
      const totalViews = cluster.posts.reduce((s, p) => s + (p.views || 0), 0);
      const sortedByViews = [...cluster.posts].sort((a, b) => (b.views || 0) - (a.views || 0));
      const best = sortedByViews[0];
      const worst = sortedByViews[sortedByViews.length - 1];
      const firstPostedAt = cluster.posts[0].posted_at;
      const title = (cluster.posts.find(p => p.caption)?.caption || '').slice(0, 80) || null;

      // Re-use the existing piece when one already exists for this fingerprint
      // AND its first_posted_at falls inside this cluster's window. Otherwise
      // create a fresh piece (e.g. user posted the same evergreen caption a
      // year apart — those are different pieces).
      let pieceId = null;
      const hit = fp && existingByFp.get(fp);
      if (hit) {
        const hitTs = hit.first_posted_at ? new Date(hit.first_posted_at).getTime() : 0;
        const clusterTs = firstPostedAt ? new Date(firstPostedAt).getTime() : 0;
        if (Math.abs(hitTs - clusterTs) <= CONTENT_WINDOW_MS) {
          pieceId = hit.id;
          piecesToUpdate.push({
            id: pieceId,
            detected_platforms: platforms,
            total_views: totalViews,
            best_platform: best?.platform || null,
            best_views: best?.views || 0,
            worst_views: worst?.views || 0,
            title,
            updated_at: new Date().toISOString(),
          });
        }
      }
      if (!pieceId) {
        // Defer ID generation to Postgres. We collect the rows and insert
        // them in one batch below, then read back the inserted ids.
        piecesToWrite.push({
          workspace_id: workspace.id,
          fingerprint: fp,
          title,
          first_posted_at: firstPostedAt,
          detected_platforms: platforms,
          total_views: totalViews,
          best_platform: best?.platform || null,
          best_views: best?.views || 0,
          worst_views: worst?.views || 0,
          _cluster: cluster, // sidecar — stripped before insert
        });
      } else {
        // Link all posts in this cluster to the existing piece.
        for (const p of cluster.posts) {
          if (p.content_piece_id !== pieceId) postLinks.push({ post_id: p.id, piece_id: pieceId });
        }
        linked += cluster.posts.length;
      }
      pieces += 1;
    }
  }

  // Insert new pieces in one batch, then link their posts.
  if (piecesToWrite.length) {
    const toInsert = piecesToWrite.map(({ _cluster, ...rest }) => rest);
    const inserted = await supabase.insert('content_pieces', toInsert).catch(() => []);
    for (let i = 0; i < piecesToWrite.length; i++) {
      const id = inserted?.[i]?.id;
      if (!id) continue;
      created += 1;
      for (const p of piecesToWrite[i]._cluster.posts) {
        postLinks.push({ post_id: p.id, piece_id: id });
      }
      linked += piecesToWrite[i]._cluster.posts.length;
    }
  }

  // Patch each post that needs a new linkage. Done one-by-one because
  // PostgREST's update endpoint doesn't accept per-row values in a batch.
  // 50-ish posts per workspace per sync — within Vercel Pro's 60s.
  for (const link of postLinks) {
    await supabase.update('posts',
      { content_piece_id: link.piece_id },
      { eq: { id: link.post_id } }).catch(() => {});
  }

  // Aggregate updates for already-existing pieces.
  for (const u of piecesToUpdate) {
    const { id, ...patch } = u;
    await supabase.update('content_pieces', patch, { eq: { id } }).catch(() => {});
  }

  return { created, linked, pieces };
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
  // Drop singletons — one Part 1 doesn't make a series.
  for (const k of [...groups.keys()]) {
    if (groups.get(k).entries.length < 2) groups.delete(k);
  }

  if (!groups.size) return { created: 0, updated: 0, series: 0 };

  const existing = await supabase.select('series', {
    select: 'id,detected_name', eq: { workspace_id: workspace.id },
  }).catch(() => []);
  const existingByStem = new Map((existing || []).map(r => [r.detected_name, r]));

  let created = 0, updated = 0;
  for (const g of groups.values()) {
    const entries = g.entries.sort((a, b) => a.number - b.number);
    const views = entries.map(e => e.post.views || 0);
    const avgViews = Math.round(views.reduce((s, n) => s + n, 0) / entries.length);
    const peakViews = Math.max(...views);
    const latestNumber = entries[entries.length - 1].number;
    const lastEntryAt = entries[entries.length - 1].post.posted_at || null;

    // Trend classification.
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
