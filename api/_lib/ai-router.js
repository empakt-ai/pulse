// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// Single entry point for intelligence generation. Picks Claude or Gemini
// based on workspace.ai_model, measures latency, and falls back to the
// other provider if the primary errors out. Callers stay model-agnostic.
//
// Returns { text, model_used, model_requested, latency_ms, tokens_used,
//           fallback_from?, fallback_reason? }.
// ═════════════════════════════════════════════════════════════════════════

import { messages as claudeMessages, estimateCostCents as claudeCost } from './anthropic.js';
import { call as geminiCall, estimateCostCents as geminiCost } from './gemini.js';

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const GEMINI_MODEL = 'gemini-2.5-flash';

// Call Claude with our standard intelligence shape. Returns the normalised
// envelope the router consumes.
async function runClaude({ system, user, max_tokens, temperature }) {
  const res = await claudeMessages({
    model: CLAUDE_MODEL,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
    max_tokens, temperature,
  });
  return {
    text: res.text,
    model: res.model || CLAUDE_MODEL,
    usage: res.usage || {},
    cost_cents: claudeCost(res.usage, res.model),
  };
}

async function runGemini({ system, user, max_tokens, temperature }) {
  const res = await geminiCall({
    model: GEMINI_MODEL,
    system, user, max_tokens, temperature, json: true,
  });
  return {
    text: res.text,
    model: res.model || GEMINI_MODEL,
    usage: res.usage || {},
    cost_cents: geminiCost(res.usage, res.model),
  };
}

// Public entry. Pass system + user prompts and the chosen model. Falls back
// to the other model on any error from the primary, so a Gemini quota burst
// or a Claude 5xx doesn't block a brief from generating.
export async function generateIntelligence({ system, user, model = 'claude', max_tokens = 3000, temperature = 0.6 } = {}) {
  const requested = (model === 'gemini') ? 'gemini' : 'claude';
  const start = Date.now();

  const primary = requested === 'gemini' ? runGemini : runClaude;
  const fallback = requested === 'gemini' ? runClaude : runGemini;

  try {
    const r = await primary({ system, user, max_tokens, temperature });
    return {
      text: r.text,
      model_used: requested,
      model_requested: requested,
      latency_ms: Date.now() - start,
      tokens_used: r.usage?.total_tokens
                || ((r.usage?.input_tokens || 0) + (r.usage?.output_tokens || 0)),
      usage: r.usage,
      cost_cents: r.cost_cents,
      raw_model: r.model,
    };
  } catch (primaryErr) {
    const fbStart = Date.now();
    try {
      const r = await fallback({ system, user, max_tokens, temperature });
      const other = requested === 'gemini' ? 'claude' : 'gemini';
      return {
        text: r.text,
        model_used: other,
        model_requested: requested,
        latency_ms: Date.now() - start, // total wall-clock incl. failed primary
        fallback_latency_ms: Date.now() - fbStart,
        tokens_used: r.usage?.total_tokens
                  || ((r.usage?.input_tokens || 0) + (r.usage?.output_tokens || 0)),
        usage: r.usage,
        cost_cents: r.cost_cents,
        raw_model: r.model,
        fallback_from: requested,
        fallback_reason: primaryErr.message || String(primaryErr),
      };
    } catch (fbErr) {
      // Both failed — surface the primary error and tag both messages.
      const err = new Error(`Both providers failed. Primary (${requested}): ${primaryErr.message}. Fallback: ${fbErr.message}`);
      err.primary_error = primaryErr.message;
      err.fallback_error = fbErr.message;
      err.model_requested = requested;
      err.latency_ms = Date.now() - start;
      throw err;
    }
  }
}
