// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Zernio profile resolution — extracted from connect/platform.js so
// every connect path (OAuth platforms, Telegram bot-code, WhatsApp BYO) reuses
// the exact same "ensure a live Zernio profile for this workspace" behaviour.
// One profile per Mashal workspace; validate-then-self-heal-then-recreate.
// ═════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase.js';
import { zernio } from './zernio.js';

export function pickProfileId(res) {
  // Zernio shapes seen in the wild:
  //   POST /profiles -> { message, profile: { _id, name, ... } }
  //   GET  /profiles -> { profiles: [{ _id, name, ... }] }
  const p = res?.profile || res;
  return p?._id || p?.id || p?.profileId || null;
}

export async function ensureProfile(workspace) {
  // Validate the stored profile still exists on Zernio before reusing it.
  // A stale id (profile/accounts removed on Zernio, or the profile GC'd after
  // a disconnect) still produces a valid-looking OAuth URL — so the consent
  // screen appears normally — but Zernio's post-consent attach silently fails
  // against a profile that no longer exists: the account never lands and the
  // callback never redirects back. Recreating a fresh profile here is exactly
  // the "treat every reconnect as an absolutely fresh connection" behaviour we
  // want. (The connected_accounts/handle-registry rows are kept purely for
  // trial-abuse prevention — they must NOT cause us to reuse dead Zernio state.)
  if (workspace.zernio_profile_id) {
    try {
      const existing = await zernio.getProfile(workspace.zernio_profile_id);
      if (pickProfileId(existing)) {
        // Self-heal: rebrand legacy `pulse-<id>` profile names to `mashal-<id>`
        // once (the name is visible on the Zernio dashboard). Best-effort —
        // never block connect on the rename.
        const prof = existing.profile || existing;
        if (typeof prof?.name === 'string' && prof.name.startsWith('pulse-')) {
          await zernio.updateProfile(workspace.zernio_profile_id, {
            name: `mashal-${workspace.id}`,
            ...(prof.description != null ? { description: prof.description } : {}),
          }).catch(() => {});
        }
        return workspace.zernio_profile_id;
      }
      // Reached Zernio but no profile in the response → treat as gone, recreate.
    } catch (e) {
      // Only recreate on a definitive not-found. On transient/auth errors,
      // reuse the existing id rather than spawning duplicate profiles.
      const gone = e.status === 404 || e.status === 410
        || /not\s*found|no\s*such|does\s*not\s*exist|invalid\s*profile/i.test(e.message || '');
      if (!gone) return workspace.zernio_profile_id;
    }
    // Fall through: stale/deleted profile → create a fresh one below and
    // overwrite workspace.zernio_profile_id.
  }

  const name = `mashal-${workspace.id}`;
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
