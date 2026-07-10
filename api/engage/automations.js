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
import { engineEnabled } from '../_lib/automation/flags.js';
import { deriveEngine, normalizeButtons, DEFAULT_DELAY_MIN, DEFAULT_DELAY_MAX } from '../_lib/automation/flow-builder.js';
import { syncAutomationToEngine, removeEngineFlow } from '../_lib/automation/sync.js';

const MATCH_MODES = ['contains', 'exact'];
const AUTOMATION_PLATFORMS = ['instagram', 'facebook'];
const MAX_KEYWORDS = 50;
const MAX_DM_LEN = 1000;   // IG DM ceiling
const MAX_REPLY_LEN = 2200;
const MAX_NAME_LEN = 120;
const DELAY_CEIL = 6 * 60 * 60;   // 6h — matches the flow-builder's cap

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
    // Execution surface + the two native-engine features.
    engine: row.engine || 'zernio',
    delay_enabled: !!(row.delay_min_seconds || row.delay_max_seconds),
    delay_min_seconds: row.delay_min_seconds ?? null,
    delay_max_seconds: row.delay_max_seconds ?? null,
    require_follow: !!row.require_follow,
    follow_prompt: row.follow_prompt || null,
    reprompt: row.reprompt || null,
    buttons: Array.isArray(row.buttons) ? row.buttons : [],
    synced: row.engine === 'native' ? !!row.flow_id : !!row.zernio_automation_id,
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

  // ── P1: randomized send delay ────────────────────────────────────────────
  // Accept a simple toggle (`delay_enabled`, defaulting to the 2–5 min window)
  // or explicit `delay_min_seconds`/`delay_max_seconds`. Off → columns nulled.
  if ('delay_enabled' in body || 'delay_min_seconds' in body || 'delay_max_seconds' in body) {
    const enabled = 'delay_enabled' in body ? !!body.delay_enabled
      : (body.delay_min_seconds != null || body.delay_max_seconds != null);
    if (!enabled) {
      out.delay_min_seconds = null;
      out.delay_max_seconds = null;
    } else {
      let mn = Number(body.delay_min_seconds);
      let mx = Number(body.delay_max_seconds);
      if (!Number.isFinite(mn)) mn = DEFAULT_DELAY_MIN;
      if (!Number.isFinite(mx)) mx = DEFAULT_DELAY_MAX;
      if (mn < 0) mn = 0;
      if (mx < mn) mx = mn;
      mn = Math.min(Math.round(mn), DELAY_CEIL);
      mx = Math.min(Math.round(mx), DELAY_CEIL);
      out.delay_min_seconds = mn;
      out.delay_max_seconds = mx;
    }
  }

  // ── P2: verified follow-gate (Instagram only — enforced after account resolve) ──
  if ('require_follow' in body) out.require_follow = !!body.require_follow;
  if ('follow_prompt' in body) {
    const fp = body.follow_prompt == null ? null : String(body.follow_prompt).trim();
    if (fp && fp.length > MAX_DM_LEN) errors.push(`follow_prompt exceeds ${MAX_DM_LEN} chars`);
    else out.follow_prompt = fp || null;
  }
  if ('reprompt' in body) {
    const rp = body.reprompt == null ? null : String(body.reprompt).trim();
    if (rp && rp.length > MAX_DM_LEN) errors.push(`reprompt exceeds ${MAX_DM_LEN} chars`);
    else out.reprompt = rp || null;
  }

  // ── P3: inline DM buttons (v1 = URL buttons, max 3) ───────────────────────
  if ('buttons' in body) {
    const raw = Array.isArray(body.buttons) ? body.buttons : [];
    if (raw.length > 3) errors.push('at most 3 buttons are allowed');
    for (const b of raw) {
      const title = String(b?.title || '').trim();
      const url = String(b?.url || '').trim();
      if (!title || !url) errors.push('each button needs a label and a URL');
      else if (title.length > 20) errors.push(`button label "${title}" exceeds 20 chars`);
      else if (!/^https?:\/\//i.test(url)) errors.push(`button URL must start with http(s): "${url}"`);
    }
    // normalizeButtons is the single source of truth for the stored/sent shape.
    if (!errors.length) out.buttons = normalizeButtons(raw);
  }

  if (errors.length) return { error: errors.join('; ') };
  return { value: out };
}

