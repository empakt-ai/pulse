// Zernio API wrapper — handles OAuth + analytics for social platforms.
// Master key never reaches the browser. All requests authed with bearer.

const BASE = 'https://zernio.com/api/v1';
const KEY = process.env.ZERNIO_API_KEY;

if (!KEY) console.warn('[zernio] ZERNIO_API_KEY missing — backend calls will fail');

// Defensive follower extractor — walks any object looking for a numeric value
// at a plausibly-named "follower*" / "subscriber*" key. We do this because
// Zernio's response shape isn't documented and varies across platforms.
// Returns null when nothing usable is found.
function isFollowerKey(key) {
  if (typeof key !== 'string') return false;
  const k = key.toLowerCase().replace(/[_\s-]/g, '');
  return k === 'followers' || k === 'followercount' || k === 'followerstotal'
      || k === 'subscribers' || k === 'subscribercount' || k === 'subs'
      || k === 'fans' || k === 'fancount'
      || k === 'edgefollowedby'           // IG graph shape
      || k === 'audiencesize';            // some aggregators
}

function coerceNumber(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) return Number(v);
  // IG graph nests count under .count
  if (typeof v === 'object' && typeof v.count === 'number') return v.count;
  return null;
}

export function extractFollowers(obj, depth = 0) {
  if (obj == null || depth > 5) return null;

  // Array — pick the newest entry by date/timestamp, then recurse.
  if (Array.isArray(obj)) {
    if (!obj.length) return null;
    const sorted = [...obj].sort((a, b) =>
      String(b?.date || b?.timestamp || b?.snapshot_date || '').localeCompare(
      String(a?.date || a?.timestamp || a?.snapshot_date || '')));
    for (const item of sorted) {
      const n = extractFollowers(item, depth + 1);
      if (n != null) return n;
    }
    return null;
  }

  if (typeof obj !== 'object') return null;

  // Check own keys first (prefer top-level over deep nesting).
  for (const [k, v] of Object.entries(obj)) {
    if (isFollowerKey(k)) {
      const n = coerceNumber(v);
      if (n != null) return n;
    }
  }
  // Common alternative shapes: { current, history }, { latest, ... }
  if (typeof obj.current === 'number') return obj.current;
  if (typeof obj.latest === 'number') return obj.latest;
  if (typeof obj.value === 'number' && (obj.metric === 'followers' || obj.type === 'followers')) {
    return obj.value;
  }

  // Recurse into nested objects/arrays.
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const n = extractFollowers(v, depth + 1);
      if (n != null) return n;
    }
  }
  return null;
}

async function call(path, opts = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = (body && (body.message || body.error)) || `Zernio ${res.status}`;
    const err = new Error(`Zernio: ${msg}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const zernio = {
  // Profiles group social accounts (one per PULSE workspace)
  async createProfile(name) {
    return call('/profiles', { method: 'POST', body: JSON.stringify({ name }) });
  },

  async getProfile(profileId) {
    return call(`/profiles/${profileId}`);
  },

  async listProfiles() {
    return call('/profiles');
  },

  // Returns { authUrl } for the chosen platform
  async getConnectUrl(platform, profileId, redirectUrl) {
    const params = new URLSearchParams({ profileId });
    if (redirectUrl) params.set('redirectUrl', redirectUrl);
    return call(`/connect/${platform}?${params.toString()}`);
  },

  // List accounts connected to a Zernio profile
  async listAccounts(profileId) {
    const params = new URLSearchParams({ profileId });
    return call(`/accounts?${params.toString()}`);
  },

  // 30-day post analytics for an account.
  // Response shape: { posts: [...] } or array. Each post has top-level meta
  // (publishedAt, content, _id, mediaType, platforms[]) and engagement fields
  // NESTED under .analytics (impressions, reach, likes, comments, saves, etc.).
  async getAnalytics(accountId, fromDate, toDate) {
    const params = new URLSearchParams({ accountId, fromDate, toDate });
    return call(`/analytics?${params.toString()}`);
  },

  // Ad performance for the account. Returns { ads, pagination }.
  // Empty when no ads are running or the account lacks ad permissions.
  async getAds(accountId, { fromDate, toDate, limit = 50 } = {}) {
    const params = new URLSearchParams({ accountId, limit: String(limit) });
    if (fromDate) params.set('fromDate', fromDate);
    if (toDate) params.set('toDate', toDate);
    return call(`/ads?${params.toString()}`);
  },

  // Follower stats. Collection-style endpoint per the Zernio OpenAPI spec:
  //   GET /v1/accounts/follower-stats?accountIds=A,B,C
  // Response shape:
  //   { accounts: [{ _id, platform, username, currentFollowers, growth,
  //                  growthPercentage, dataPoints }],
  //     stats:    { [accountId]: [{ date, followers }] } }
  //
  // 403 with `requiresAddon: true` means the user's Zernio subscription
  // lacks the Analytics add-on — follower history isn't available without it.
  async getFollowerStats(accountIds = null) {
    const params = new URLSearchParams();
    if (accountIds) {
      params.set('accountIds', Array.isArray(accountIds) ? accountIds.join(',') : String(accountIds));
    }
    const qs = params.toString();
    return call(`/accounts/follower-stats${qs ? `?${qs}` : ''}`);
  },

  // Batched follower count fetch. Takes a list of zernio account IDs and
  // returns { [accountId]: number | null } plus a diagnostic flag indicating
  // whether the analytics add-on is required (403 from Zernio).
  //
  // Single batched call >> N parallel single-account calls — both for latency
  // and because Zernio rate-limits per request, not per account.
  async getFollowerCountsByAccount(accountIds) {
    const result = { counts: {}, addonRequired: false, error: null };
    if (!accountIds || !accountIds.length) return result;
    let payload;
    try {
      payload = await this.getFollowerStats(accountIds);
    } catch (e) {
      if (e.status === 402 || e.status === 403 || /analytics add-?on/i.test(e.message || '')) {
        result.addonRequired = true;
      }
      result.error = e.message;
      return result;
    }
    // Primary: accounts[].currentFollowers
    for (const a of (payload?.accounts || [])) {
      const id = a._id || a.id || a.accountId;
      if (!id) continue;
      if (typeof a.currentFollowers === 'number') {
        result.counts[id] = a.currentFollowers;
        continue;
      }
      // Fallback: pick the newest entry from stats[id] time series.
      const series = payload?.stats?.[id];
      if (Array.isArray(series) && series.length) {
        const latest = [...series].sort((x, y) => String(y.date).localeCompare(String(x.date)))[0];
        if (typeof latest?.followers === 'number') {
          result.counts[id] = latest.followers;
          continue;
        }
      }
      // Last resort: deep walk
      result.counts[id] = extractFollowers(a);
    }
    return result;
  },

  // Disconnect an account from the Zernio profile. Mirrors what the user
  // sees in the Zernio dashboard's "Remove" button. Best-effort — we still
  // soft-disconnect locally even if this fails.
  async disconnectAccount(accountId) {
    return call(`/accounts/${accountId}`, { method: 'DELETE' });
  },

  // Instagram-specific account insights
  async getInstagramInsights(accountId) {
    const params = new URLSearchParams({ accountId });
    return call(`/analytics/instagram/account-insights?${params.toString()}`);
  },

  // TikTok creator info — REQUIRED before posting to TikTok
  async getTikTokCreatorInfo(accountId, mediaType = 'video') {
    const params = new URLSearchParams({ mediaType });
    return call(`/accounts/${accountId}/tiktok/creator-info?${params.toString()}`);
  },
};

export default zernio;
