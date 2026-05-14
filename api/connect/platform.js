// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// OAuth initiation. Generic across products. No Mashal logic.
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json } from '../_lib/auth.js';
import { supabase } from '../_lib/supabase.js';
import { zernio } from '../_lib/zernio.js';
import { buildAuthUrl as buildYouTubeAuthUrl } from '../_lib/youtube.js';

// Most platforms go through Zernio's hosted OAuth. YouTube uses Google's
// OAuth directly so we get a refresh_token + Analytics API access scoped to
// the actual creator account (Zernio's flow doesn't expose raw tokens).
const ZERNIO_SUPPORTED = ['instagram', 'tiktok', 'facebook', 'linkedin', 'x', 'snapchat'];
const DIRECT_SUPPORTED = ['youtube'];
const SUPPORTED = [...ZERNIO_SUPPORTED, ...DIRECT_SUPPORTED];

function pickProfileId(res) {
  // Zernio shapes seen in the wild:
  //   POST /profiles -> { message, profile: { _id, name, ... } }
  //   GET  /profiles -> { profiles: [{ _id, name, ... }] }
  const p = res?.profile || res;
  return p?._id || p?.id || p?.profileId || null;
}

async function ensureProfile(workspace) {
  if (workspace.zernio_profile_id) return workspace.zernio_profile_id;

  const name = `pulse-${workspace.id}`;
  let profileId = null;

  try {
    const created = await zernio.createProfile(name);
    profileId = pickProfileId(created);
  } catch (e) {
    if (!/already exists/i.test(e.message)) throw e;
  }

  if (!profileId) {
    const list = await zernio.listProfiles();
    const profiles = list?.profiles || (Array.isArray(list) ? list : []);
    const match = profiles.find(p => p.name === name);
    profileId = match ? (match._id || match.id) : null;
  }

  if (!profileId) throw new Error('Zernio did not return a profile id');
  await supabase.update('workspaces', { zernio_profile_id: profileId }, { eq: { id: workspace.id } });
  return profileId;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  if (!auth.workspace) return json(res, 404, { error: 'Workspace not found' });

  const platform = req.query?.platform || (req.url.match(/\/connect\/([^/?]+)/) || [])[1];
  if (!platform || !SUPPORTED.includes(platform)) {
    return json(res, 400, { error: `Unsupported platform: ${platform}` });
  }

  const appUrl = process.env.APP_URL || 'https://mashal.app';

  try {
    // YouTube uses direct Google OAuth — no Zernio profile involved.
    // The redirect_uri MUST be registered in Google Cloud Console exactly.
    // We deliberately omit query params from redirect_uri so it matches the
    // single registered URI; the platform is identified via OAuth `state`.
    if (platform === 'youtube') {
      const redirectUri = `${appUrl}/api/connect/callback`;
      const authUrl = buildYouTubeAuthUrl(auth.workspace.id, redirectUri);
      return json(res, 200, { authUrl, platform });
    }

    // Everything else goes through Zernio.
    const profileId = await ensureProfile(auth.workspace);
    const redirectUrl = `${appUrl}/api/connect/callback?platform=${platform}`;
    const result = await zernio.getConnectUrl(platform, profileId, redirectUrl);
    const authUrl = result?.authUrl || result?.url || result?.auth_url;
    if (!authUrl) return json(res, 502, { error: 'Zernio did not return authUrl', detail: result });
    return json(res, 200, { authUrl, profileId, platform });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message });
  }
}
