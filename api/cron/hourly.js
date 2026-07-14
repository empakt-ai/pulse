// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Layer-2 cron dispatcher. Vercel triggers this at the
// top of every hour; we fan out to every workspace, check what its local
// clock currently reads, and dispatch the right job:
//
//   06:00 local, Mon–Sat → morning brief (incremental sync + generateBrief)
//   06:00 local, Sunday  → weekly deep sync (mode='deep') + morning brief
//   08:00 / 13:00 / 18:00 local → live signals (pattern-detection only,
//                                  append-only; no full brief regen)
//
// The shared data-fetch layer (api/_lib/sync.js) handles persistence; the
// Mashal-specific intelligence layer (api/_lib/intelligence.js) handles
// signal generation. After the platform extraction this file moves to
// Mashal and subscribes to a "refresh_complete" event from the shared
// service rather than driving the refresh itself.
// ═════════════════════════════════════════════════════════════════════════
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically
// when you set CRON_SECRET as an env var. Reject any call without it.

import crypto from 'node:crypto';
import { supabase } from '../_lib/supabase.js';
import { json, attachTrialState } from '../_lib/auth.js';
import { runSync } from '../_lib/sync.js';
import { generateBrief, generateLiveSignals } from '../_lib/intelligence.js';
import { syncCompetitorsForWorkspace } from '../_lib/competitor-sync.js';
import { renderReportHTML } from '../_lib/report-template.js';
import { renderPdfFromHtml } from '../_lib/pdf.js';
import { uploadFile } from '../_lib/storage.js';
import { sendEmail } from '../_lib/email.js';
import { releaseAllForWorkspace } from '../_lib/handle-registry.js';

// Returns { hour: 0..23, dow: 0..6 (Sun..Sat) } for the workspace's local
// timezone using the Intl API. Falls back to UTC on any failure.
function localClock(timezone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      hour: 'numeric', hour12: false, weekday: 'short',
    });
    const parts = fmt.formatToParts(new Date());
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? -1);
    const weekday = parts.find(p => p.type === 'weekday')?.value || '';
    const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { hour, dow: dowMap[weekday] ?? -1 };
  } catch {
    const d = new Date();
    return { hour: d.getUTCHours(), dow: d.getUTCDay() };
  }
}

// Decide which jobs (if any) should fire for this workspace at this hour.
function jobsFor(workspace) {
  const { hour, dow } = localClock(workspace.timezone || 'UTC');
  const tier = String(workspace.tier || 'creator').toLowerCase();
  const jobs = [];
  if (hour === 6) {
    jobs.push('brief');
    if (dow === 0) {
      jobs.push('weekly-deep');
      // Weekly digest email — only if user opted in AND tier is Pro
      // Creator or above. The /pricing comparison sells the daily/weekly
      // email digest as a Pro Creator+ feature; gate at the cron rather
      // than the toggle so legacy Creator workspaces that previously
      // enabled it stop receiving fresh deliveries until they upgrade.
      if (workspace.weekly_digest_enabled && tier !== 'creator') {
        jobs.push('weekly-digest');
      }
    }
  }
  if (hour === 8 || hour === 13 || hour === 18) {
    // Live signal alerts — Agency tier only (pre-existing behavior,
    // enforced upstream in the brief generator).
    jobs.push('live-signals');
  }
  return { hour, dow, jobs };
}

