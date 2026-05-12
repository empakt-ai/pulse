// ═════════════════════════════════════════════════════════════════════════
// [PULSE-SPECIFIC] Active model selector for the current workspace.
// Reads/writes the workspaces.ai_model column. The cron and the manual
// intelligence trigger both consult this field when picking a provider.
// ═════════════════════════════════════════════════════════════════════════
//
//   GET   /api/workspace/ai-model  → { ai_model, workspace_id }
//   PATCH /api/workspace/ai-model  body: { ai_model: 'claude' | 'gemini' }
//                                  → { success, ai_model, message }

import { authenticate, json } from '../_lib/auth.js';
import { supabase } from '../_lib/supabase.js';

const VALID = new Set(['claude', 'gemini']);

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  if (req.method === 'GET') {
    return json(res, 200, {
      workspace_id: ws.id,
      ai_model: ws.ai_model || 'claude',
    });
  }

  if (req.method === 'PATCH') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const next = String(body?.ai_model || '').toLowerCase();
    if (!VALID.has(next)) {
      return json(res, 400, { error: `ai_model must be one of ${[...VALID].join(', ')}` });
    }
    try {
      const rows = await supabase.update('workspaces', { ai_model: next }, { eq: { id: ws.id } });
      return json(res, 200, {
        success: true,
        ai_model: rows?.[0]?.ai_model || next,
        message: `Intelligence switched to ${next === 'gemini' ? 'Gemini (Google)' : 'Claude (Anthropic)'}.`,
      });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  return json(res, 405, { error: 'Method not allowed' });
}
