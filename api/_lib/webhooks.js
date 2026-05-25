// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Webhook dispatcher — fires registered workspace
// webhooks when an event happens (brief_generated, weekly_digest_sent,
// signal_detected). Built for Slack / Teams / Zapier-friendly receivers:
// JSON body, HMAC-SHA256 signature header, no chunked streaming, no
// retry on the dispatch side (Slack/Zapier handle their own retries via
// their incoming-webhook infrastructure — re-firing from here would
// double-deliver).
//
// Failure handling:
//   - HTTP 2xx → success; failure_count zeroed, last_status set to 'success'
//   - HTTP 4xx → permanent failure; failure_count incremented; if
//                failure_count reaches 5, is_active flips to false so
//                the dispatcher stops attempting until the user fixes
//                the webhook in Settings
//   - HTTP 5xx or network error → transient; failure_count incremented
//                but is_active stays true (the receiver may be down)
//   - Anything else → logged but doesn't disable the webhook
//
// Each event dispatches as a fire-and-forget — we don't block the
// caller (brief generation, cron) on webhook delivery. Promises are
// not awaited at the call site; we just kick them off.
// ═════════════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';
import { supabase } from './supabase.js';

// HMAC-SHA256 hex digest. Receivers compute the same value over the raw
// request body using the secret they were given at webhook creation,
// then compare against the X-Mashal-Signature header (timing-safe).
function sign(body, secret) {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

// Generate a 64-char hex secret (256 bits). Used once per webhook on
// creation and returned to the caller. We never expose it again.
export function generateWebhookSecret() {
  return crypto.randomBytes(32).toString('hex');
}

// Validate that a URL is a plausible HTTPS endpoint. We refuse non-HTTPS
// because signed payloads sent over HTTP can be silently MITM'd. Localhost
// + .vercel.app are allowed for testing. Anything more permissive (raw
// http://) is rejected at write time.
export function isValidWebhookUrl(raw) {
  if (typeof raw !== 'string') return false;
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  // Allow http://localhost and http://127.0.0.1 for dev only.
  if (u.protocol === 'http:') {
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    return false;
  }
  return true;
}

// Allowed event names. Sender + receiver should agree on the canonical
// list; new events get added here and to the API endpoint's validation
// at the same time so an unknown event can't sneak past either side.
export const ALLOWED_EVENTS = new Set([
  'brief_generated',
  'weekly_digest_sent',
  'signal_detected',
]);

// Fetch active webhooks for the workspace, filtered to those subscribed
// to the given event. Empty events array = subscribe to all (broadcast).
async function fetchSubscribers(workspaceId, eventName) {
  const rows = await supabase.select('workspace_webhooks', {
    select: '*',
    eq: { workspace_id: workspaceId, is_active: true },
    limit: 50,
  }).catch(() => []);

  return (rows || []).filter(w => {
    const events = Array.isArray(w.events) ? w.events : [];
    if (events.length === 0) return true;        // empty = all events
    return events.includes(eventName);
  });
}

// Update the diagnostic columns after a delivery attempt. Best-effort —
// a DB write failure here shouldn't kill the dispatcher.
async function recordDeliveryOutcome(webhookId, outcome) {
  try {
    await supabase.update('workspace_webhooks', outcome, { eq: { id: webhookId } });
  } catch (_) { /* swallow */ }
}

// Deliver one webhook. Returns a Promise that always resolves (never
// throws) so Promise.all on the caller doesn't short-circuit.
async function deliverOne(webhook, eventName, payload) {
  const body = JSON.stringify({
    event: eventName,
    sent_at: new Date().toISOString(),
    workspace_id: webhook.workspace_id,
    data: payload,
  });
  const signature = sign(body, webhook.secret);
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mashal-Webhook/1.0',
    'X-Mashal-Event': eventName,
    'X-Mashal-Workspace': webhook.workspace_id,
    'X-Mashal-Signature': `sha256=${signature}`,
    'X-Mashal-Delivery': crypto.randomUUID(),
  };

  let status = 'error';
  let errMsg = null;
  let httpCode = 0;
  let permanentFailure = false;

  try {
    // 10s timeout — Slack/Teams/Zapier endpoints all respond well under
    // a second when healthy. A slow receiver shouldn't block the cron.
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(t);
    httpCode = res.status;
    if (res.ok) {
      status = 'success';
    } else {
      status = `http_${res.status}`;
      // 4xx = receiver explicitly rejected. Likely permanent (bad URL,
      // disabled webhook on their side, auth mismatch).
      if (res.status >= 400 && res.status < 500) permanentFailure = true;
      errMsg = await res.text().then(t => t.slice(0, 200)).catch(() => null);
    }
  } catch (e) {
    status = e.name === 'AbortError' ? 'timeout' : 'network_error';
    errMsg = String(e.message || e).slice(0, 200);
  }

  // Diagnostic write — only fields the table has.
  const wasSuccess = status === 'success';
  const newFailureCount = wasSuccess ? 0 : (webhook.failure_count || 0) + 1;
  const shouldDeactivate = permanentFailure && newFailureCount >= 5;
  const outcome = {
    last_delivery_at: new Date().toISOString(),
    last_status: status,
    last_error: wasSuccess ? null : errMsg,
    failure_count: newFailureCount,
    updated_at: new Date().toISOString(),
  };
  if (shouldDeactivate) outcome.is_active = false;
  await recordDeliveryOutcome(webhook.id, outcome);

  return { webhook_id: webhook.id, status, httpCode, error: errMsg };
}

// Public: dispatch an event to every subscribed webhook for the workspace.
// Returns a Promise that resolves to the per-webhook outcomes. Callers
// SHOULD NOT await this on a hot path — fire and forget by calling it
// without await, or wrap with a .catch handler at the call site.
export async function dispatchEvent(workspaceId, eventName, payload) {
  if (!workspaceId) return { dispatched: 0, results: [] };
  if (!ALLOWED_EVENTS.has(eventName)) {
    return { dispatched: 0, error: `Unknown event: ${eventName}`, results: [] };
  }

  const subscribers = await fetchSubscribers(workspaceId, eventName);
  if (!subscribers.length) return { dispatched: 0, results: [] };

  const results = await Promise.all(subscribers.map(w => deliverOne(w, eventName, payload)));
  return {
    dispatched: results.filter(r => r.status === 'success').length,
    attempted: results.length,
    results,
  };
}

// Convenience: build a redacted view of a webhook row for the UI. The
// secret never leaves the server after the create response; everywhere
// else we return a hash hint so the user can identify which secret is
// which without exposing the value.
export function redactWebhook(w) {
  if (!w) return null;
  const { secret, ...rest } = w;
  return {
    ...rest,
    secret_preview: secret ? `${secret.slice(0, 8)}…${secret.slice(-4)}` : null,
  };
}
