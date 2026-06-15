// ═════════════════════════════════════════════════════════════════════════
// [Mashal] WhatsApp connect — bring-your-own number via Meta Embedded Signup.
//
//   GET  /api/connect/whatsapp → { appId, configId, profileId }
//        The browser uses these to launch Meta's Embedded Signup (FB.login
//        with config_id). The business authorizes their OWN existing WABA.
//   POST /api/connect/whatsapp { code, wabaId?, phoneNumberId? }
//        Registers the authorized number with Zernio. It then shows up in
//        Zernio's listAccounts and the existing POST /api/accounts sync
//        imports it uniformly — no WhatsApp-specific import path.
//
// READ ONLY BYO: no Zernio-provisioned numbers ($2/KYC), no outbound, no
// templates. Brand/Agency only. Number lifecycle (activated/suspended/
// reactivated/released) is handled additively in api/webhooks/zernio.js.
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json } from '../_lib/auth.js';
import { zernio } from '../_lib/zernio.js';
import { ensureProfile } from '../_lib/zernio-profile.js';
import { assertRole } from '../_lib/permissions.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  // Adding a connection is admin territory (mirrors the OAuth connect gate).
  const denied = assertRole(auth, 'admin');
  if (denied) return json(res, denied.status, denied.body);

  // TEMP owner-only testing gate (2026-06-15): mirrors OWNER_ONLY in
  // js/connect-whatsapp/panel.jsx. While we validate the Meta flow, only
  // platform admins (profiles.is_admin — the founder) can reach the WhatsApp
  // connect endpoints, so a non-owner can't drive it even by calling directly.
  // Remove this block (or gate it) to open WhatsApp to all Brand/Agency.
  const OWNER_ONLY = true;
  if (OWNER_ONLY && !auth.isAdmin) {
    return json(res, 403, { error: 'WhatsApp connect is in limited testing.' });
  }

  // TIER GATE — WhatsApp is a Brand/Agency channel (feeds Conversations).
  // Trial previews; Creator/Pro Creator get the upgrade pointer.
  const tierKey = String(ws.tier || 'creator').toLowerCase();
  const allowed = tierKey === 'brand' || tierKey === 'agency' || !!ws.trial_active;
  if (!allowed) {
    return json(res, 402, {
      error: 'WhatsApp connections unlock on Brand and Agency.',
      upgrade_tier: 'brand', current_tier: tierKey, platform: 'whatsapp',
    });
  }

  // ── GET: hand the browser what it needs to launch Meta Embedded Signup ──
  if (req.method === 'GET') {
    try {
      const profileId = await ensureProfile(ws);
      const cfg = await zernio.getWhatsappSdkConfig();
      const appId = cfg?.appId || cfg?.app_id || cfg?.fbAppId || null;
      const configId = cfg?.configId || cfg?.config_id || cfg?.fbConfigId || null;
      if (!appId || !configId) {
        return json(res, 502, { error: 'Zernio did not return a WhatsApp SDK config', detail: cfg });
      }
      return json(res, 200, { platform: 'whatsapp', appId, configId, profileId });
    } catch (e) {
      return json(res, e.status || 500, { error: e.message });
    }
  }

  // ── POST: register the Meta-authorized number with Zernio ───────────────
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const code = body?.code || null;
  const wabaId = body?.wabaId || body?.waba_id || null;
  const phoneNumberId = body?.phoneNumberId || body?.phone_number_id || null;
  if (!code) return json(res, 400, { error: 'Missing Meta authorization code' });

  try {
    const profileId = await ensureProfile(ws);
    const result = await zernio.whatsappEmbeddedSignup({ code, profileId, wabaId, phoneNumberId });
    return json(res, 200, { ok: true, platform: 'whatsapp', profileId, result });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message });
  }
}
