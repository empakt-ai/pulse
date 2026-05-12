// ═════════════════════════════════════════════════════════════════════════
// [PULSE-SPECIFIC] Run the identical intelligence prompt against both
// Claude and Gemini in parallel, return both outputs side-by-side. Does
// NOT touch the signals table — comparison only, no live state mutated.
// ═════════════════════════════════════════════════════════════════════════
//
//   POST /api/analytics/compare-models
//
// Uses the latest synced data already in Supabase (no fresh Zernio /
// Apify calls). Returns:
//   { claude: { brief, signals, top_actions, latency_ms, tokens_used },
//     gemini: { brief, signals, top_actions, latency_ms, tokens_used } }

import { authenticate, json } from '../_lib/auth.js';
import { supabase } from '../_lib/supabase.js';
import { parseJsonResponse } from '../_lib/anthropic.js';
import { generateIntelligence } from '../_lib/ai-router.js';

// Re-export the prompt + payload builder from intelligence.js by importing
// them dynamically. They are not exported by default; we import the system
// constants by side-effect through generateBrief… instead, duplicate the
// minimal shape needed here. (Keeps the comparison endpoint independent of
// generateBrief's internal flow.)
import { buildBriefPrompt } from '../_lib/intelligence.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  // Same data the morning brief reads — never re-fetch from providers here.
  const [accounts, posts, snapshots, competitors] = await Promise.all([
    supabase.select('connected_accounts', { select: '*', eq: { workspace_id: ws.id } }).catch(() => []),
    supabase.select('posts', { select: '*', eq: { workspace_id: ws.id }, order: 'posted_at.desc', limit: 200 }).catch(() => []),
    supabase.select('account_snapshots', { select: '*', eq: { workspace_id: ws.id }, order: 'snapshot_date.desc', limit: 30 }).catch(() => []),
    supabase.select('competitors', { select: '*', eq: { workspace_id: ws.id } }).catch(() => []),
  ]);

  if (!accounts?.length || !posts?.length) {
    return json(res, 200, {
      skipped: 'insufficient_data',
      accounts: accounts?.length || 0,
      posts: posts?.length || 0,
    });
  }

  const { system, user } = buildBriefPrompt({ workspace: ws, accounts, posts, snapshots, competitors });

  // Fire both providers in parallel. Each call's router does its own
  // fallback, so a transient failure from one provider doesn't poison
  // the comparison — we report both regardless.
  const [claudeResult, geminiResult] = await Promise.allSettled([
    generateIntelligence({ system, user, model: 'claude', max_tokens: 3000, temperature: 0.6 }),
    generateIntelligence({ system, user, model: 'gemini', max_tokens: 3000, temperature: 0.6 }),
  ]);

  // Shape both into the side-by-side payload the SPA expects.
  const shape = (settled, label) => {
    if (settled.status === 'rejected') {
      return {
        error: settled.reason?.message || String(settled.reason),
        model: label,
        // Both providers failed — surface what each returned so we can
        // tell whether it was a quota, safety block, or empty response.
        primary_error: settled.reason?.primary_error,
        fallback_error: settled.reason?.fallback_error,
      };
    }
    const r = settled.value;
    const parsed = parseJsonResponse(r.text);
    const parsedOk = parsed && (parsed.verdict || parsed.actions || parsed.signals);
    return {
      model_used: r.model_used,
      model_requested: r.model_requested,
      fallback_from: r.fallback_from,
      fallback_reason: r.fallback_reason,
      latency_ms: r.latency_ms,
      tokens_used: r.tokens_used,
      cost_cents: r.cost_cents,
      brief: {
        verdict: parsed?.verdict || null,
      },
      top_actions: (parsed?.actions || []).slice(0, 3).map(a => a.title).filter(Boolean),
      signals: (parsed?.signals || []).slice(0, 5).map(s => ({
        kind: s.kind, platform: s.platform, title: s.title, impact: s.impact,
      })),
      // When parsing failed, ship the raw text so the SPA can show it
      // (and we can see exactly what the model emitted). Capped at 600
      // chars to stay friendly to the panel.
      raw_excerpt: parsedOk ? null : (r.text || '').slice(0, 600),
      parse_failed: !parsedOk,
    };
  };

  return json(res, 200, {
    claude: shape(claudeResult, 'claude'),
    gemini: shape(geminiResult, 'gemini'),
    generated_at: new Date().toISOString(),
  });
}
