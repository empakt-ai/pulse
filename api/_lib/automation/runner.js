// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Automation engine — the runner (step interpreter).
// ═════════════════════════════════════════════════════════════════════════
//
// A "run" is one execution of a flow for one contact. The runner walks the
// flow's step array, executing each handler until it hits something that must
// pause (a delay, or a wait_for_reply). At that point it persists the run as
// 'waiting', schedules a job, and returns — the worker (or the message
// webhook) resumes it later from exactly where it stopped.
//
// Execution is at-least-once by construction: a crash mid-advance leaves the
// run at its last persisted step and may re-run the current step. We persist
// only at pause/finish boundaries, and keep non-idempotent side effects
// (sends) between boundaries, so the common path never double-sends. Hardening
// this to exactly-once (per-step idempotency keys) is a later concern; the
// tables already carry enough (trigger_ref, run identity) to add it without a
// migration.

import { supabase } from '../supabase.js';
import { getStepHandler } from './steps.js';
import { enqueueJob, cancelJobsForRun } from './jobs.js';
import { logEvent, bumpFlowStat } from './events.js';

// Guard against a malformed flow spinning the loop forever.
const MAX_STEPS_PER_ADVANCE = 100;

async function persistRun(runId, patch) {
  await supabase.update('automation_runs',
    { ...patch, updated_at: new Date().toISOString() }, { eq: { id: runId } }
  ).catch((e) => console.warn('[automation] persistRun failed:', e.message));
}

async function finishRun(run, flow, status, meta = {}) {
  await persistRun(run.id, { status, wait_kind: null });
  if (status === 'done') {
    await bumpFlowStat(flow.id, 'stat_completed');
    await logEvent({ workspaceId: flow.workspace_id, flowId: flow.id, runId: run.id, contactId: run.contact_id, kind: 'completed' });
  } else {
    await logEvent({ workspaceId: flow.workspace_id, flowId: flow.id, runId: run.id, contactId: run.contact_id, kind: status, meta });
  }
}

// Walk the flow from run.current_step until a pause / end. `contact` is passed
// through the ctx so step handlers can read/mutate it without re-fetching.
export async function advance(run, flow, contact) {
  const steps = Array.isArray(flow.definition) ? flow.definition : [];
  const ctx = { flow, contact, run, context: run.context || {} };
  let i = Number(run.current_step) || 0;

  for (let guard = 0; guard < MAX_STEPS_PER_ADVANCE; guard++) {
    if (i >= steps.length) { await finishRun(run, flow, 'done'); return { status: 'done' }; }

    const step = steps[i];
    const handler = getStepHandler(step?.type);
    if (!handler) { await finishRun(run, flow, 'failed', { reason: `unknown step type: ${step?.type}`, step: i }); return { status: 'failed' }; }

    let action;
    try {
      action = await handler(step, ctx);
    } catch (e) {
      await finishRun(run, flow, 'failed', { reason: e.message, step: i });
      return { status: 'failed' };
    }

    if (action?.next) { i += 1; continue; }
    if (action?.jump != null && Number.isFinite(Number(action.jump))) { i = Number(action.jump); continue; }
    if (action?.done) { run.context = ctx.context; await persistCtx(run); await finishRun(run, flow, 'done'); return { status: 'done' }; }
    if (action?.fail) { run.context = ctx.context; await persistCtx(run); await finishRun(run, flow, 'failed', { reason: action.fail, step: i }); return { status: 'failed' }; }

    if (action?.wait) {
      // Resume position is the step AFTER the pausing step. A delay simply
      // continues; a wait_for_reply's next step (usually a condition) runs once
      // the reply lands and ingest has refreshed follower state.
      const resumeStep = i + 1;
      const patch = {
        status: 'waiting',
        wait_kind: action.wait.kind,
        current_step: resumeStep,
        context: ctx.context,
        expires_at: action.wait.expiresAt || null,
      };
      await persistRun(run.id, patch);

      if (action.wait.kind === 'delay') {
        await enqueueJob({ workspaceId: flow.workspace_id, runId: run.id, flowId: flow.id, runAt: action.wait.resumeAt, kind: 'resume', payload: { reason: 'delay' } });
      } else if (action.wait.kind === 'reply') {
        // The timeout job fires only if no reply arrives; ingest cancels it on reply.
        await enqueueJob({ workspaceId: flow.workspace_id, runId: run.id, flowId: flow.id, runAt: action.wait.expiresAt, kind: 'timeout', payload: { wait_step: i } });
      }
      return { status: 'waiting', kind: action.wait.kind };
    }

    // Handler returned nothing usable — treat as advance to avoid a stall.
    i += 1;
  }

  await finishRun(run, flow, 'failed', { reason: 'step budget exhausted (possible loop)' });
  return { status: 'failed' };
}