// Sunday digest: render the current brief into a PDF, store it, and email
// the workspace's configured digest address (falling back to owner email).
// Skips quietly when prerequisites are missing rather than failing the cron.
async function runWeeklyDigest(workspace) {
  // Pull the digest recipient. digest_email column wins; otherwise look up
  // the owner's auth email.
  let recipient = workspace.digest_email || null;
  if (!recipient && workspace.owner_id) {
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_KEY;
      const r = await fetch(`${supabaseUrl}/auth/v1/admin/users/${workspace.owner_id}`, {
        headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
      });
      if (r.ok) {
        const u = await r.json();
        recipient = u?.email || null;
      }
    } catch {}
  }
  if (!recipient) return { skipped: 'no_recipient' };

  // Build brief envelope from current signals.
  const signals = await supabase.select('signals', {
    select: '*', eq: { workspace_id: workspace.id }, order: 'generated_at.desc', limit: 30,
  }).catch(() => []);
  const v = (signals || []).find(s => s.kind === 'verdict' && !s.is_read);
  const actionRows = (signals || [])
    .filter(s => s.kind === 'action' && !s.is_read)
    .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0));
  const competitors = await supabase.select('competitors', {
    select: 'handle,display_name,platform,followers',
    eq: { workspace_id: workspace.id, is_active: true },
  }).catch(() => []);

  const brief = {
    verdict: v ? { title: v.title, body: v.body, score_factors: v.metadata?.score_factors || [] } : null,
    actionPlan: actionRows.map((a, i) => ({
      id: `a${i + 1}`, when: a.metadata?.when || a.impact || 'Today',
      icon: a.metadata?.icon || 'sparkle', title: a.title, body: a.body, cta: a.action,
    })),
    signals: (signals || [])
      .filter(s => s.kind !== 'verdict' && s.kind !== 'action' && !s.is_read)
      .slice(0, 6)
      .map(s => ({ kind: s.kind, label: s.kind, title: s.title, body: s.body })),
    formula: v?.metadata?.formula || null,
    intelScore: v?.metadata?.intel_score || null,
    competitors: (competitors || []).map(c => ({
      handle: c.handle, display_name: c.display_name, platform: c.platform, latest: c.followers,
    })),
  };

  const today = new Date();
  const start = new Date(today); start.setDate(start.getDate() - 7);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const period = `${fmt(start)} → ${fmt(today)}`;

  const inserted = await supabase.insert('reports', {
    workspace_id: workspace.id, kind: 'weekly', period, status: 'rendering',
  });
  const reportRow = inserted?.[0];
  if (!reportRow) return { skipped: 'insert_failed' };

  try {
    const html = renderReportHTML({
      workspace: { name: workspace.name }, brief, generatedAt: new Date().toISOString(),
    });
    const pdf = await renderPdfFromHtml(html, { format: 'A4', landscape: true });
    const path = `${workspace.id}/${reportRow.id}.pdf`;
    await uploadFile('reports', path, pdf, { contentType: 'application/pdf' });

    const filename = `pulse-weekly-${fmt(today)}.pdf`;
    await sendEmail({
      to: recipient,
      subject: `Your Mashal weekly · ${workspace.name}`,
      html: `<p>Hi,</p><p>Your weekly Mashal intelligence brief for <strong>${workspace.name}</strong> is attached.</p>
             ${brief.verdict?.title ? `<p><strong>${brief.verdict.title}</strong></p>` : ''}
             <p>${brief.actionPlan.length} prioritised actions · ${brief.signals.length} signals
                ${brief.intelScore ? `· Intel score ${brief.intelScore}/100` : ''}</p>
             <p style="color:#888;font-size:12px;">— Mashal</p>`,
      text: `Your weekly Mashal brief for ${workspace.name}.\n\n— Mashal`,
      attachments: [{ filename, content: Buffer.from(pdf) }],
    });

    await supabase.update('reports', {
      status: 'ready', pdf_path: path,
      summary: {
        verdict_title: brief.verdict?.title || null,
        actions: brief.actionPlan.length,
        signals: brief.signals.length,
        intel_score: brief.intelScore || null,
      },
      emailed_at: new Date().toISOString(),
    }, { eq: { id: reportRow.id } });

    return { ok: true, recipient };
  } catch (e) {
    await supabase.update('reports',
      { status: 'failed', error: e.message }, { eq: { id: reportRow.id } }
    ).catch(() => {});
    return { error: e.message };
  }
}