// Our rule fields → Zernio's create/update body. Only includes provided keys
// so PATCH stays partial. profileId is required by Zernio on create (the
// account lives under a profile); update keys on the automation id in the URL.
function toZernioBody({ zernio_profile_id, zernio_account_id, name, keywords, match_mode, dm_message, comment_reply, is_active, buttons }) {
  const b = {};
  if (zernio_profile_id != null) b.profileId = zernio_profile_id;
  if (zernio_account_id != null) b.accountId = zernio_account_id;
  if (name != null) b.name = name;
  if (keywords != null) b.keywords = keywords;
  if (match_mode != null) b.matchMode = match_mode;
  if (dm_message != null) b.dmMessage = dm_message;
  if (comment_reply !== undefined) b.commentReply = comment_reply || '';
  if (is_active != null) b.isActive = is_active;
  // Zernio's hosted comment-automations accept the same button shape, so plain
  // rules get buttons too (native rules attach them in the flow instead).
  if (buttons !== undefined) b.buttons = Array.isArray(buttons) ? buttons : [];
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

// Make the right execution surface live for a rule and tear down the other, so
// a comment is never answered twice. Given the DESIRED merged config (+ the
// resolved account + workspace), returns the fields to persist:
//   { engine, flow_id, zernio_automation_id, last_sync_error }
//
//   native  (delay and/or follow-gate) → our engine runs it; NO Zernio twin.
//   zernio  (plain comment→DM)         → Zernio's instant hosted automation.
//
// Handles every transition: create on either surface, and flip native⇄zernio on
// edit (deleting the Zernio twin when going native, deactivating the flow when
// going back). Best-effort on the far side — surfaced via last_sync_error.
async function reconcileExecution(desired, acct, ws, { createdBy = null } = {}) {
  const engine = deriveEngine({
    delay: { min_seconds: desired.delay_min_seconds, max_seconds: desired.delay_max_seconds },
    requireFollow: desired.require_follow,
  });

  if (engine === 'native') {
    // Tear down any Zernio twin first — if it lingered, both would fire.
    let zerr = null;
    if (desired.zernio_automation_id) {
      try { await zernio.deleteCommentAutomation(desired.zernio_automation_id); }
      catch (e) { zerr = `Zernio twin teardown failed: ${e.message}`; }
    }
    const { flowId } = await syncAutomationToEngine(desired, {
      workspaceId: ws.id, accountId: acct.account_id, zernioAccountId: acct.zernio_account_id,
      platform: acct.platform, createdBy,
    });
    return {
      engine: 'native',
      flow_id: flowId,
      zernio_automation_id: null,
      last_sync_error: flowId ? zerr : 'Native flow compile failed',
    };
  }

  // engine === 'zernio' — deactivate any native flow, ensure the hosted twin.
  if (desired.flow_id) await removeEngineFlow(desired);
  let zid = desired.zernio_automation_id || null;
  let zerr = null;
  const zbody = toZernioBody({
    zernio_profile_id: zid ? undefined : ws.zernio_profile_id,   // profileId only on create
    zernio_account_id: acct.zernio_account_id,
    name: desired.name, keywords: desired.keywords, match_mode: desired.match_mode,
    dm_message: desired.dm_message, comment_reply: desired.comment_reply, is_active: desired.is_active,
    buttons: desired.buttons,
  });
  try {
    if (zid) await zernio.updateCommentAutomation(zid, zbody);
    else { const zres = await zernio.createCommentAutomation(zbody); zid = zres?.id || zres?._id || zres?.automation?.id || null; }
  } catch (e) {
    zerr = `Zernio sync failed: ${e.message}`;
  }
  return {
    engine: 'zernio',
    flow_id: null,
    zernio_automation_id: zid,
    last_sync_error: zid ? zerr : (zerr || 'Zernio did not return an automation id'),
  };
}

// Guard: native features (delay/follow-gate) require the engine flag on, and the
// follow-gate is Instagram-only (isFollower is IG-only). Returns an error string
// or null. `cfg` is the merged desired config; `platform` the account platform.
function nativeGuard(cfg, platform) {
  const wantsNative = deriveEngine({
    delay: { min_seconds: cfg.delay_min_seconds, max_seconds: cfg.delay_max_seconds },
    requireFollow: cfg.require_follow,
  }) === 'native';
  if (!wantsNative) return null;
  if (!engineEnabled()) {
    return 'The delay and follow-gate options aren’t enabled yet on your workspace.';
  }
  if (cfg.require_follow && String(platform).toLowerCase() !== 'instagram') {
    return 'The follow-gate is Instagram-only — Instagram is the only platform that reports whether a commenter follows you.';
  }
  return null;
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
    // engine_available gates the delay + follow-gate controls in the UI; the
    // default window lets the form preselect 2–5 min.
    return json(res, 200, {
      automations: list.map(toPublic),
      accounts,
      engine_available: engineEnabled(),
      delay_defaults: { min_seconds: DEFAULT_DELAY_MIN, max_seconds: DEFAULT_DELAY_MAX },
    });
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

    // Native features (delay / follow-gate) need the engine on; the gate is IG-only.
    const guardErr = nativeGuard(value, acct.platform);
    if (guardErr) return json(res, 400, { error: guardErr });

    const engine = deriveEngine({
      delay: { min_seconds: value.delay_min_seconds, max_seconds: value.delay_max_seconds },
      requireFollow: value.require_follow,
    });
    if (engine === 'zernio' && !ws.zernio_profile_id) {
      return json(res, 400, { error: 'This workspace isn’t linked to a Zernio profile yet — reconnect the account and try again.' });
    }

    // Insert the config first (so a native flow can link back to its id), then
    // reconcile the execution surface (Zernio hosted twin OR native flow).
    const row = {
      workspace_id: ws.id,
      account_id: acct.account_id,
      zernio_account_id: acct.zernio_account_id,
      platform: acct.platform,
      name: value.name,
      keywords: value.keywords,
      match_mode: value.match_mode,
      dm_message: value.dm_message,
      comment_reply: value.comment_reply ?? null,
      is_active: value.is_active ?? true,
      delay_min_seconds: value.delay_min_seconds ?? null,
      delay_max_seconds: value.delay_max_seconds ?? null,
      require_follow: value.require_follow ?? false,
      follow_prompt: value.follow_prompt ?? null,
      reprompt: value.reprompt ?? null,
      buttons: value.buttons ?? [],
      engine,
      created_by: auth.user.id,
    };
    const inserted = await supabase.insert('comment_automations', row).catch((e) => ({ _err: e.message }));
    if (!Array.isArray(inserted)) {
      return json(res, 500, { error: `Automation save failed: ${inserted?._err || 'unknown'}` });
    }
    const saved = inserted[0];

    const recon = await reconcileExecution({ ...saved }, acct, ws, { createdBy: auth.user.id });
    const finalUpd = await supabase.update('comment_automations', {
      engine: recon.engine,
      flow_id: recon.flow_id,
      zernio_automation_id: recon.zernio_automation_id,
      last_sync_error: recon.last_sync_error,
      updated_at: new Date().toISOString(),
    }, { eq: { id: saved.id } }).catch(() => null);
    const finalRow = (Array.isArray(finalUpd) && finalUpd[0]) ? finalUpd[0] : { ...saved, ...recon };
    return json(res, 200, { automation: toPublic(finalRow), sync_error: recon.last_sync_error || null });
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

    // Merge the patch over the saved config to get the DESIRED end state, then
    // reconcile the execution surface — this is what flips a rule native⇄zernio
    // when a delay or follow-gate is toggled on or off.
    const desired = { ...existing, ...value };
    const acct = { account_id: existing.account_id, zernio_account_id: existing.zernio_account_id, platform: existing.platform };

    const guardErr = nativeGuard(desired, acct.platform);
    if (guardErr) return json(res, 400, { error: guardErr });

    const recon = await reconcileExecution(desired, acct, ws, { createdBy: existing.created_by });
    const patch = {
      ...value,
      engine: recon.engine,
      flow_id: recon.flow_id,
      zernio_automation_id: recon.zernio_automation_id,
      last_sync_error: recon.last_sync_error,
      updated_at: new Date().toISOString(),
    };
    const updated = await supabase.update('comment_automations', patch, { eq: { id } }).catch(() => null);
    const rowOut = Array.isArray(updated) && updated[0] ? updated[0] : { ...desired, ...patch };
    return json(res, 200, { automation: toPublic(rowOut), sync_error: recon.last_sync_error || null });
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
    // Stop the native flow too (soft-deactivate — the flow row survives for
    // audit; the FK is ON DELETE SET NULL so it doesn't block the delete).
    if (existing.flow_id) await removeEngineFlow(existing).catch(() => {});
    await supabase.delete('comment_automations', { eq: { id } }).catch(() => {});
    return json(res, 200, { ok: true, deleted: id });
  }

  return json(res, 405, { error: 'Method not allowed' });
}
