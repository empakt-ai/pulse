// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// OAuth initiation. Generic across products. No Mashal logic.
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json } from '../_lib/auth.js';
import { zernio } from '../_lib/zernio.js';
import { ensureProfile } from '../_lib/zernio-profile.js';
import { assertRole } from '../_lib/permissions.js';

// All platforms — including YouTube — go through Zernio's hosted OAuth. Zernio's
// own verified app handles the Google consent for YouTube, so there's no
// "unverified app" warning and no raw Google tokens for us to manage. (Own-
// account YouTube no longer uses the Google Data API; competitor YouTube still
// does, via api/_lib/youtube.js + YOUTUBE_API_KEY — read-only, no OAuth.)
//
// NOTE: Telegram and WhatsApp are NOT in this list — they don't use the hosted
// OAuth popup. Telegram is a bot + access-code flow (api/connect/telegram.js);
// WhatsApp BYO is Meta Embedded Signup (api/connect/whatsapp.js). Both reuse
// ensureProfile from _lib/zernio-profile.js and land in connected_accounts the
// same way, so everything downstream stays uniform.
const ZERNIO_SUPPORTED = ['instagram', 'tiktok', 'facebook', 'linkedin', 'x', 'snapchat', 'youtube'];
const SUPPORTED = ZERNIO_SUPPORTED;

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  if (!auth.workspace) return json(res, 404, { error: 'Workspace not found' });

  // Initiating OAuth connects a social account to the workspace — admin
  // territory. Members can see existing connections but can't add new
  // ones (matches the DELETE/POST gates on /api/accounts).
  const denied = assertRole(auth, 'admin');
  if (denied) return json(res, denied.status, denied.body);

  const platform = req.query?.platform || (req.url.match(/\/connect\/([^/?]+)/) || [])[1];
  if (!platform || !SUPPORTED.includes(platform)) {
    return json(res, 400, { error: `Unsupported platform: ${platform}` });
  }

  // TIER GATE — X and Snapchat are Pro Creator+ platforms per the /pricing
  // comparison. The Creator tier supports IG, TT, YT, FB, LI only. Refuse
  // X / Snapchat OAuth initiation for Creator workspaces with an upgrade
  // pointer the SPA can use to render an inline upsell.
  const wsTier = String(auth.workspace.tier || 'creator').toLowerCase();
  if (wsTier === 'creator' && (platform === 'x' || platform === 'snapchat')) {
    return json(res, 402, {
      error: `${platform === 'x' ? 'X' : 'Snapchat'} connections unlock on Pro Creator and above.`,
      upgrade_tier: 'pro_creator',
      current_tier: wsTier,
      platform,
    });
  }

  const appUrl = process.env.APP_URL || 'https://mashal.app';

  try {
    // All platforms (YouTube included) go through Zernio's hosted OAuth.
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
