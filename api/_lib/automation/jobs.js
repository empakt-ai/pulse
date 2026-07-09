// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Automation engine — the timed-work scheduler.
// ═════════════════════════════════════════════════════════════════════════
//
// Every pause in a flow becomes a row in automation_jobs with a run_at. The
// cron worker (api/cron/automation.js) wakes every couple of minutes, claims
// the due ones, and hands each back to the runner. Job kinds:
//   resume  — a delay elapsed; continue the run from where it paused
//   timeout — a wait_for_reply expired; take the no-reply branch / expire
//   sweep   — housekeeping (future: expire stale runs, reconcile)
//
// Concurrency: two overlapping cron invocations must never process the same
// job. We don't have SELECT … FOR UPDATE SKIP LOCKED through PostgREST, so we
// use an OPTIMISTIC claim — a guarded UPDATE that only matches while the row
// is still 'pending'. PostgREST returns the updated representation, so a
// non-empty result means WE won the row; an empty result means someone else
// already claimed it and we move on.

import { supabase } from '../supabase.js';

// Schedule a unit of future work. `runAt` is a Date or ISO string.
export async function enqueueJob({ workspaceId, runId = null, flowId = null, runAt, kind, payload = {} }) {
  const runAtIso = runAt instanceof Date ? runAt.toISOString() : String(runAt);
  const res = await supabase.insert('automation_jobs', {
    workspace_id: workspaceId,
    run_id: runId,
    flow_id: flowId,
    run_at: runAtIso,
    kind,
    payload,
    status: 'pending',
  }).catch((e) => { console.warn('[automation] enqueueJob failed:', e.message); return null; });
  return Array.isArray(res) ? res[0] : res;
}

// Fetch a batch of due, pending jobs (oldest first). This is only the
// candidate list — each still has to be claimed atomically before we act on
// it, because a concurrent worker may be looking at the same rows.
export async function listDueJobs(limit = 25) {
  const nowIso = new Date().toISOString();
  return supabase.select('automation_jobs', {
    select: '*',
    eq: { status: 'pending' },
    lte: { run_at: nowIso },
    order: 'run_at.asc',
    limit,
  }).catch((e) => { console.warn('[automation] listDueJobs failed:', e.message); return []; });
}

// Optimistically claim one job. Returns the claimed row if we won it, else
// null (already claimed / no longer pending). The `eq: { status:'pending' }`
// guard is the whole trick — only one writer can flip it away from pending.
export async function claimJob(job) {
  const res = await supabase.update('automation_jobs',
    { status: 'processing', locked_at: new Date().toISOString(), attempts: (Number(job.attempts) || 0) + 1 },
    { eq: { id: job.id, status: 'pending' } }
  ).catch((e) => { console.warn('[automation] claimJob failed:', e.message); return null; });
  const row = Array.isArray(res) ? res[0] : res;
  return row || null;   // empty array → lost the race
}

// Mark a claimed job done.
export async function completeJob(jobId) {
  await supabase.update('automation_jobs',
    { status: 'done' }, { eq: { id: jobId } }
  ).catch(() => {});
}

// Fail a claimed job. Retries up to MAX_ATTEMPTS by returning it to 'pending'
// with a backed-off run_at; past that it's terminal 'failed'.
const MAX_ATTEMPTS = 4;
export async function failJob(job, error) {
  const attempts = Number(job.attempts) || 0;
  const msg = String(error?.message || error || 'unknown').slice(0, 500);
  if (attempts < MAX_ATTEMPTS) {
    // Exponential-ish backoff: 2, 4, 8 minutes.
    const delayMin = Math.pow(2, attempts);
    const nextRun = new Date(Date.now() + delayMin * 60_000).toISOString();
    await supabase.update('automation_jobs',
      { status: 'pending', run_at: nextRun, locked_at: null, last_error: msg },
      { eq: { id: job.id } }
    ).catch(() => {});
    return { retried: true, in_minutes: delayMin };
  }
  await supabase.update('automation_jobs',
    { status: 'failed', last_error: msg }, { eq: { id: job.id } }
  ).catch(() => {});
  return { failed: true };
}

// Cancel any still-pending jobs for a run. Used when a reply arrives before
// the wait_for_reply timeout fires — the timeout job must not also run.
export async function cancelJobsForRun(runId, { kinds = null } = {}) {
  if (!runId) return;
  // PostgREST can't filter status IN (pending,processing) AND kind IN (…) via
  // our thin wrapper's eq-only PATCH, so cancel the pending ones by run + kind
  // in a targeted pass. Pending is the only cancelable state (processing means
  // a worker already owns it).
  const rows = await supabase.select('automation_jobs', {
    select: 'id,kind', eq: { run_id: runId, status: 'pending' },
  }).catch(() => []);
  for (const r of (rows || [])) {
    if (kinds && !kinds.includes(r.kind)) continue;
    await supabase.update('automation_jobs',
      { status: 'canceled' }, { eq: { id: r.id } }
    ).catch(() => {});
  }
}

export default { enqueueJob, listDueJobs, claimJob, completeJob, failJob, cancelJobsForRun };
