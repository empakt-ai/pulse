// ═════════════════════════════════════════════════════════════════════════
// [Mashal] Engage — comment→DM automations (Step 2, backend).
//
// CRUD over the workspace's comment→DM rules. Mashal owns the config
// (comment_automations table); execution is DELEGATED to Zernio's hosted
// comment-automations (Zernio watches the keyword comment, sends the private
// reply + optional public comment, tracks stats). Every write here syncs to
// Zernio and mirrors the result locally so a later swap to our own execution
// engine is a backend change, not a UI/data rebuild.
//
//   GET    /api/engage/automations           list (?refresh=1 pulls Zernio stats)
//   POST   /api/engage/automations           create + sync to Zernio
//   PATCH  /api/engage/automations?id=<id>    update / enable-disable + sync
//   DELETE /api/engage/automations?id=<id>    delete on Zernio + locally
//
// Instagram + Facebook only (Zernio's automation surface).
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json, trialLockoutEnvelope } from '../_lib/auth.js';
import { assertRole } from '../_lib/permissions.js';
import { engageGate } from '../_lib/tiers.js';
import { supabase } from '../_lib/supabase.js';
import { zernio } from '../_lib/zernio.js';

const MATCH_MODES = ['contains', 'exact'];
const AUTOMATION_PLATFORMS = ['instagram', 'facebook'];
const MAX_KEYWORDS = 50;
const MAX_DM_LEN = 1000;   // IG DM ceiling
const MAX_REPLY_LEN = 2200;
const MAX_NAME_LEN = 120;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const isTrue = (v) => /^(1|true)$/i.test(String(v ?? ''));

