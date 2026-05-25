// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Per-post thumbnail proxy. The Content Deep-Dive
// thumbnail comes from each platform's CDN (Instagram, TikTok, YouTube,
// etc.) and those URLs reject hotlinking from non-platform origins —
// either via signed-token expiry (IG) or Referer enforcement (TikTok).
// This handler refetches server-side with platform-appropriate headers
// and streams the bytes back so the <img> element sees a same-origin URL.
// ═════════════════════════════════════════════════════════════════════════
//
//   GET /api/post-image?id=<postId>[&t=<jwt>]
//
// Auth: standard Bearer header is honored, but <img src> can't send
// Authorization, so we also accept the same JWT as a `t` query param.
// Either way the token is validated through the regular authenticate()
// path and the post must belong to the caller's workspace.

import { authenticate } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';

// Mirrors posts.js pickMediaFields → kept inline (not imported) because
// posts.js doesn't export it and the duplication is small + read-only.
function extractThumbnail(raw) {
  if (!raw) return null;
  const pick = (...keys) => {
    for (const k of keys) {
      const v = k.split('.').reduce((o, kk) => (o == null ? null : o[kk]), raw);
      if (v) return v;
    }
    return null;
  };
  return pick(
    'thumbnailUrl', 'thumbnail', 'displayUrl', 'cover', 'previewUrl', 'imageUrl',
    'snippet.thumbnails.maxres.url', 'snippet.thumbnails.high.url',
    'snippet.thumbnails.standard.url', 'snippet.thumbnails.medium.url',
    'snippet.thumbnails.default.url',
    'videoMeta.coverUrl', 'videoMeta.originCover', 'videoMeta.dynamicCover',
    'images.0',
    'platforms.0.thumbnailUrl', 'platforms.0.cover', 'platforms.0.previewUrl',
    'media.0.thumbnailUrl', 'media.0.url'
  );
}

// Referer needs to match the platform's own domain or the CDN refuses
// the request (instagram especially). UA mimics a real desktop browser
// because some CDNs 403 unknown agents.
const PLATFORM_REFERER = {
  instagram: 'https://www.instagram.com/',
  tiktok:    'https://www.tiktok.com/',
  youtube:   'https://www.youtube.com/',
  facebook:  'https://www.facebook.com/',
  linkedin:  'https://www.linkedin.com/',
  x:         'https://x.com/',
  snapchat:  'https://www.snapchat.com/',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// SSRF defense — only allow thumbnail URLs from the platform CDN hosts
// we actually scrape. A competitor who controls their own profile can
// set a custom thumbnail field to an arbitrary URL; without an
// allowlist, every Mashal user tracking them would scan whatever IP
// the attacker chose. Suffix-match: '*.cdninstagram.com' allows
// 'scontent.cdninstagram.com' etc.
const CDN_HOST_SUFFIXES = [
  // Instagram
  'cdninstagram.com', 'fbcdn.net', 'instagram.com',
  // TikTok
  'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'tiktok.com',
  // YouTube
  'ytimg.com', 'googleusercontent.com', 'youtube.com',
  // Facebook / Meta CDNs (overlap with IG)
  'facebook.com',
  // LinkedIn
  'licdn.com', 'linkedin.com',
  // X / Twitter
  'twimg.com', 'x.com', 'twitter.com',
  // Snapchat
  'snapchat.com', 'sc-cdn.net',
];

function isAllowedCdnHost(urlString) {
  let u;
  try { u = new URL(urlString); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  if (!host) return false;
  return CDN_HOST_SUFFIXES.some(suffix => host === suffix || host.endsWith('.' + suffix));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Content-Type', 'application/json');
    return res.status(405).end(JSON.stringify({ error: 'Method not allowed' }));
  }

  // <img> can't send Authorization, so accept ?t=<jwt> as an alternate.
  if (!req.headers.authorization && req.query?.t) {
    req.headers.authorization = `Bearer ${req.query.t}`;
  }

  const auth = await authenticate(req);
  if (auth.error) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(auth.status).end(JSON.stringify({ error: auth.error }));
  }
  const ws = auth.workspace;
  if (!ws) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(404).end(JSON.stringify({ error: 'Workspace not found' }));
  }

  const id = req.query?.id;
  if (!id) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(400).end(JSON.stringify({ error: 'id required' }));
  }

  const post = await supabase.select('posts', {
    select: 'platform,raw_data',
    eq: { id, workspace_id: ws.id },
    single: true,
  }).catch(() => null);

  if (!post) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(404).end(JSON.stringify({ error: 'Post not found' }));
  }

  const url = extractThumbnail(post.raw_data);
  if (!url) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(404).end(JSON.stringify({ error: 'No thumbnail' }));
  }

  // SSRF defense — refuse anything not on a known platform CDN host.
  // Scraped fields are competitor-controlled; without this allowlist
  // a malicious competitor could redirect Mashal's fetcher to scan
  // internal networks.
  if (!isAllowedCdnHost(url)) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(400).end(JSON.stringify({ error: 'Thumbnail host not on allowlist' }));
  }

  // 8s upstream timeout — keeps the function from hanging if the CDN is
  // slow. The deep-dive page hides broken images via onError, so a 502
  // is harmless from the user's perspective.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Referer':    PLATFORM_REFERER[post.platform] || '',
        'Accept':     'image/*,*/*;q=0.8',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(502).end(JSON.stringify({
        error: `Upstream ${upstream.status}`,
      }));
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await upstream.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    // Private cache — the image isn't user-specific but the request is
    // authenticated, so we keep it out of shared CDN caches. 1h browser
    // cache is long enough to make tab-switching cheap.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.status(200).end(buffer);
  } catch (e) {
    clearTimeout(timer);
    res.setHeader('Content-Type', 'application/json');
    return res.status(502).end(JSON.stringify({
      error: e.name === 'AbortError' ? 'Upstream timeout' : e.message,
    }));
  }
}
