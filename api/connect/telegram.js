// ═════════════════════════════════════════════════════════════════════════
// [Mashal] Telegram connect — guided bot + access-code flow (NOT OAuth).
//
// GET /api/connect/telegram → ensures a Zernio profile, asks Zernio for a
// one-time access code, and returns it with the bot handle + steps. The SPA
// shows the code, the user adds @ZernioScheduleBot as an admin of their
// channel/group and sends the code; the channel then appears in Zernio's
// listAccounts and the existing POST /api/accounts import picks it up — no
// Telegram-specific import path. READ ONLY (channel/group messages only;
// private bot DMs are not captured by Zernio).
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json } from '../_lib/auth.js';
import { zernio } from '../_lib/zernio.js';
import { ensureProfile } from '../_lib/zernio-profile.js';
import { assertRole } from '../_lib/permissions.js';

const BOT_USERNAME = '@ZernioScheduleBot';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  // Adding a connection is admin territory (mirrors the OAuth connect gate).
  const denied = assertRole(auth, 'admin');
  if (denied) return json(res, denied.status, denied.body);

  // TIER GATE — Telegram is a Brand/Agency channel (its value here is feeding
  // the read-only Conversations surface, which is itself Brand/Agency). Trial
  // workspaces preview it; Creator/Pro Creator get the upgrade pointer.
  const tierKey = String(ws.tier || 'creator').toLowerCase();
  const allowed = tierKey === 'brand' || tierKey === 'agency' || !!ws.trial_active;
  if (!allowed) {
    return json(res, 402, {
      error: 'Telegram connections unlock on Brand and Agency.',
      upgrade_tier: 'brand', current_tier: tierKey, platform: 'telegram',
    });
  }

  try {
    const profileId = await ensureProfile(ws);
    const result = await zernio.connectTelegram(profileId);

    // Zernio's exact field names for the code aren't pinned in the docs — accept
    // the common shapes defensively so a minor response-shape change doesn't
    // break connect.
    const code = result?.code || result?.accessCode || result?.access_code
              || result?.connectionCode || result?.token || null;
    if (!code) {
      return json(res, 502, { error: 'Zernio did not return a Telegram access code', detail: result });
    }
    const botUsername = result?.botUsername || result?.bot_username || result?.bot || BOT_USERNAME;

    return json(res, 200, {
      platform: 'telegram',
      code,
      botUsername,
      profileId,
      instructions: result?.instructions || null,
      expiresAt: result?.expiresAt || result?.expires_at || null,
    });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message });
  }
}
