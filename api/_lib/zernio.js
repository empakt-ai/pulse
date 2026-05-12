// Zernio API wrapper — handles OAuth + analytics for social platforms.
// Master key never reaches the browser. All requests authed with bearer.

const BASE = 'https://zernio.com/api/v1';
const KEY = process.env.ZERNIO_API_KEY;

if (!KEY) console.warn('[zernio] ZERNIO_API_KEY missing — backend calls will fail');

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

  // Follower history. Response shape varies by platform — common fields:
  //   { current, growth, history: [{ date, count }] }
  // or just an array of { date, count } entries. Callers should pick the
  // most recent value defensively.
  async getFollowerStats(accountId) {
    return call(`/accounts/${accountId}/follower-stats`);
  },

  // Convenience: just the latest follower count (or null on any failure).
  // Used during /api/accounts sync and the cron analytics refresh because
  // Zernio's /accounts endpoint doesn't reliably populate the followers field.
  async latestFollowers(accountId) {
    try {
      const stats = await this.getFollowerStats(accountId);
      if (stats == null) return null;
      if (typeof stats.current === 'number') return stats.current;
      if (typeof stats.followers === 'number') return stats.followers;
      if (typeof stats.followerCount === 'number') return stats.followerCount;
      const arr = Array.isArray(stats) ? stats : (stats.history || stats.data || []);
      if (Array.isArray(arr) && arr.length) {
        const sorted = [...arr].sort((a, b) =>
          String(b.date || b.timestamp || '').localeCompare(String(a.date || a.timestamp || '')));
        const top = sorted[0];
        return Number(top?.count ?? top?.followers ?? top?.value) || null;
      }
      return null;
    } catch {
      return null;
    }
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
