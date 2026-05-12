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
    if (dow === 0) jobs.push('weekly-deep');
  }
  if (hour === 8 || hour === 13 || hour === 18) {
    jobs.push('live-signals');
  }
  return { hour, dow, jobs };
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
    select: 'id,name,tier,timezone,account_age,zernio_profile_id',
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
