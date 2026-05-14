// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Streaming variant of /api/intelligence/generate.
// Returns Server-Sent Events so the browser can render verdict text as
// Gemini emits it (~1s to first token vs ~5-10s for the full JSON).
//
// Event shape on the wire — one `data: <json>\n\n` per yield from
// generateBriefStream():
//   { phase: 'gathering' | 'generating' | 'persisting' }
//   { chunk: '<text>' }
//   { done: true, summary: {...} }
//   { error: '...', message: '...' }
// ═════════════════════════════════════════════════════════════════════════

import { authenticate } from '../_lib/auth.js';
import { generateBriefStream } from '../_lib/intelligence.js';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const auth = await authenticate(req);
  if (auth.error) {
    res.statusCode = auth.status;
    return res.end(JSON.stringify({ error: auth.error }));
  }
  const ws = auth.workspace;
  if (!ws) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ error: 'Workspace not found' }));
  }

  // Open SSE response. `X-Accel-Buffering: no` defeats any proxy buffering
  // that would otherwise hold chunks until the response closes.
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  try {
    for await (const ev of generateBriefStream(ws)) {
      send(ev);
    }
  } catch (e) {
    send({ error: 'stream_failed', message: e.message });
  }
  res.end();
}
