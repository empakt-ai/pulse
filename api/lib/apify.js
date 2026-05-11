// Apify wrapper — uses the sync-get-dataset-items endpoint so we get results
// in one request. maxItems is hard-capped per actor so a single competitor
// scrape never exceeds ~$0.05 and ~40 seconds.

const BASE = 'https://api.apify.com/v2';
const KEY = process.env.APIFY_API_KEY;

if (!KEY) console.warn('[apify] APIFY_API_KEY missing — competitor scraping disabled');

// Per-platform actor + input + output normaliser. Public, well-known actors.
//   input(handle) builds the actor input
//   normaliseProfile(items) extracts a profile-level summary (followers, etc.)
//   normalisePosts(items) maps each item to our posts table shape
//
// Apify outputs vary considerably between actors — keep the normalisers
// defensive (multiple fallback fields), and let the caller filter empty rows.
export const ACTORS = {
  instagram: {
    id: 'apify~instagram-scraper',
    timeout: 45,
    input: (handle) => ({
      directUrls: [`https://www.instagram.com/${handle.replace(/^@/, '')}/`],
      resultsType: 'posts',
      resultsLimit: 12,
      addParentData: false,
    }),
    normaliseProfile: (items) => {
      const first = items?.[0];
      return {
        followers: first?.ownerFollowersCount || first?.followersCount || null,
        verified: !!(first?.ownerIsVerified || first?.isVerified),
        display_name: first?.ownerFullName || first?.fullName || null,
      };
    },
    normalisePosts: (items) => (items || []).map(it => ({
      platform_post_id: String(it.id || it.shortCode || it.url || ''),
      post_type: it.type || it.productType || 'post',
      caption: it.caption || it.text || null,
      posted_at: it.timestamp || it.takenAtTimestamp || null,
      views: Number(it.videoViewCount || it.videoPlayCount || it.viewCount || 0),
      likes: Number(it.likesCount || it.likeCount || 0),
      comments: Number(it.commentsCount || it.commentCount || 0),
      saves: 0, // Instagram public API doesn't expose saves
      shares: 0,
      raw_data: it,
    })),
  },

  tiktok: {
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
        followers: author.fans || author.followerCount || first?.fans || null,
        verified: !!author.verified,
        display_name: author.nickName || author.name || null,
      };
    },
    normalisePosts: (items) => (items || []).map(it => ({
      platform_post_id: String(it.id || it.videoId || ''),
      post_type: 'video',
      caption: it.text || it.desc || null,
      posted_at: it.createTime ? new Date(it.createTime * 1000).toISOString() : (it.createTimeISO || null),
      views: Number(it.playCount || it.viewCount || 0),
      likes: Number(it.diggCount || it.likeCount || 0),
      comments: Number(it.commentCount || 0),
      saves: Number(it.collectCount || 0),
      shares: Number(it.shareCount || 0),
      raw_data: it,
    })),
  },

  youtube: {
    id: 'streamers~youtube-scraper',
    timeout: 45,
    input: (handle) => ({
      startUrls: [{ url: `https://www.youtube.com/${handle.startsWith('@') ? handle : '@' + handle}/videos` }],
      maxResults: 12,
      subtitlesLanguage: 'none',
    }),
    normaliseProfile: (items) => {
      const first = items?.[0];
      return {
        followers: first?.numberOfSubscribers || first?.subscriberCount || null,
        verified: false,
        display_name: first?.channelName || null,
      };
    },
    normalisePosts: (items) => (items || []).map(it => ({
      platform_post_id: String(it.id || it.videoId || it.url?.split('v=')[1] || ''),
      post_type: 'video',
      caption: it.title || null,
      posted_at: it.uploadedAt || it.publishedAt || null,
      views: Number(it.viewCount || 0),
      likes: Number(it.likes || it.likeCount || 0),
      comments: Number(it.commentsCount || it.commentCount || 0),
      saves: 0,
      shares: 0,
      raw_data: it,
    })),
  },
};

// Run an actor synchronously and return its dataset items. Throws on actor
// failure or HTTP error.
export async function runActor(platform, handle, opts = {}) {
  const cfg = ACTORS[platform];
  if (!cfg) throw new Error(`No Apify actor configured for platform: ${platform}`);

  const url = `${BASE}/acts/${cfg.id}/run-sync-get-dataset-items?token=${KEY}&timeout=${cfg.timeout}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg.input(handle)),
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Apify ${platform} run failed: ${res.status} ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  // Body is a JSON array of dataset items (Apify sync format)
  const items = await res.json();
  return {
    items: Array.isArray(items) ? items : [],
    profile: cfg.normaliseProfile(items),
    posts: cfg.normalisePosts(items),
  };
}

// Apify costs vary per actor — return a rough estimate in cents for usage_log.
// These are conservative defaults; actual is on the Apify invoice.
export function estimateScrapeCost(platform) {
  return { instagram: 5, tiktok: 4, youtube: 3 }[platform] || 5;
}
