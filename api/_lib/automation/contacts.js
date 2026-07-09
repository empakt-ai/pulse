// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Automation engine — the contact store.
// ═════════════════════════════════════════════════════════════════════════
//
// One row per (workspace, Zernio account, platform user). This is the
// subscriber ManyChat calls a "contact": who they are, whether they follow us
// (IG only — instagramProfile.isFollower), their tags and custom fields, and
// whether a human has taken over the thread (automation_paused). Runs and
// jobs reference a contact; the contact outlives any single run so tags and
// follower state accumulate across automations.

import { supabase } from '../supabase.js';

// Find-or-create the contact for an inbound event. Upserts on the identity
// unique index (workspace_id, zernio_account_id, platform_user_id) so repeat
// comments/DMs from the same person collapse to one row. Only overwrites
// display fields when we actually have a fresher value (COALESCE-style) — a
// later event missing the handle must not blank an earlier one.
export async function upsertContact({
  workspaceId, accountId = null, zernioAccountId, platform,
  platformUserId, handle = null, name = null, conversationId = null,
}) {
  if (!platformUserId) return null;
  const nowIso = new Date().toISOString();

  // Read the existing row first so we can preserve fields the new event lacks
  // and avoid clobbering follower state we verified earlier.
  const existing = await supabase.select('automation_contacts', {
    select: '*',
    eq: { workspace_id: workspaceId, zernio_account_id: zernioAccountId, platform_user_id: String(platformUserId) },
    limit: 1, single: true,
  }).catch(() => null);

  const row = {
    workspace_id: workspaceId,
    account_id: accountId,
    zernio_account_id: zernioAccountId,
    platform,
    platform_user_id: String(platformUserId),
    handle: handle || existing?.handle || null,
    name: name || existing?.name || null,
    conversation_id: conversationId || existing?.conversation_id || null,
    last_seen_at: nowIso,
    updated_at: nowIso,
  };

  const res = await supabase.upsert('automation_contacts', row, {
    onConflict: 'workspace_id,zernio_account_id,platform_user_id',
  }).catch((e) => { console.warn('[automation] upsertContact failed:', e.message); return null; });
  return Array.isArray(res) ? res[0] : (res || existing || null);
}

// Patch arbitrary columns on a contact (tags, fields, is_follower, paused…).
export async function updateContact(contactId, patch) {
  if (!contactId) return null;
  const res = await supabase.update('automation_contacts',
    { ...patch, updated_at: new Date().toISOString() },
    { eq: { id: contactId } }
  ).catch((e) => { console.warn('[automation] updateContact failed:', e.message); return null; });
  return Array.isArray(res) ? res[0] : res;
}

// Refresh follower state from an inbound message's instagramProfile block.
// Zernio only exposes isFollower on RECEIVED conversations/messages (never at
// comment time) and IG only — so this is where the follow-gate actually gets
// its verified answer. No-op for non-IG or when the block is absent.
export async function applyFollowerFromMessage(contact, messagePayload) {
  if (!contact) return contact;
  const prof =
    messagePayload?.message?.sender?.instagramProfile ||
    messagePayload?.sender?.instagramProfile ||
    messagePayload?.conversation?.instagramProfile ||
    messagePayload?.instagramProfile || null;
  if (!prof || typeof prof.isFollower !== 'boolean') return contact;

  const patch = {
    is_follower: prof.isFollower,
    follower_checked_at: new Date().toISOString(),
  };
  if (typeof prof.isFollowing === 'boolean') patch.is_following = prof.isFollowing;
  const updated = await updateContact(contact.id, patch);
  return updated || { ...contact, ...patch };
}

// Convenience: pull a contact by id.
export async function getContact(contactId) {
  if (!contactId) return null;
  return supabase.select('automation_contacts', {
    select: '*', eq: { id: contactId }, limit: 1, single: true,
  }).catch(() => null);
}

export default { upsertContact, updateContact, applyFollowerFromMessage, getContact };
