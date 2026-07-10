// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Automation engine — comment_automation ⇄ native flow sync.
// ═════════════════════════════════════════════════════════════════════════
//
// The bridge between the config the UI writes (comment_automations) and the
// flow the engine runs (automation_flows). When a rule needs a delay or a
// follow-gate, we compile it here into a native flow and link the two. The
// Zernio-twin teardown (so a native rule never double-sends) stays in
// api/engage/automations.js, which owns the Zernio calls — this module only
// touches automation_flows.

import { supabase } from '../supabase.js';
import { buildFlowDefinition, buildTrigger } from './flow-builder.js';

// Compile a comment_automation's config into its native flow, creating or
// updating the linked automation_flows row. Returns { flowId, definition,
// trigger }. Caller persists flowId onto comment_automations.flow_id.
export async function syncAutomationToEngine(automation, { workspaceId, accountId, zernioAccountId, platform, createdBy = null }) {
  const definition = buildFlowDefinition({
    dmMessage: automation.dm_message,
    commentReply: automation.comment_reply,
    delay: { min_seconds: automation.delay_min_seconds, max_seconds: automation.delay_max_seconds },
    requireFollow: automation.require_follow,
    followPrompt: automation.follow_prompt,
    rePrompt: automation.reprompt,
    buttons: automation.buttons,
    triggerType: automation.trigger_type,
  });
  const trigger = buildTrigger({
    keywords: automation.keywords, matchMode: automation.match_mode, triggerType: automation.trigger_type,
  });

  const base = {
    workspace_id: workspaceId,
    account_id: accountId,
    zernio_account_id: zernioAccountId,
    platform,
    name: automation.name || 'Comment automation',
    is_active: automation.is_active !== false,
    trigger,
    definition,
    source: 'comment_automation',
    comment_automation_id: automation.id,
    updated_at: new Date().toISOString(),
  };

  let flow = null;
  if (automation.flow_id) {
    const upd = await supabase.update('automation_flows', base, { eq: { id: automation.flow_id } }).catch(() => null);
    flow = Array.isArray(upd) ? upd[0] : upd;
  }
  if (!flow) {
    const ins = await supabase.insert('automation_flows', { ...base, created_by: createdBy }).catch((e) => {
      console.warn('[automation] syncAutomationToEngine insert failed:', e.message);
      return null;
    });
    flow = Array.isArray(ins) ? ins[0] : ins;
  }
  return { flowId: flow?.id || null, definition, trigger };
}

// Deactivate the native flow for an automation (switching back to Zernio, or on
// delete). Soft-deactivate so in-flight runs + audit survive; the ingest skips
// inactive flows. Keeps the flow_id link so a later switch-to-native reuses it.
export async function removeEngineFlow(automation) {
  if (!automation?.flow_id) return;
  await supabase.update('automation_flows',
    { is_active: false, updated_at: new Date().toISOString() },
    { eq: { id: automation.flow_id } }
  ).catch((e) => console.warn('[automation] removeEngineFlow failed:', e.message));
}

export default { syncAutomationToEngine, removeEngineFlow };
