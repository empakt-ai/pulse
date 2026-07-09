// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Automation engine — append-only event log + stat rollups.
// ═════════════════════════════════════════════════════════════════════════
//
// automation_events is the source of truth for "what happened" (analytics,
// debugging, the future per-flow activity timeline). automation_flows.stat_*
// are cached counters we bump alongside so the flow list can show totals
// without scanning the event table. Events are best-effort: a failed audit
// write must never abort a run, so every call here swallows its own errors.

import { supabase } from '../supabase.js';

// Record one thing that happened. `kind` is a short verb slug
// (triggered | dm_sent | dm_failed | comment_replied | reply_received |
//  follow_verified | gate_prompted | completed | failed | expired …).
export async function logEvent({ workspaceId, flowId = null, runId = null, contactId = null, kind, meta = {} }) {
  try {
    await supabase.insert('automation_events', {
      workspace_id: workspaceId,
      flow_id: flowId,
      run_id: runId,
      contact_id: contactId,
      kind,
      meta,
    }, { returning: 'minimal' });
  } catch (e) {
    console.warn('[automation] logEvent failed:', kind, e.message);
  }
}

// Increment a cached counter on the flow. PostgREST can't do `col = col + n`
// in a plain PATCH, so we read-then-write. The race (two workers bumping the
// same stat) can undercount by a hair — acceptable for a display cache whose
// authoritative truth is automation_events. Never throws.
export async function bumpFlowStat(flowId, column, by = 1) {
  const ALLOWED = new Set(['stat_triggered', 'stat_dms_sent', 'stat_dms_failed', 'stat_completed']);
  if (!ALLOWED.has(column)) return;
  try {
    const row = await supabase.select('automation_flows', {
      select: `id,${column}`, eq: { id: flowId }, limit: 1, single: true,
    });
    if (!row) return;
    await supabase.update('automation_flows',
      { [column]: (Number(row[column]) || 0) + by, updated_at: new Date().toISOString() },
      { eq: { id: flowId } });
  } catch (e) {
    console.warn('[automation] bumpFlowStat failed:', column, e.message);
  }
}

export default { logEvent, bumpFlowStat };
