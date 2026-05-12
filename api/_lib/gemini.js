// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// Minimal Gemini API client. Mirrors the shape of _lib/anthropic.js so the
// ai-router can swap them transparently. Response keys are normalised back
// to { text, usage } before returning.
// ═════════════════════════════════════════════════════════════════════════

const KEY = process.env.GEMINI_API_KEY;
const DEFAULT_MODEL = 'gemini-2.0-flash';

if (!KEY) console.warn('[gemini] GEMINI_API_KEY missing — Gemini calls will fail');

function endpoint(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`;
}

// Map our { system, messages } shape (Anthropic-style) onto Gemini's
// systemInstruction + contents shape. We expect a single user turn for
// brief generation, which keeps the mapping trivial.
function buildBody({ system, user, max_tokens, temperature, json }) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      temperature: temperature ?? 0.6,
      maxOutputTokens: max_tokens ?? 3000,
    },
  };
  if (system) {
    body.systemInstruction = { role: 'system', parts: [{ text: system }] };
  }
  // Strict JSON output is supported on 1.5+ / 2.0 models — saves us from
  // chasing markdown fences in the response text.
  if (json) {
    body.generationConfig.responseMimeType = 'application/json';
  }
  return body;
}

// Call Gemini and normalise the response into { text, usage, model }.
// Throws on non-2xx so the router can fall back to Claude.
export async function call({ system, user, model = DEFAULT_MODEL, max_tokens, temperature, json = true } = {}) {
  if (!KEY) throw new Error('GEMINI_API_KEY missing');
  const body = buildBody({ system, user, max_tokens, temperature, json });
  const res = await fetch(endpoint(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok) {
    const msg = data?.error?.message || `Gemini HTTP ${res.status}`;
    const err = new Error(`Gemini: ${msg}`);
    err.status = res.status;
    err.body = data || text;
    throw err;
  }
  const out = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  const usage = data?.usageMetadata || {};
  return {
    text: out,
    model,
    usage: {
      input_tokens: usage.promptTokenCount ?? 0,
      output_tokens: usage.candidatesTokenCount ?? 0,
      total_tokens: usage.totalTokenCount ?? 0,
    },
  };
}

// Cheap-by-default cost estimator. Numbers approximate Google's
// flash-tier rate card; refresh when pricing changes. Returns cents.
export function estimateCostCents(usage = {}, model = DEFAULT_MODEL) {
  // gemini-2.0-flash: $0.075 / 1M input, $0.30 / 1M output.
  const rate = model.includes('pro')
    ? { in: 1.25, out: 5.00 }     // gemini-1.5-pro reference
    : { in: 0.075, out: 0.30 };   // flash family default
  const dollars = (usage.input_tokens || 0) / 1e6 * rate.in
                + (usage.output_tokens || 0) / 1e6 * rate.out;
  return Math.round(dollars * 100);
}
