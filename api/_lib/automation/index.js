// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Automation engine — public surface.
// ═════════════════════════════════════════════════════════════════════════
//
// Two entry points wire the engine into the rest of the app:
//   ingestFromWebhook(event) — called (flag-gated) from api/webhooks/zernio.js
//                              when a feed event arrives
//   tick({ limit })          — called by api/cron/automation.js every couple
//                              of minutes to run due delayed/timed work
//
// Both are inert unless AUTOMATION_ENGINE is on, so importing/deploying this
// module never changes production behavior on its own.

import { supabase } from '../supabase.js';
import { engineEnabled } from './flags.js';
import { onComment, onMessage } from './ingest.js';
import { resumeRun, handleReplyTimeout } from './runner.js';
import { listDueJobs, claimJob, completeJob, failJob } from './jobs.js';

// Route a normalized webhook event to the right ingest path. `event` carries
// the fields api/webhooks/zernio.js already resolved (workspaceId, accountId,
// zernioAccountId, platform, platformPostId, postId, authorHandle, text, and
// the full `payload`). Returns a small summary for the webhook's ACK body.
export async function ingestFromWebhook(event) {
  if (!engineEnabled()) return { disabled: true };
  const k = String(event?.kind || '').toLowerCase();
  try {
    if (k.includes('comment')) return { comment: await onComment(event) };
    if (k === 'message.received') return { message: await onMessage(event) };
    return { ignored: k };
  } catch (e) {
    console.warn('[automation] ingest error:', e.message);
    return { error: e.message };
  }
}

// Process one job by kind. Returns a summary; throws only on unexpected errors
// (the worker turns a throw into a retry/fail).
async function processJob(job) {
  const run = job.run_id
    ? await supabase.select('automation_runs', { select: '*', eq: { id: job.run_id }, limit: 1, single: true }).catch(() => null)
    : null;

  if (job.kind === 'resume') {
    if (!run) return { skipped: 'run_missing' };
    if (run.status !== 'waiting') return { skipped: `run_${run.status}` };  // reply already resumed it, etc.
    return resumeRun(run);
  }
  if (job.kind === 'timeout') {
    if (!run) return { skipped: 'run_missing' };
    return handleReplyTimeout(run);
  }
  if (job.kind === 'sweep') {
    return { swept: true };   // reserved for future housekeeping
  }
  return { skipped: `unknown_kind:${job.kind}` };
}

// The worker. Claims due jobs one at a time (optimistic lock) and runs them.
// Sequential to stay well inside the function budget and to avoid hammering
// Zernio; the 2-minute cadence plus small batch keeps latency acceptable.
export async function tick({ limit = 25 } = {}) {
  if (!engineEnabled()) return { disabled: true };

  const due = await listDueJobs(limit);
  const processed = [];
  for (const job of (due || [])) {
    const claimed = await claimJob(job);
    if (!claimed) continue;                  // another worker won it
    try {
      const r = await processJob(claimed);
      await completeJob(claimed.id);
      processed.push({ job_id: claimed.id, kind: claimed.kind, ...r });
    } catch (e) {
      const outcome = await failJob(claimed, e);
      processed.push({ job_id: claimed.id, kind: claimed.kind, error: e.message, ...outcome });
    }
  }
  return { claimed: processed.length, jobs: processed };
}

export { engineEnabled };
export default { ingestFromWebhook, tick, engineEnabled };