async function runWorkspace(workspace) {
  const { hour, dow, jobs } = jobsFor(workspace);
  if (!jobs.length) return { workspace_id: workspace.id, skipped: true };

  const result = { workspace_id: workspace.id, hour, dow, jobs, steps: [] };

  // ── Weekly deep refresh (Sunday 06:00 local) ─────────────────────────
  if (jobs.includes('weekly-deep')) {
    try {
      const s = await runSync(workspace, { mode: 'deep' });
      result.steps.push({ step: 'deep-sync', posts: s.posts, refreshed: s.refreshed });
    } catch (e) {
      result.steps.push({ step: 'deep-sync', error: e.message });
    }
  }

  // ── Morning brief (06:00 local, daily) ───────────────────────────────
  if (jobs.includes('brief')) {
    // Catch-up backfill: pull full history for any account whose first-connect
    // historical backfill never completed (initial_sync_complete=false) — e.g.
    // the connect-time backfill errored, leaving the account with only the thin
    // incremental window. runSync('backfill') self-filters to incomplete
    // accounts and early-returns (no-op) once they're all done, so this is a
    // one-time cost per account and free on the steady state. Runs BEFORE the
    // incremental pull + brief so the morning brief sees the recovered history.
    try {
      const bf = await runSync(workspace, { mode: 'backfill' });
      if (bf.accounts?.length) {
        result.steps.push({ step: 'backfill-catchup', posts: bf.posts, refreshed: bf.refreshed, failed: bf.failed });
      }
    } catch (e) {
      result.steps.push({ step: 'backfill-catchup', error: e.message });
    }

    // If we did NOT run the deep sync this hour, still do an incremental
    // pull so the brief sees fresh data.
    if (!jobs.includes('weekly-deep')) {
      try {
        const s = await runSync(workspace, { mode: 'incremental' });
        result.steps.push({ step: 'incremental-sync', posts: s.posts, refreshed: s.refreshed });
      } catch (e) {
        result.steps.push({ step: 'incremental-sync', error: e.message });
      }
    }
    // Competitor scrape sits with the brief because it's expensive and
    // doesn't need to run more than once a day.
    try {
      const c = await syncCompetitorsForWorkspace(workspace);
      result.steps.push({ step: 'competitors', scraped: c.scraped, total: c.competitors });
    } catch (e) {
      result.steps.push({ step: 'competitors', error: e.message });
    }
    try {
      // Cron-driven brief is system-initiated — record as intelligence_auto
      // so it leaves an audit row but doesn't burn the workspace's monthly
      // user-initiated quota.
      const brief = await generateBrief(workspace, { manual: false });
      result.steps.push({ step: 'brief', ok: !brief?.error, error: brief?.error });
    } catch (e) {
      result.steps.push({ step: 'brief', error: e.message });
    }
  }

  // ── Weekly digest email (Sunday 06:00 local, opted-in) ──────────────
  if (jobs.includes('weekly-digest')) {
    try {
      const r = await runWeeklyDigest(workspace);
      result.steps.push({ step: 'weekly-digest', ...r });
    } catch (e) {
      result.steps.push({ step: 'weekly-digest', error: e.message });
    }
  }

  // ── Live signals (8 / 13 / 18 local) ─────────────────────────────────
  if (jobs.includes('live-signals')) {
    try {
      const sig = await generateLiveSignals(workspace);
      result.steps.push({ step: 'live-signals', new: sig?.new || 0, checked: sig?.checked || 0 });
    } catch (e) {
      result.steps.push({ step: 'live-signals', error: e.message });
    }
  }

  return result;
}

// Trial sweep — finds workspaces whose 7-day window has elapsed without
// conversion, flips trial_locked=true, and releases their handles from
// the registry. Run inside the same hourly tick as everything else;
// idempotent and cheap (skips already-locked rows). Returns a summary.
async function runTrialSweep() {
  const candidates = await supabase.select('workspaces', {
    select: 'id,name,trial_ends_at,trial_converted_at,trial_locked',
  }).catch(() => []);

  const nowMs = Date.now();
  const expired = (candidates || []).filter(w => {
    if (w.trial_locked) return false;          // already locked
    if (w.trial_converted_at) return false;    // converted to paid
    if (!w.trial_ends_at) return false;        // no trial state (legacy)
    return new Date(w.trial_ends_at).getTime() < nowMs;
  });

  const swept = [];
  for (const w of expired) {
    try {
      await supabase.update('workspaces',
        { trial_locked: true },
        { eq: { id: w.id } }
      );
      // Soft-disconnect all accounts so syncs stop running against locked
      // trials. The user can reactivate them on upgrade. Set status too —
      // leaving status='connected' on a deactivated row is the split-state
      // bug that makes the UI show "connected" while sync and the brief
      // treat the account as gone. Scope to is_active=true so we don't stamp
      // a fresh disconnected_at over rows already disconnected earlier.
      await supabase.update('connected_accounts',
        { is_active: false, status: 'disconnected', disconnected_at: new Date().toISOString() },
        { eq: { workspace_id: w.id, is_active: true } }
      ).catch(() => {});
      const released = await releaseAllForWorkspace(w.id, { reason: 'trial_expired' });
      swept.push({ workspace_id: w.id, name: w.name, handles_released: released });
    } catch (e) {
      swept.push({ workspace_id: w.id, error: e.message });
    }
  }
  return { scanned: candidates?.length || 0, expired: expired.length, swept };
}

