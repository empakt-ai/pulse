// YouTube Data API v3 client — direct Google API instead of Apify.
// Spec requires this: "YouTube: Direct Google API (YouTube Data v3 + Analytics API)".
//
// Public competitor data only needs an API key (no OAuth). Subscriber counts,
// video stats, and recent uploads are all accessible with the key.
//
// Quota: handle resolution (1 unit) + playlistItems (1) + videos (1) = 3 units
// per channel scrape. Free tier is 10,000 units/day → 3,300+ scrapes/day.

const BASE = 'https://www.googleapis.com/youtube/v3';
const KEY = process.env.YOUTUBE_API_KEY;

if (!KEY) console.warn('[youtube] YOUTUBE_API_KEY missing — YouTube scraping disabled');

async function call(path, params = {}) {
  const qp = new URLSearchParams({ key: KEY, ...params });
  const res = await fetch(`${BASE}${path}?${qp.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.error?.message || `YouTube ${res.status}`;
    const err = new Error(`YouTube: ${msg}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// Resolve a handle (@mkbhd, mkbhd, channel ID UC..., or full URL) to a channel.
// Returns { channelId, uploadsPlaylistId, profile } or null if not found.
async function resolveChannel(input) {
  const raw = String(input || '').trim();

  // Accept UC... channel IDs directly
  if (/^UC[\w-]{20,}$/.test(raw)) {
    const data = await call('/channels', {
      id: raw,
      part: 'snippet,statistics,contentDetails',
    });
    return shapeChannel(data?.items?.[0]);
  }

  // Strip @ and any URL parts → handle
  const handle = raw
    .replace(/^https?:\/\/(www\.)?youtube\.com\//, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '');

  // Use forHandle (preferred) which works with both @handle and bare handle forms
  const data = await call('/channels', {
    forHandle: `@${handle}`,
    part: 'snippet,statistics,contentDetails',
  });
  return shapeChannel(data?.items?.[0]);
}

function shapeChannel(item) {
  if (!item) return null;
  return {
    channelId: item.id,
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads,
    profile: {
      display_name: item.snippet?.title || null,
      followers: Number(item.statistics?.subscriberCount || 0),
      following: null,
      verified: false, // not exposed via public API
      bio: item.snippet?.description || null,
      total_views: Number(item.statistics?.viewCount || 0),
      total_videos: Number(item.statistics?.videoCount || 0),
    },
  };
}

// Recent uploads (titles + IDs) from the channel's uploads playlist.
async function getRecentUploadIds(uploadsPlaylistId, maxResults = 12) {
  const data = await call('/playlistItems', {
    playlistId: uploadsPlaylistId,
    part: 'contentDetails,snippet',
    maxResults: String(maxResults),
  });
  return (data?.items || []).map(it => ({
    videoId: it.contentDetails?.videoId,
    title: it.snippet?.title,
    publishedAt: it.contentDetails?.videoPublishedAt || it.snippet?.publishedAt,
  })).filter(v => v.videoId);
}

// Stats for a list of video IDs.
async function getVideoStats(videoIds) {
  if (!videoIds.length) return [];
  const data = await call('/videos', {
    id: videoIds.join(','),
    part: 'statistics,contentDetails,snippet',
  });
  return data?.items || [];
}

// Public: full scrape of a YouTube channel (handle or ID).
// Returns { profile, posts } in the same shape the Apify wrapper uses.
export async function scrapeChannel(handle, { maxResults = 12 } = {}) {
  const channel = await resolveChannel(handle);
  if (!channel) {
    return { profile: {}, posts: [], errors: [{ source: 'youtube', error: 'Channel not found' }] };
  }
  if (!channel.uploadsPlaylistId) {
    return { profile: channel.profile, posts: [], errors: [] };
  }

  let uploads;
  try {
    uploads = await getRecentUploadIds(channel.uploadsPlaylistId, maxResults);
  } catch (e) {
    return { profile: channel.profile, posts: [], errors: [{ source: 'youtube', error: e.message }] };
  }
  if (!uploads.length) return { profile: channel.profile, posts: [], errors: [] };

  let videos;
  try {
    videos = await getVideoStats(uploads.map(u => u.videoId));
  } catch (e) {
    return { profile: channel.profile, posts: [], errors: [{ source: 'youtube', error: e.message }] };
  }

  const posts = videos.map(v => ({
    platform_post_id: v.id,
    post_type: parseDurationSeconds(v.contentDetails?.duration) <= 60 ? 'short' : 'video',
    caption: v.snippet?.title || null,
    posted_at: v.snippet?.publishedAt || null,
    views: Number(v.statistics?.viewCount || 0),
    likes: Number(v.statistics?.likeCount || 0),
    comments: Number(v.statistics?.commentCount || 0),
    saves: 0,
    shares: 0,
    raw_data: { id: v.id, snippet: v.snippet, statistics: v.statistics, contentDetails: v.contentDetails },
  }));

  return { profile: channel.profile, posts, errors: [], channelId: channel.channelId };
}

// ISO 8601 duration (PT1M30S) → total seconds. Used to distinguish Shorts (≤60s) from regular videos.
function parseDurationSeconds(iso) {
  if (!iso) return 999;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 999;
  const h = parseInt(m[1] || 0, 10);
  const min = parseInt(m[2] || 0, 10);
  const s = parseInt(m[3] || 0, 10);
  return h * 3600 + min * 60 + s;
}
