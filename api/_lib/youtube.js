// YouTube Data API v3 client — direct Google API instead of Apify.
// Spec requires this: "YouTube: Direct Google API (YouTube Data v3 + Analytics API)".
//
// Two paths in this file:
//   1. Public competitor scraping with YOUTUBE_API_KEY (no OAuth).
//   2. OWN-channel OAuth using GOOGLE_CLIENT_ID/SECRET — stores refresh_token
//      so we can keep syncing without re-prompting consent.
//
// Quota: handle resolution (1 unit) + playlistItems (1) + videos (1) = 3 units
// per channel scrape. Free tier is 10,000 units/day → 3,300+ scrapes/day.

import crypto from 'node:crypto';

const BASE = 'https://www.googleapis.com/youtube/v3';
const KEY = process.env.YOUTUBE_API_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const STATE_SECRET = process.env.OAUTH_STATE_SECRET || process.env.CRON_SECRET;

if (!KEY) console.warn('[youtube] YOUTUBE_API_KEY missing — YouTube scraping disabled');
if (!GOOGLE_CLIENT_ID) console.warn('[youtube] GOOGLE_CLIENT_ID missing — own-channel OAuth disabled');

const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

// ── OAuth state signing (HMAC-SHA256) ─────────────────────────────────────────
// We embed workspace_id in OAuth state so the callback knows which workspace
// to attach the account to. Sign it so an attacker can't substitute a different
// workspace_id and steal the account-link.
function sign(payload) {
  return crypto.createHmac('sha256', STATE_SECRET || 'unset').update(payload).digest('hex').slice(0, 32);
}

export function signOAuthState(workspaceId, ttlSec = 600) {
  const expires = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `youtube|${workspaceId}|${expires}`;
  return `${payload}|${sign(payload)}`;
}

export function verifyOAuthState(state) {
  if (!state || !STATE_SECRET) return null;
  const parts = state.split('|');
  if (parts.length !== 4) return null;
  const [provider, workspaceId, expires, sig] = parts;
  if (provider !== 'youtube') return null;
  if (Math.floor(Date.now() / 1000) > Number(expires)) return null;
  if (sig !== sign(`${provider}|${workspaceId}|${expires}`)) return null;
  return { provider, workspaceId };
}

// Build the Google OAuth consent URL. redirectUri MUST match a value in the
// OAuth client's "Authorized redirect URIs" (Google Cloud Console).
export function buildAuthUrl(workspaceId, redirectUri) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    access_type: 'offline',         // required for refresh_token
    prompt: 'consent',              // forces refresh_token on repeat consent
    include_granted_scopes: 'true',
    state: signOAuthState(workspaceId),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// Exchange authorization code for tokens.
export async function exchangeCode(code, redirectUri) {
  const params = new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Google token exchange: ${body?.error_description || body?.error || res.status}`);
  return body; // { access_token, refresh_token, expires_in, scope, token_type, id_token? }
}

// Refresh an expired access token using a stored refresh_token.
export async function refreshUserToken(refreshToken) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Google token refresh: ${body?.error_description || body?.error || res.status}`);
  return body; // { access_token, expires_in, scope, token_type }
}

// Fetch the authenticated user's own channel.
export async function getOwnChannel(accessToken) {
  const res = await fetch(
    `${BASE}/channels?part=snippet,statistics,contentDetails&mine=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`YouTube channels?mine: ${body?.error?.message || res.status}`);
  return body?.items?.[0] || null;
}

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
