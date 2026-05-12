// Content deep-dive endpoint.
//
//   GET /api/posts?id=<postId>  → full detail for one post, including
//     percentile rank against the user's other same-platform posts in the
//     last 30 days, hashtags extracted from the caption, and a curated
//     subset of raw_data fields (media URL, thumbnail, link).
//
//   GET /api/posts                → returns the same top-N list that brief.js
//     publishes, but unrestricted (no top-12 cap). Useful for the Content
//     screen's picker when the user has more than 12 posts.

import { authenticate, json } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';

const PLATFORM_TO_ICON = {
  instagram: 'ig', tiktok: 'tt', youtube: 'yt',
  facebook: 'fb', linkedin: 'li', x: 'x', snapchat: 'sc',
};
const platformKey = (p) => PLATFORM_TO_ICON[p] || p;

// Pull the most likely media + link fields out of raw_data without sending
// the whole (sometimes huge) payload to the client.
function pickMediaFields(platform, raw) {
  if (!raw) return {};
  const pick = (...keys) => {
    for (const k of keys) {
      const v = k.split('.').reduce((o, kk) => (o == null ? null : o[kk]), raw);
      if (v) return v;
    }
    return null;
  };
  return {
    thumbnail: pick('thumbnailUrl', 'thumbnail', 'displayUrl', 'cover', 'previewUrl',
                    'platforms.0.thumbnailUrl', 'media.0.thumbnailUrl'),
    media_url: pick('mediaUrl', 'videoUrl', 'url', 'permalink',
                    'platforms.0.mediaUrl', 'media.0.url'),
    permalink: pick('permalink', 'url', 'shareUrl', 'webUrl',
                    'platforms.0.permalink'),
  };
}

// Hashtags + mentions from the caption.
function extractTokens(caption) {
  if (!caption) return { hashtags: [], mentions: [] };
  const hashtags = [...new Set((caption.match(/#[\p{L}\p{N}_]+/gu) || []).map(s => s.toLowerCase()))];
  const mentions = [...new Set((caption.match(/@[\p{L}\p{N}_.-]+/gu) || []).map(s => s.toLowerCase()))];
  return { hashtags: hashtags.slice(0, 20), mentions: mentions.slice(0, 10) };
}

// Percentile of `value` against the array of comparison values. 0..100.
function percentile(value, all) {
  if (!all.length || value == null) return null;
  const below = all.filter(v => v < value).length;
  return Math.round((below / all.length) * 100);
}

function dayOfWeek(iso) {
  if (!iso) return null;
  const dow = new Date(iso).getUTCDay();
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dow];
}

function hourBucket(iso) {
  if (!iso) return null;
  const h = new Date(iso).getUTCHours();
  if (h < 6) return 'Late night (00–06 UTC)';
  if (h < 12) return 'Morning (06–12 UTC)';
  if (h < 18) return 'Afternoon (12–18 UTC)';
  return 'Evening (18–00 UTC)';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  const id = req.query?.id;

  // ── List mode ────────────────────────────────────────────────────────
  if (!id) {
    const limit = Math.min(200, Math.max(10, Number(req.query?.limit) || 60));
    const rows = await supabase.select('posts', {
      select: '*',
      eq: { workspace_id: ws.id },
      order: 'posted_at.desc',
      limit,
    }).catch(() => []);
    const own = (rows || []).filter(p => p.source === 'own' && p.post_type !== 'ad');
    return json(res, 200, {
      posts: own.map(p => ({
        id: p.id,
        platform: platformKey(p.platform),
        type: p.post_type || 'post',
        title: p.caption ? p.caption.slice(0, 80) : 'Untitled post',
        posted_at: p.posted_at,
        views: p.views || 0,
        likes: p.likes || 0,
        comments: p.comments || 0,
        saves: p.saves || 0,
        shares: p.shares || 0,
        engRate: p.engagement_rate || 0,
        signal: p.signal || 'steady',
      })),
    });
  }

  // ── Detail mode ──────────────────────────────────────────────────────
  const post = await supabase.select('posts', {
    select: '*', eq: { id, workspace_id: ws.id }, single: true,
  }).catch(() => null);
  if (!post) return json(res, 404, { error: 'Post not found' });

  // Pull all own posts on the same platform for percentile benchmarks.
  // 200-row cap is more than enough — Zernio/Apify only fetch the last 30
  // days of own posts on each refresh, so we never have more than that.
  const sameRows = await supabase.select('posts', {
    select: 'views,likes,comments,saves,shares,engagement_rate,posted_at',
    eq: { workspace_id: ws.id, platform: post.platform, source: 'own' },
    limit: 200,
  }).catch(() => []);
  const peers = (sameRows || []).filter(p => p.id !== post.id && (p.views || 0) > 0);

  const viewsAll  = peers.map(p => p.views || 0);
  const engAll    = peers.map(p => p.engagement_rate || 0);
  const sharesAll = peers.map(p => p.shares || 0);

  const benchmarks = {
    peer_count: peers.length,
    views: {
      value: post.views || 0,
      percentile: percentile(post.views || 0, viewsAll),
      avg: viewsAll.length ? Math.round(viewsAll.reduce((a, b) => a + b, 0) / viewsAll.length) : null,
    },
    engagement_rate: {
      value: post.engagement_rate || 0,
      percentile: percentile(post.engagement_rate || 0, engAll),
      avg: engAll.length ? Math.round((engAll.reduce((a, b) => a + b, 0) / engAll.length) * 100) / 100 : null,
    },
    shares: {
      value: post.shares || 0,
      percentile: percentile(post.shares || 0, sharesAll),
      avg: sharesAll.length ? Math.round(sharesAll.reduce((a, b) => a + b, 0) / sharesAll.length) : null,
    },
  };

  const tokens = extractTokens(post.caption);
  const media = pickMediaFields(post.platform, post.raw_data);

  // Optional: top 3 same-platform posts surrounding this one chronologically
  // so the user has obvious "next/previous" navigation context.
  const ownSorted = (sameRows || [])
    .filter(p => p.posted_at)
    .sort((a, b) => String(b.posted_at).localeCompare(String(a.posted_at)));
  const idx = ownSorted.findIndex(p => p.id === post.id);
  const prev = idx >= 0 && idx < ownSorted.length - 1 ? ownSorted[idx + 1] : null;
  const next = idx > 0 ? ownSorted[idx - 1] : null;

  return json(res, 200, {
    post: {
      id: post.id,
      platform: platformKey(post.platform),
      raw_platform: post.platform,
      type: post.post_type || 'post',
      caption: post.caption || '',
      title: post.caption ? post.caption.slice(0, 80) : 'Untitled post',
      posted_at: post.posted_at,
      day_of_week: dayOfWeek(post.posted_at),
      time_bucket: hourBucket(post.posted_at),
      views: post.views || 0,
      likes: post.likes || 0,
      comments: post.comments || 0,
      saves: post.saves || 0,
      shares: post.shares || 0,
      engagement_rate: post.engagement_rate || 0,
      signal: post.signal || 'steady',
      ...media,
      hashtags: tokens.hashtags,
      mentions: tokens.mentions,
    },
    benchmarks,
    nav: {
      prev: prev ? { id: prev.id } : null,
      next: next ? { id: next.id } : null,
    },
  });
}
