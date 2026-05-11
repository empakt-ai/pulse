// Apify wrapper — per-platform actor configs. Each platform can have a
// "profile" actor (returns followers/bio/verification) and a "posts" actor
// (returns recent posts). competitor-sync calls both when present and merges.
//
// All actors use the sync-get-dataset-items endpoint so results return in one
// request. Hard-capped resultsLimit + actor timeout to bound cost/time.

const BASE = 'https://api.apify.com/v2';
const KEY = process.env.APIFY_API_KEY;

if (!KEY) console.warn('[apify] APIFY_API_KEY missing — competitor scraping disabled');

// Helper: defensive number extraction (handles null/undefined/strings like "1.2M")
const num = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const s = v.replace(/,/g, '');
    if (/^\d+(\.\d+)?[KMB]$/i.test(s)) {
      const mult = { K: 1e3, M: 1e6, B: 1e9 }[s.slice(-1).toUpperCase()];
      return Math.round(parseFloat(s) * mult);
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

export const ACTORS = {
  instagram: {
    profile: {
      id: 'apify~instagram-profile-scraper',
      timeout: 30,
      input: (handle) => ({
        usernames: [handle.replace(/^@/, '')],
        resultsLimit: 1,
      }),
      normalise: (items) => {
        const p = items?.[0];
        if (!p) return null;
        return {
          followers: num(p.followersCount || p.followers),
          following: num(p.followsCount || p.following),
          verified: !!(p.verified || p.isVerified),
          display_name: p.fullName || p.name || null,
          bio: p.biography || p.bio || null,
          posts_count: num(p.postsCount),
        };
      },
    },
    posts: {
      id: 'apify~instagram-scraper',
      timeout: 45,
      input: (handle) => ({
        directUrls: [`https://www.instagram.com/${handle.replace(/^@/, '')}/`],
        resultsType: 'posts',
        resultsLimit: 12,
        addParentData: false,
      }),
      normalisePosts: (items) => (items || [])
        .filter(it => !it.error && it.id)
        .map(it => ({
          platform_post_id: String(it.id || it.shortCode || it.url || ''),
          post_type: it.type || it.productType || 'post',
          caption: it.caption || it.text || null,
          posted_at: it.timestamp || it.takenAtTimestamp || null,
          views: num(it.videoViewCount || it.videoPlayCount || it.viewCount) || 0,
          likes: num(it.likesCount || it.likeCount) || 0,
          comments: num(it.commentsCount || it.commentCount) || 0,
          saves: 0, shares: 0,
          raw_data: it,
        })),
    },
  },

  tiktok: {
    // TikTok scraper returns profile + posts in one shot via the same actor.
    posts: {
      id: 'clockworks~tiktok-scraper',
      timeout: 45,
      input: (handle) => ({
        profiles: [handle.replace(/^@/, '')],
        resultsPerPage: 12,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
      }),
      normaliseProfile: (items) => {
        const first = items?.[0];
        const author = first?.authorMeta || first?.author || {};
        return {
          followers: num(author.fans || author.followerCount),
          verified: !!author.verified,
          display_name: author.nickName || author.name || null,
        };
      },
      normalisePosts: (items) => (items || [])
        .filter(it => it.id || it.videoId)
        .map(it => ({
          platform_post_id: String(it.id || it.videoId || ''),
          post_type: 'video',
          caption: it.text || it.desc || null,
          posted_at: it.createTime ? new Date(it.createTime * 1000).toISOString() : (it.createTimeISO || null),
          views: num(it.playCount || it.viewCount) || 0,
          likes: num(it.diggCount || it.likeCount) || 0,
          comments: num(it.commentCount) || 0,
          saves: num(it.collectCount) || 0,
          shares: num(it.shareCount) || 0,
          raw_data: it,
        })),
    },
  },

  // YouTube: handled via direct Google Data API v3 in api/lib/youtube.js (Phase 5).
  // The streamers/youtube-scraper Apify actor reliably times out for any
  // channel above tiny size — even at maxResults=3 with 55s timeout. The
  // official API is faster, free up to quota, and gives richer data.
  // youtube: { ... },

  linkedin: {
    // harvestapi's LinkedIn profile scraper is one of the most reliable for
    // public profiles. Handles linkedin.com/in/USERNAME URLs.
    profile: {
      id: 'harvestapi~linkedin-profile-scraper',
      timeout: 45,
      input: (handle) => {
        const h = handle.replace(/^@/, '');
        const url = h.startsWith('http') ? h : `https://www.linkedin.com/in/${h}/`;
        return { profileUrls: [url] };
      },
      normalise: (items) => {
        const p = items?.[0];
        if (!p) return null;
        return {
          followers: num(p.followers || p.followersCount || p.connections || p.connectionsCount),
          verified: false,
          display_name: p.fullName || p.name || (p.firstName ? `${p.firstName} ${p.lastName || ''}`.trim() : null),
          bio: p.headline || p.about || p.summary || null,
        };
      },
    },
  },

  // Snapchat: no reliable public Apify actor with the names we tried. Tell us
  // the actor slug you've enabled and we'll wire it. Until then, snapchat
  // competitors are added to the DB but not scraped.
  // snapchat: { ... },

  facebook: {
    profile: {
      id: 'apify~facebook-pages-scraper',
      timeout: 45,
      input: (handle) => ({
        startUrls: [{ url: `https://www.facebook.com/${handle.replace(/^@/, '')}` }],
        resultsLimit: 1,
      }),
      normalise: (items) => {
        const p = items?.[0];
        if (!p) return null;
        return {
          followers: num(p.followers || p.likes),
          verified: !!p.verified,
          display_name: p.title || p.name || null,
        };
      },
    },
  },

  x: {
    profile: {
      id: 'apidojo~twitter-user-scraper',
      timeout: 30,
      input: (handle) => ({
        usernames: [handle.replace(/^@/, '')],
      }),
      normalise: (items) => {
        const p = items?.[0];
        if (!p) return null;
        return {
          followers: num(p.followers_count || p.followers),
          verified: !!(p.verified || p.is_blue_verified),
          display_name: p.name || null,
          bio: p.description || null,
        };
      },
    },
  },
};

// Internal: run a single actor and return its parsed dataset items.
async function callActor(actorId, input, timeout = 45, signal) {
  const url = `${BASE}/acts/${actorId}/run-sync-get-dataset-items?token=${KEY}&timeout=${timeout}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Apify ${actorId} ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    err.actor = actorId;
    throw err;
  }
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

// Public: run all configured actors for the platform/handle in PARALLEL and
// return merged { profile, posts, items }. Parallel matters here — Vercel
// functions have a 60s cap and sequential profile+posts calls per competitor,
// across 3-5 competitors, blows that budget.
export async function runActor(platform, handle, opts = {}) {
  const cfg = ACTORS[platform];
  if (!cfg) throw new Error(`No Apify actor configured for platform: ${platform}`);

  const tasks = [];
  if (cfg.profile) {
    tasks.push(
      callActor(cfg.profile.id, cfg.profile.input(handle), cfg.profile.timeout, opts.signal)
        .then(items => ({ kind: 'profile', items }))
        .catch(e => ({ kind: 'profile', error: e.message, actor: cfg.profile.id }))
    );
  }
  if (cfg.posts) {
    tasks.push(
      callActor(cfg.posts.id, cfg.posts.input(handle), cfg.posts.timeout, opts.signal)
        .then(items => ({ kind: 'posts', items }))
        .catch(e => ({ kind: 'posts', error: e.message, actor: cfg.posts.id }))
    );
  }

  const results = await Promise.all(tasks);

  let profile = null;
  let posts = [];
  let postsActorItems = [];
  const errors = [];

  for (const r of results) {
    if (r.error) { errors.push({ actor: r.actor, error: r.error }); continue; }
    if (r.kind === 'profile' && cfg.profile?.normalise) {
      profile = cfg.profile.normalise(r.items);
    }
    if (r.kind === 'posts' && cfg.posts) {
      postsActorItems = r.items;
      if (cfg.posts.normalisePosts) posts = cfg.posts.normalisePosts(r.items);
      if ((!profile || profile.followers == null) && cfg.posts.normaliseProfile) {
        const fromPosts = cfg.posts.normaliseProfile(r.items);
        profile = { ...(profile || {}), ...(fromPosts || {}) };
      }
    }
  }

  return { profile: profile || {}, posts: posts || [], items: postsActorItems, errors };
}

// Rough cost estimate (cents) — sum of actors that ran for this platform.
export function estimateScrapeCost(platform) {
  const base = { instagram: 6, tiktok: 4, youtube: 3, linkedin: 8, snapchat: 4, facebook: 4, x: 3 };
  return base[platform] || 5;
}
