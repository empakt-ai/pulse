// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Brief-tone preference for the current workspace.
// Replaces the old Claude/Gemini selector during the Gemini-only phase.
// Endpoint path kept as /workspace/ai-model so we don't break URLs; the
// internal column it writes to is now `brief_tone`. When public model
// selection ships, this file pivots back.
// ═════════════════════════════════════════════════════════════════════════
//
//   GET   /api/workspace/ai-model
//     → { workspace_id, brief_tone: 'analytical' | 'strategic' | 'executive' }
//
//   PATCH /api/workspace/ai-model
//     body: { brief_tone: 'analytical' | 'strategic' | 'executive' }
//     → { success, brief_tone, message }

import { authenticate, json } from '../_lib/auth.js';
import { supabase } from '../_lib/supabase.js';

const VALID = new Set(['analytical', 'strategic', 'executive']);
const LABEL = {
  analytical: 'Analytical · data-heavy',
  strategic:  'Strategic · balanced',
  executive:  'Executive · short + direct',
};

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  if (req.method === 'GET') {
    return json(res, 200, {
      workspace_id: ws.id,
      brief_tone: ws.brief_tone || 'strategic',
    });
  }

  if (req.method === 'PATCH') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const next = String(body?.brief_tone || '').toLowerCase();
    if (!VALID.has(next)) {
      return json(res, 400, { error: `brief_tone must be one of ${[...VALID].join(', ')}` });
    }
    try {
      const rows = await supabase.update('workspaces', { brief_tone: next }, { eq: { id: ws.id } });
      return json(res, 200, {
        success: true,
        brief_tone: rows?.[0]?.brief_tone || next,
        message: `Brief tone switched to ${LABEL[next]}.`,
      });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  return json(res, 405, { error: 'Method not allowed' });
}
