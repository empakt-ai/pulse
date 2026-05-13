// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure. Single entry point for intelligence
// generation. The active provider (`gemini` or `anthropic`) lives in the
// `platform_settings.ai_provider` row and is admin-controlled at runtime —
// no deploy is needed to flip the default for every workspace.
//
// On primary-provider failure we fall through to the other provider so a
// Gemini outage doesn't take the morning brief down. The fallback is
// reported in the response so /api/intelligence/generate can show it in
// the response, and so usage_log preserves what actually ran.
//
// Returns { text, model_used, model_requested, fallback_from, latency_ms,
//           tokens_used, usage, cost_cents }.
// ═════════════════════════════════════════════════════════════════════════

import { call as geminiCall, estimateCostCents as geminiCost } from './gemini.js';
import { messages as anthropicMessages, estimateCostCents as anthropicCost } from './anthropic.js';
import { getSetting } from './platform-settings.js';

const GEMINI_MODEL    = 'gemini-2.5-flash';
const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

// Per-provider timeout for the PRIMARY call. Vercel kills the function at
// 60s; if the primary hangs the full duration the fallback never gets a
// chance to run. 45s leaves ~15s headroom for Gemini (typically 5–10s).
// Bump only if you're confident your provider returns within the buffer.
const PRIMARY_TIMEOUT_MS = 45_000;

async function runGemini({ system, user, max_tokens, temperature, signal }) {
  const res = await geminiCall({
    model: GEMINI_MODEL,
    system, user, max_tokens, temperature, json: true, signal,
  });
  return {
    text: res.text,
    model: res.model || GEMINI_MODEL,
    usage: res.usage || {},
    cost_cents: geminiCost(res.usage, res.model),
  };
}

async function runAnthropic({ system, user, max_tokens, temperature, signal }) {
  // System prompt is large and stable across calls — wrap it in a
  // cache_control block so repeat calls only pay 10% on the system tokens.
  const systemBlocks = [
    { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
  ];
  const res = await anthropicMessages({
    model: ANTHROPIC_MODEL,
    system: systemBlocks,
    messages: [{ role: 'user', content: user }],
    max_tokens,
    temperature,
    signal,
  });
  return {
    text: res.text,
    model: res.model || ANTHROPIC_MODEL,
    usage: res.usage || {},
    cost_cents: anthropicCost(res.usage, res.model),
  };
}

// Public entry. `model` argument is honoured if explicitly passed (so
// /api/analytics/compare-models can force a side-by-side run); otherwise
// we read the admin-controlled default from platform_settings.
export async function generateIntelligence({ system, user, model, max_tokens = 6000, temperature = 0.6 } = {}) {
  const start = Date.now();
  const requested = (model || await getSetting('ai_provider') || 'gemini').toString().toLowerCase();
  const primary = (requested === 'anthropic' || requested === 'claude') ? 'anthropic' : 'gemini';

  const run     = primary === 'anthropic' ? runAnthropic : runGemini;
  const altRun  = primary === 'anthropic' ? runGemini    : runAnthropic;
  const altName = primary === 'anthropic' ? 'gemini'     : 'anthropic';

  let r;
  let usedName = primary;
  let fallback_from = null;

  // AbortController gives us a hard ceiling on the primary call. Without
  // this, a hanging provider (we hit a 58s anthropic.com hang in prod)
  // burns the whole Vercel function budget and the fallback never runs.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${primary} primary call exceeded ${PRIMARY_TIMEOUT_MS}ms`)), PRIMARY_TIMEOUT_MS);
  try {
    r = await run({ system, user, max_tokens, temperature, signal: controller.signal });
  } catch (err) {
    // Distinguish abort-from-timeout vs other errors purely for log
    // legibility. Either way we proceed to the fallback.
    const reason = controller.signal.aborted ? `timed out after ${PRIMARY_TIMEOUT_MS}ms` : err.message;
    console.warn(`[ai-router] ${primary} failed (${reason}); falling back to ${altName}`);
    fallback_from = primary;
    usedName = altName;
    // No timeout on the fallback — Vercel's function timeout caps it
    // naturally. Adding our own here would just cut the second attempt
    // short for marginal benefit.
    r = await altRun({ system, user, max_tokens, temperature });
  } finally {
    clearTimeout(timer);
  }

  return {
    text: r.text,
    model_used: usedName,
    model_requested: primary,
    fallback_from,
    latency_ms: Date.now() - start,
    tokens_used: r.usage?.total_tokens
              || ((r.usage?.input_tokens || 0) + (r.usage?.output_tokens || 0)),
    usage: r.usage,
    cost_cents: r.cost_cents,
    raw_model: r.model,
  };
}
