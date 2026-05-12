// ═════════════════════════════════════════════════════════════════════════
// [PULSE-SPECIFIC] Layer-2 cron dispatcher. Vercel triggers this at the
// top of every hour; we fan out to every workspace, check what its local
// clock currently reads, and dispatch the right job:
//
//   06:00 local, Mon–Sat → morning brief (incremental sync + generateBrief)
//   06:00 local, Sunday  → weekly deep sync (mode='deep') + morning brief
//   08:00 / 13:00 / 18:00 local → live signals (pattern-detection only,
//                                  append-only; no full brief regen)
//
// The shared data-fetch layer (api/_lib/sync.js) handles persistence; the
// PULSE-specific intelligence layer (api/_lib/intelligence.js) handles
// signal generation. After the platform extraction this file moves to
// PULSE and subscribes to a "refresh_complete" event from the shared
// service rather than driving the refresh itself.
// ═════════════════════════════════════════════════════════════════════════
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically
// when you set CRON_SECRET as an env var. Reject any call without it.

import { supabase } from '../_lib/supabase.js';
import { json } from '../_lib/auth.js';
import { runSync } from '../_lib/sync.js';
import { generateBrief, generateLiveSignals } from '../_lib/intelligence.js';
import { syncCompetitorsForWorkspace } from '../_lib/competitor-sync.js';
import { renderReportHTML } from '../_lib/report-template.js';
import { renderPdfFromHtml } from '../_lib/pdf.js';
import { uploadFile } from '../_lib/storage.js';
import { sendEmail } from '../_lib/email.js';

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
  const jobs = [];
  if (hour === 6) {
    jobs.push('brief');
    if (dow === 0) {
      jobs.push('weekly-deep');
      // Weekly digest email — only if user opted in. Runs AFTER the brief
      // job below so we email the freshly-regenerated content.
      if (workspace.weekly_digest_enabled) jobs.push('weekly-digest');
    }
  }
  if (hour === 8 || hour === 13 || hour === 18) {
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
      subject: `Your PULSE weekly · ${workspace.name}`,
      html: `<p>Hi,</p><p>Your weekly PULSE intelligence brief for <strong>${workspace.name}</strong> is attached.</p>
             ${brief.verdict?.title ? `<p><strong>${brief.verdict.title}</strong></p>` : ''}
             <p>${brief.actionPlan.length} prioritised actions · ${brief.signals.length} signals
                ${brief.intelScore ? `· Intel score ${brief.intelScore}/100` : ''}</p>
             <p style="color:#888;font-size:12px;">— PULSE</p>`,
      text: `Your weekly PULSE brief for ${workspace.name}.\n\n— PULSE`,
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
      const brief = await generateBrief(workspace);
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

export default async function handler(req, res) {
  // Auth: CRON_SECRET via Bearer header (Vercel Cron injects this).
  const secret = process.env.CRON_SECRET;
  const header = req.headers?.authorization || '';
  if (!secret || header !== `Bearer ${secret}`) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  const workspaces = await supabase.select('workspaces', {
    select: 'id,name,tier,timezone,account_age,zernio_profile_id,owner_id,weekly_digest_enabled,digest_email',
  }).catch(() => []);

  // Sequential to stay under the 60s function budget. With 50ish workspaces
  // and most no-op at any given hour, we're well under.
  const results = [];
  for (const ws of (workspaces || [])) {
    try {
      results.push(await runWorkspace(ws));
    } catch (e) {
      results.push({ workspace_id: ws.id, error: e.message });
    }
  }

  return json(res, 200, {
    ran_at: new Date().toISOString(),
    utc_hour: new Date().getUTCHours(),
    workspaces_scanned: workspaces.length,
    results: results.filter(r => !r.skipped),
  });
}