export default async function handler(req, res) {
  // Auth: CRON_SECRET via Bearer header (Vercel Cron injects this).
  // SECURITY (audit, May 2026): timing-safe comparison so a remote
  // attacker can't byte-by-byte deduce the secret via response timing.
  // Vercel's edge layer also fronts this so realistic exploitability
  // is low, but the fix is one line.
  const secret = process.env.CRON_SECRET;
  const header = req.headers?.authorization || '';
  const expected = secret ? `Bearer ${secret}` : '';
  if (!secret
      || header.length !== expected.length
      || !crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected))) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  // On-demand regeneration: GET/POST /api/cron/hourly?force=1 (same CRON_SECRET
  // auth as the scheduled tick) regenerates the morning brief for EVERY eligible
  // workspace right now, ignoring the local-clock gate. It generates from the
  // data already in the DB (no sync / competitor scrape) so the whole fan-out
  // stays well inside the function budget; the scheduled 06:00 run still does
  // the full sync-then-brief. Use it to backfill briefs for accounts that
  // missed a morning run (e.g. after a fix) without waiting for tomorrow.
  const force = (req.query?.force ?? '').toString() === '1';

  // Trial sweep runs first — locking expired trials before the per-
  // workspace fan-out means a workspace that just expired won't get one
  // more brief generated on its way out.
  let trial_sweep = null;
  try { trial_sweep = await runTrialSweep(); } catch (e) { trial_sweep = { error: e.message }; }

  const workspaces = await supabase.select('workspaces', {
    // trial_started_at/ends_at/converted_at feed attachTrialState() below, which
    // sets ws.trial_active — the flag the sync layer keys on to choose the Apify
    // scrape path (trials) vs the paid Zernio /analytics path. Without these the
    // cron synced every trial account through Zernio, which returns [] without the
    // paid add-on → 0 posts every morning → stale/empty briefs.
    // stripe_subscription_status/current_period_end feed attachTrialState()'s
    // subscription-lapse check so a converted customer whose sub has since
    // been canceled/unpaid is treated as locked here too — not just on the
    // request path — and stops receiving auto-syncs and morning briefs.
    select: 'id,name,tier,timezone,account_age,zernio_profile_id,owner_id,weekly_digest_enabled,digest_email,trial_locked,trial_started_at,trial_ends_at,trial_converted_at,stripe_subscription_status,stripe_current_period_end',
  }).catch(() => []);

  // Sequential to stay under the 60s function budget. With 50ish workspaces
  // and most no-op at any given hour, we're well under.
  const results = [];
  for (const ws of (workspaces || [])) {
    // Derive trial_active (+locked/days_left/lock_reason) in-memory FIRST so
    // runSync picks the right data path (trial → Apify scrape, paid → Zernio
    // analytics) and so the lock check below sees the freshly-computed state.
    // Mirrors exactly what authenticate() does on the request path.
    attachTrialState(ws);
    // Skip locked workspaces — they're dormant until they (re)subscribe.
    // This now covers both expired-unconverted trials and converted
    // customers whose subscription has lapsed (canceled/unpaid), so neither
    // burns an auto-sync or a morning brief. Computed here rather than read
    // from the persisted column so the lapse case is caught without waiting
    // for a sweep to write it.
    if (ws.trial_locked) { results.push({ workspace_id: ws.id, skipped: true, reason: ws.lock_reason || 'trial_locked' }); continue; }
    try {
      if (force) {
        // Generate the brief immediately from current data (no sync). Records
        // as 'intelligence_auto' so it doesn't burn the workspace's quota.
        const brief = await generateBrief(ws, { manual: false });
        results.push({
          workspace_id: ws.id, name: ws.name, forced: true,
          ok: !brief?.error && !brief?.skipped,
          ...(brief?.error ? { error: brief.error } : {}),
          ...(brief?.skipped ? { skipped_reason: brief.skipped } : {}),
        });
      } else {
        results.push(await runWorkspace(ws));
      }
    } catch (e) {
      results.push({ workspace_id: ws.id, error: e.message });
    }
  }

  return json(res, 200, {
    ran_at: new Date().toISOString(),
    utc_hour: new Date().getUTCHours(),
    forced: force,
    workspaces_scanned: workspaces.length,
    trial_sweep,
    // In force mode surface every workspace (incl. no-data) so the caller can
    // see exactly who got a brief; the scheduled tick stays terse.
    results: force ? results : results.filter(r => !r.skipped),
  });
}