// Local row → API-facing shape (never leaks the Zernio account id / raw cols).
function toPublic(row) {
  return {
    id: row.id,
    account_id: row.account_id,
    platform: row.platform,
    name: row.name,
    keywords: row.keywords || [],
    match_mode: row.match_mode,
    dm_message: row.dm_message,
    comment_reply: row.comment_reply || null,
    is_active: row.is_active,
    synced: !!row.zernio_automation_id,
    last_sync_error: row.last_sync_error || null,
    stats: {
      triggered: row.stat_triggered || 0,
      dms_sent: row.stat_dms_sent || 0,
      dms_failed: row.stat_dms_failed || 0,
      unique_contacts: row.stat_unique_contacts || 0,
    },
    stats_synced_at: row.stats_synced_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Validate + normalize a create (full) or update (partial) body.
// Returns { value } or { error }.
function parseRule(body, { partial = false } = {}) {
  const out = {};
  const errors = [];

  if (!partial || 'name' in body) {
    const name = String(body.name || '').trim();
    if (!name) errors.push('name is required');
    else if (name.length > MAX_NAME_LEN) errors.push(`name exceeds ${MAX_NAME_LEN} chars`);
    else out.name = name;
  }
  if (!partial || 'keywords' in body) {
    let kw = body.keywords;
    if (typeof kw === 'string') kw = kw.split(',');
    if (!Array.isArray(kw)) {
      errors.push('keywords must be an array');
    } else {
      // Trim + drop empties + case-insensitive dedup (keep first-seen casing —
      // don't mangle the user's intended keyword text).
      const seen = new Set();
      const clean = [];
      for (const raw of kw) {
        const k = String(raw || '').trim();
        if (!k) continue;
        const key = k.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        clean.push(k);
      }
      if (!clean.length) errors.push('at least one keyword is required');
      else if (clean.length > MAX_KEYWORDS) errors.push(`too many keywords (max ${MAX_KEYWORDS})`);
      else out.keywords = clean;
    }
  }
  if (!partial || 'match_mode' in body) {
    const mm = String(body.match_mode || 'contains').trim().toLowerCase();
    if (!MATCH_MODES.includes(mm)) errors.push(`match_mode must be one of: ${MATCH_MODES.join(', ')}`);
    else out.match_mode = mm;
  }
  if (!partial || 'dm_message' in body) {
    const dm = String(body.dm_message || '').trim();
    if (!dm) errors.push('dm_message is required');
    else if (dm.length > MAX_DM_LEN) errors.push(`dm_message exceeds ${MAX_DM_LEN} chars`);
    else out.dm_message = dm;
  }
  if ('comment_reply' in body) {
    const cr = body.comment_reply == null ? null : String(body.comment_reply).trim();
    if (cr && cr.length > MAX_REPLY_LEN) errors.push(`comment_reply exceeds ${MAX_REPLY_LEN} chars`);
    else out.comment_reply = cr || null;
  }
  if ('is_active' in body) out.is_active = !!body.is_active;

  if (errors.length) return { error: errors.join('; ') };
  return { value: out };
}

// Our rule fields → Zernio's create/update body. Only includes provided keys
// so PATCH stays partial.
function toZernioBody({ zernio_account_id, name, keywords, match_mode, dm_message, comment_reply, is_active }) {
  const b = {};
  if (zernio_account_id != null) b.accountId = zernio_account_id;
  if (name != null) b.name = name;
  if (keywords != null) b.keywords = keywords;
  if (match_mode != null) b.matchMode = match_mode;
  if (dm_message != null) b.dmMessage = dm_message;
  if (comment_reply !== undefined) b.commentReply = comment_reply || '';
  if (is_active != null) b.isActive = is_active;
  return b;
}

// Resolve a connected account → ids + platform, scoped to the workspace.
async function resolveAccount(workspaceId, accountId, zernioAccountId) {
  let acct = null;
  if (accountId) {
    acct = await supabase.select('connected_accounts', {
      select: 'id,platform,zernio_account_id',
      eq: { id: accountId, workspace_id: workspaceId }, limit: 1, single: true,
    }).catch(() => null);
  } else if (zernioAccountId) {
    acct = await supabase.select('connected_accounts', {
      select: 'id,platform,zernio_account_id',
      eq: { zernio_account_id: zernioAccountId, workspace_id: workspaceId }, limit: 1, single: true,
    }).catch(() => null);
  }
  if (!acct) return { error: 'account_id (a connected account in this workspace) is required', status: 400 };
  const platform = String(acct.platform || '').toLowerCase();
  if (!AUTOMATION_PLATFORMS.includes(platform)) {
    return { error: `Comment→DM automations are only supported on Instagram and Facebook (not ${platform || 'unknown'}).`, status: 400 };
  }
  if (!acct.zernio_account_id) return { error: 'That account is not linked to Zernio yet.', status: 400 };
  return { account_id: acct.id, zernio_account_id: acct.zernio_account_id, platform };
}

// Pull fresh stats from Zernio's list and persist onto the local rows.
// Best-effort: any failure returns the rows unchanged.
async function refreshStats(rows) {
  let zlist;
  try { zlist = await zernio.listCommentAutomations(); }
  catch { return rows; }
  const arr = Array.isArray(zlist) ? zlist : (zlist?.automations || zlist?.data || []);
  const byId = new Map();
  for (const z of arr) {
    const zid = z?.id || z?._id;
    if (zid != null) byId.set(String(zid), z);
  }
  const now = new Date().toISOString();
  const out = [];
  for (const r of rows) {
    const z = r.zernio_automation_id ? byId.get(String(r.zernio_automation_id)) : null;
    if (!z) { out.push(r); continue; }
    const s = z.stats || z;
    const patch = {
      stat_triggered: num(s.triggered ?? s.triggeredCount),
      stat_dms_sent: num(s.dmsSent ?? s.dms_sent),
      stat_dms_failed: num(s.dmsFailed ?? s.failures ?? s.dms_failed),
      stat_unique_contacts: num(s.uniqueContacts ?? s.unique_contacts),
      stats_synced_at: now,
    };
    const upd = await supabase.update('comment_automations', patch, { eq: { id: r.id } }).catch(() => null);
    out.push(Array.isArray(upd) && upd[0] ? upd[0] : { ...r, ...patch });
  }
  return out;
}

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  // TIER GATE — Pro Creator+ (basic Creator allowed during launch). Shared
  // gate in api/_lib/tiers.js keeps all engage routes in lockstep.
  const gate = engageGate(ws);
  if (gate) return json(res, gate.status, gate.body);

  // ── GET: list (+ eligible IG/FB accounts so the form is self-contained) ──
  if (req.method === 'GET') {
    const denied = assertRole(auth, 'member');
    if (denied) return json(res, denied.status, denied.body);
    const [rows, accts] = await Promise.all([
      supabase.select('comment_automations', {
        select: '*', eq: { workspace_id: ws.id }, order: 'created_at.desc',
      }).catch(() => []),
      supabase.select('connected_accounts', {
        select: 'id,platform,platform_username,zernio_account_id',
        eq: { workspace_id: ws.id, is_active: true },
      }).catch(() => []),
    ]);
    let list = rows || [];
    if (isTrue(req.query?.refresh) && list.length) {
      list = await refreshStats(list).catch(() => list);
    }
    const accounts = (accts || [])
      .filter(a => AUTOMATION_PLATFORMS.includes(String(a.platform || '').toLowerCase()) && a.zernio_account_id)
      .map(a => ({ id: a.id, platform: a.platform, username: a.platform_username }));
    return json(res, 200, { automations: list.map(toPublic), accounts });
  }

  // Writes: block a locked trial, require member+ (viewers are read-only).
  const locked = trialLockoutEnvelope(ws);
  if (locked) return json(res, locked.status, locked.body);
  const denied = assertRole(auth, 'member'); // NOTE: raise to 'admin' if auto-DM config should be settings-level
  if (denied) return json(res, denied.status, denied.body);

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // ── POST: create ─────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const parsed = parseRule(body);
    if (parsed.error) return json(res, 400, { error: parsed.error });
    const value = parsed.value;

    const acct = await resolveAccount(ws.id, body.account_id, body.zernio_account_id);
    if (acct.error) return json(res, acct.status, { error: acct.error });

    // Create on Zernio first (the execution source of truth), then persist.
    let zid = null;
    try {
      const zres = await zernio.createCommentAutomation(toZernioBody({ zernio_account_id: acct.zernio_account_id, ...value }));
      zid = zres?.id || zres?._id || zres?.automation?.id || null;
    } catch (e) {
      return json(res, 502, { error: `Zernio automation create failed: ${e.message}`, zernio_status: e.status || null });
    }

    const row = {
      workspace_id: ws.id,
      account_id: acct.account_id,
      zernio_account_id: acct.zernio_account_id,
      zernio_automation_id: zid,
      platform: acct.platform,
      name: value.name,
      keywords: value.keywords,
      match_mode: value.match_mode,
      dm_message: value.dm_message,
      comment_reply: value.comment_reply ?? null,
      is_active: value.is_active ?? true,
      created_by: auth.user.id,
      last_sync_error: zid ? null : 'Zernio did not return an automation id',
    };
    const inserted = await supabase.insert('comment_automations', row).catch((e) => ({ _err: e.message }));
    if (!Array.isArray(inserted)) {
      // Zernio has the automation but our local save failed — surface the
      // zernio id so it isn't silently orphaned.
      return json(res, 500, {
        error: `Automation created on Zernio (${zid}) but the local save failed: ${inserted?._err || 'unknown'}`,
        zernio_automation_id: zid,
      });
    }
    return json(res, 200, { automation: toPublic(inserted[0]) });
  }

  // ── PATCH / DELETE need a target id ───────────────────────────────────────
  const id = req.query?.id || body.id || null;
  if (!id) return json(res, 400, { error: 'id is required' });
  const existing = await supabase.select('comment_automations', {
    select: '*', eq: { id, workspace_id: ws.id }, limit: 1, single: true,
  }).catch(() => null);
  if (!existing) return json(res, 404, { error: 'Automation not found' });

  // ── PATCH: update / toggle ────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const parsed = parseRule(body, { partial: true });
    if (parsed.error) return json(res, 400, { error: parsed.error });
    const value = parsed.value;
    if (!Object.keys(value).length) return json(res, 400, { error: 'No fields to update' });

    let syncErr = null;
    if (existing.zernio_automation_id) {
      try {
        await zernio.updateCommentAutomation(existing.zernio_automation_id, toZernioBody(value));
      } catch (e) {
        // Keep the local edit but flag Zernio as out of sync so the UI can
        // show it and a later save can reconcile.
        syncErr = `Zernio update failed: ${e.message}`;
      }
    } else {
      syncErr = 'Not synced to Zernio (no automation id)';
    }
    const patch = { ...value, updated_at: new Date().toISOString(), last_sync_error: syncErr };
    const updated = await supabase.update('comment_automations', patch, { eq: { id } }).catch(() => null);
    const rowOut = Array.isArray(updated) && updated[0] ? updated[0] : { ...existing, ...patch };
    return json(res, 200, { automation: toPublic(rowOut), sync_error: syncErr });
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (existing.zernio_automation_id) {
      try {
        await zernio.deleteCommentAutomation(existing.zernio_automation_id);
      } catch (e) {
        // Removing the local row while Zernio still runs the automation would
        // orphan a live rule that keeps DMing. Refuse unless forced.
        if (!isTrue(req.query?.force)) {
          return json(res, 502, {
            error: `Zernio delete failed: ${e.message}. The automation is still live on Zernio — retry, or pass ?force=1 to drop the local record anyway.`,
            zernio_status: e.status || null,
          });
        }
      }
    }
    await supabase.delete('comment_automations', { eq: { id } }).catch(() => {});
    return json(res, 200, { ok: true, deleted: id });
  }

  return json(res, 405, { error: 'Method not allowed' });
}
