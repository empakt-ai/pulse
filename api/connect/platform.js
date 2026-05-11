import { authenticate, json } from '../lib/auth.js';
import { supabase } from '../lib/supabase.js';
import { zernio } from '../lib/zernio.js';

const SUPPORTED = ['instagram', 'tiktok', 'youtube', 'facebook', 'linkedin', 'x', 'snapchat'];

async function ensureProfile(workspace) {
  if (workspace.zernio_profile_id) return workspace.zernio_profile_id;
  const profile = await zernio.createProfile(`pulse-${workspace.id}`);
  const profileId = profile?.id || profile?.profileId || profile?.profile?.id;
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

  try {
    const profileId = await ensureProfile(auth.workspace);
    const appUrl = process.env.APP_URL || 'https://karvan-pulse.vercel.app';
    const redirectUrl = `${appUrl}/api/connect/callback?platform=${platform}`;
    const result = await zernio.getConnectUrl(platform, profileId, redirectUrl);
    const authUrl = result?.authUrl || result?.url || result?.auth_url;
    if (!authUrl) return json(res, 502, { error: 'Zernio did not return authUrl', detail: result });
    return json(res, 200, { authUrl, profileId, platform });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message });
  }
}
