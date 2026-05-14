// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// Generic Anthropic Messages API client. Today only consumed by Mashal
// intelligence, but the wrapper itself has no product-specific logic; any
// future product on the platform can use it.
// ═════════════════════════════════════════════════════════════════════════
//
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

// Convenience for JSON-mode responses. Handles three failure shapes we've
// actually seen in the wild:
//   1. Plain JSON (the happy path — both Claude and Gemini in JSON mode).
//   2. JSON wrapped in ```json fences (Claude occasionally adds these when
//      JSON mode isn't engaged).
//   3. JSON embedded inside prose — model says "Here's your brief:" and
//      then the JSON block. We fall back to extracting the largest
//      {...} or [...] substring and parsing that.
export function parseJsonResponse(text) {
  if (!text) return null;
  let clean = text.trim();

  // Strip ```json / ``` fences if they wrap the whole response.
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  }

  // Direct parse first — covers the JSON-mode happy path.
  try { return JSON.parse(clean); } catch {}

  // Fallback: locate the first { ... matching } (or [ ... ]) and try that.
  // Naive bracket balancing, which is enough for our top-level brief JSON.
  const tryBalanced = (open, close) => {
    const start = clean.indexOf(open);
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < clean.length; i++) {
      if (clean[i] === open) depth++;
      else if (clean[i] === close) {
        depth--;
        if (depth === 0) {
          const slice = clean.slice(start, i + 1);
          try { return JSON.parse(slice); } catch { return null; }
        }
      }
    }
    return null;
  };
  return tryBalanced('{', '}') || tryBalanced('[', ']');
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