async function persistCtx(run) {
  await persistRun(run.id, { context: run.context || {} });
}

// Create a run for (flow, contact) and drive it to its first pause. The
// partial unique index (flow_id, contact_id WHERE status IN active|waiting)
// makes this idempotent: a repeat trigger while a run is still in flight hits
// a 23505 and we no-op instead of starting a duplicate.
export async function startRun(flow, contact, { triggerRef = null, context = {} } = {}) {
  let run;
  try {
    const res = await supabase.insert('automation_runs', {
      workspace_id: flow.workspace_id,
      flow_id: flow.id,
      contact_id: contact.id,
      status: 'active',
      current_step: 0,
      context,
      trigger_ref: triggerRef,
    });
    run = Array.isArray(res) ? res[0] : res;
  } catch (e) {
    if (/duplicate key|unique/i.test(e.message)) {
      return { skipped: 'already_running' };
    }
    throw e;
  }
  await bumpFlowStat(flow.id, 'stat_triggered');
  await logEvent({ workspaceId: flow.workspace_id, flowId: flow.id, runId: run.id, contactId: contact.id, kind: 'triggered', meta: { trigger_ref: triggerRef } });
  const result = await advance(run, flow, contact);
  return { run_id: run.id, ...result };
}

// Resume a waiting run (worker resume job, or an inbound reply). Reloads the
// flow + contact fresh so a mid-flight edit or follower update is seen.
export async function resumeRun(run) {
  const flow = await supabase.select('automation_flows', {
    select: '*', eq: { id: run.flow_id }, limit: 1, single: true,
  }).catch(() => null);
  const contact = await supabase.select('automation_contacts', {
    select: '*', eq: { id: run.contact_id }, limit: 1, single: true,
  }).catch(() => null);
  if (!flow || !contact) { await persistRun(run.id, { status: 'failed' }); return { status: 'failed', reason: 'flow_or_contact_missing' }; }
  if (!flow.is_active) { await persistRun(run.id, { status: 'expired' }); return { status: 'expired', reason: 'flow_inactive' }; }
  await persistRun(run.id, { status: 'active' });
  run.status = 'active';
  return advance(run, flow, contact);
}

// A wait_for_reply window elapsed with no reply. If the pausing step declared
// an on_timeout target, jump there (e.g. send a follow nudge); otherwise the
// run quietly expires.
export async function handleReplyTimeout(run) {
  if (run.status !== 'waiting' || run.wait_kind !== 'reply') return { status: run.status, skipped: true };
  const flow = await supabase.select('automation_flows', {
    select: '*', eq: { id: run.flow_id }, limit: 1, single: true,
  }).catch(() => null);
  const contact = await supabase.select('automation_contacts', {
    select: '*', eq: { id: run.contact_id }, limit: 1, single: true,
  }).catch(() => null);
  if (!flow || !contact) { await persistRun(run.id, { status: 'expired' }); return { status: 'expired' }; }

  const steps = Array.isArray(flow.definition) ? flow.definition : [];
  const waitStep = steps[Math.max(0, (Number(run.current_step) || 1) - 1)];
  const onTimeout = waitStep?.on_timeout;
  if (Number.isFinite(Number(onTimeout))) {
    await persistRun(run.id, { status: 'active', wait_kind: null, current_step: Number(onTimeout) });
    run.current_step = Number(onTimeout);
    run.status = 'active';
    return advance(run, flow, contact);
  }
  await finishRun(run, flow, 'expired', { reason: 'no_reply' });
  return { status: 'expired' };
}

export { finishRun, persistRun, cancelJobsForRun };
export default { startRun, advance, resumeRun, handleReplyTimeout };
