// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// Minimal Gemini API client. Mirrors the shape of _lib/anthropic.js so the
// ai-router can swap them transparently. Response keys are normalised back
// to { text, usage } before returning.
// ═════════════════════════════════════════════════════════════════════════

const KEY = process.env.GEMINI_API_KEY;
const DEFAULT_MODEL = 'gemini-2.5-flash';

if (!KEY) console.warn('[gemini] GEMINI_API_KEY missing — Gemini calls will fail');

function endpoint(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`;
}

function streamEndpoint(model) {
  // alt=sse returns Server-Sent Events; without it Gemini returns a JSON
  // array of chunks all at once (defeats the point of streaming).
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${KEY}`;
}

// Map our { system, messages } shape (Anthropic-style) onto Gemini's
// systemInstruction + contents shape. We expect a single user turn for
// brief generation, which keeps the mapping trivial.
function buildBody({ system, user, max_tokens, temperature, json }) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      temperature: temperature ?? 0.6,
      maxOutputTokens: max_tokens ?? 6000,
      // Gemini 2.5 Flash spends "thinking" tokens against maxOutputTokens
      // before emitting visible content. For a JSON-mode brief we don't
      // need that — disable thinking so the budget goes to actual output.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  if (system) {
    // Gemini's systemInstruction does NOT accept a `role` field — including
    // it causes the API to silently ignore the instruction in some regions.
    // Shape is { parts: [{ text }] } only.
    body.systemInstruction = { parts: [{ text: system }] };
  }
  // Strict JSON output. Supported on 1.5+ / 2.0 models — saves us from
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
  const candidate = data?.candidates?.[0];
  const out = candidate?.content?.parts?.map(p => p.text || '').join('') || '';
  const finishReason = candidate?.finishReason || 'UNKNOWN';
  // Surface meaningful failures (safety blocks, max-tokens cutoff, empty
  // candidates) instead of returning silently-empty text. The router
  // catches and falls back to Claude on any throw here.
  if (!out) {
    const reason = data?.promptFeedback?.blockReason
      || finishReason
      || 'empty response';
    const err = new Error(`Gemini returned no content (${reason})`);
    err.status = 502;
    err.body = data;
    throw err;
  }
  if (finishReason === 'MAX_TOKENS') {
    // We got a response but it was truncated — log a warning and continue.
    // The parser may still produce a usable verdict from a partial brief.
    console.warn('[gemini] response truncated at max_tokens; consider raising max_tokens');
  }
  const usage = data?.usageMetadata || {};
  return {
    text: out,
    model,
    finish_reason: finishReason,
    usage: {
      input_tokens: usage.promptTokenCount ?? 0,
      output_tokens: usage.candidatesTokenCount ?? 0,
      total_tokens: usage.totalTokenCount ?? 0,
    },
  };
}

// Streaming variant. Calls the SSE endpoint and yields each text chunk
// as it arrives. Caller is responsible for accumulating and parsing.
// On stream end yields a final { done: true, text, usage } chunk.
//
// Each Gemini SSE event looks like:
//   data: { "candidates": [{ "content": { "parts": [{ "text": "..." }] } }] }
//
// Generator pattern — drain with `for await (const c of callStream(...))`.
export async function* callStream({ system, user, model = DEFAULT_MODEL, max_tokens, temperature, json = true } = {}) {
  if (!KEY) throw new Error('GEMINI_API_KEY missing');
  const body = buildBody({ system, user, max_tokens, temperature, json });
  const res = await fetch(streamEndpoint(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const err = new Error(`Gemini stream HTTP ${res.status}: ${txt.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let lastUsage = null;
  let finishReason = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE messages are separated by blank lines; each message is one or
    // more "data: ..." prefixed lines. Process whole messages only —
    // leave any partial trailing chunk in the buffer.
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const message = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of message.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const data = JSON.parse(payload);
          const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
          if (text) {
            fullText += text;
            yield { chunk: text };
          }
          if (data?.candidates?.[0]?.finishReason) {
            finishReason = data.candidates[0].finishReason;
          }
          if (data?.usageMetadata) lastUsage = data.usageMetadata;
        } catch { /* skip malformed SSE row */ }
      }
    }
  }

  const usage = lastUsage || {};
  yield {
    done: true,
    text: fullText,
    finish_reason: finishReason || 'UNKNOWN',
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
  // gemini-2.5-flash: $0.30 / 1M input, $2.50 / 1M output.
  const rate = model.includes('pro')
    ? { in: 1.25, out: 10.00 }    // gemini-2.5-pro reference
    : { in: 0.30, out: 2.50 };    // 2.5-flash default
  const dollars = (usage.input_tokens || 0) / 1e6 * rate.in
                + (usage.output_tokens || 0) / 1e6 * rate.out;
  return Math.round(dollars * 100);
}
