// Minimal Anthropic Messages API client — no SDK install needed.
// Uses prompt caching so the system prompt (~1.5k tokens) costs 10% on repeat calls.

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const KEY = process.env.ANTHROPIC_API_KEY;
const DEFAULT_MODEL = 'claude-sonnet-4-6';

if (!KEY) console.warn('[anthropic] ANTHROPIC_API_KEY missing — intelligence calls will fail');

export async function messages({
  model = DEFAULT_MODEL,
  system,              // string OR array of {type, text, cache_control?}
  messages: msgs,
  max_tokens = 2048,
  temperature = 0.7,
  signal,
} = {}) {
  const body = {
    model,
    max_tokens,
    temperature,
    messages: msgs,
  };

  // Allow system to be either a plain string or pre-built blocks (so caller can attach cache_control).
  if (typeof system === 'string') body.system = system;
  else if (Array.isArray(system)) body.system = system;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

  if (!res.ok) {
    const msg = (parsed && (parsed.error?.message || parsed.message)) || `Anthropic ${res.status}`;
    const err = new Error(`Anthropic: ${msg}`);
    err.status = res.status;
    err.body = parsed;
    throw err;
  }

  // Return content + usage so callers can track cache hits and spend.
  const textOut = (parsed?.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  return {
    text: textOut,
    raw: parsed,
    usage: parsed?.usage || {},
    model: parsed?.model,
  };
}

// Convenience for JSON-mode responses — strips ```json fences if Claude adds them.
export function parseJsonResponse(text) {
  if (!text) return null;
  let clean = text.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  }
  try { return JSON.parse(clean); } catch { return null; }
}

// Quick cost estimate (cents) given usage and model.
// Sonnet 4.6: $3/M input, $3.75/M cache write, $0.30/M cache read, $15/M output
export function estimateCostCents(usage, model = DEFAULT_MODEL) {
  if (!usage) return 0;
  const rates = {
    'claude-sonnet-4-6': { in: 300, cacheW: 375, cacheR: 30, out: 1500 },
    'claude-opus-4-7':   { in: 1500, cacheW: 1875, cacheR: 150, out: 7500 },
    'claude-haiku-4-5':  { in: 100, cacheW: 125, cacheR: 10, out: 500 },
  };
  const r = rates[model] || rates['claude-sonnet-4-6'];
  const inToks = (usage.input_tokens || 0);
  const cw = (usage.cache_creation_input_tokens || 0);
  const cr = (usage.cache_read_input_tokens || 0);
  const out = (usage.output_tokens || 0);
  // cents per token = $/M ÷ 1M × 100 cents/$ = rate / 1e6
  const cents = (inToks * r.in + cw * r.cacheW + cr * r.cacheR + out * r.out) / 1e6;
  return Math.round(cents * 100) / 100; // 2-decimal cents (i.e. tenths of a cent)
}
