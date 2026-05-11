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

  // 30-day post analytics for an account
  async getAnalytics(accountId, fromDate, toDate) {
    const params = new URLSearchParams({ accountId, fromDate, toDate });
    return call(`/analytics?${params.toString()}`);
  },

  // Follower history
  async getFollowerStats(accountId) {
    return call(`/accounts/${accountId}/follower-stats`);
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
