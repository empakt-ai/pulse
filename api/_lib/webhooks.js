// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Webhook dispatcher — fires registered workspace
// webhooks when an event happens (brief_generated, weekly_digest_sent,
// signal_detected). Built for Slack / Teams / Zapier-friendly receivers:
// JSON body, HMAC-SHA256 signature header, no chunked streaming, no
// retry on the dispatch side (Slack/Zapier handle their own retries via
// their incoming-webhook infrastructure — re-firing from here would
// double-deliver).
//
// SSRF defense (security audit, May 2026):
//   - URL validator rejects any non-HTTPS URL outside localhost+dev.
//   - URL validator rejects hostnames that are or resolve to RFC1918
//     private networks, link-local, loopback, cloud-metadata IPs, or
//     CGNAT space — both for IPv4 and IPv6.
//   - Dispatch-time DNS re-resolution: a hostname that resolved to a
//     public IP at create time can be re-pointed to a private IP by the
//     time dispatch runs (DNS rebinding). We resolve again here and
//     refuse if any A/AAAA record lands in a blocked range.
//   - Response body is NEVER stored on the webhook row. last_error
//     captures the failure category only (http_4xx, timeout, network,
//     blocked_host), so even a successful SSRF can't exfiltrate the
//     metadata-service response body via the readable last_error.
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
import dns from 'node:dns/promises';
import net from 'node:net';
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

// ─── Private-network IP detection ────────────────────────────────────────
// Refuses any address in: loopback (127.0.0.0/8, ::1), link-local
// (169.254.0.0/16, fe80::/10), RFC1918 private (10/8, 172.16/12, 192.168/16),
// CGNAT (100.64/10), IPv6 ULA (fc00::/7), unspecified (0.0.0.0, ::), and
// the IPv4-mapped IPv6 prefix (::ffff:0:0/96 — mapped private IPv4).
function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isBlockedIPv4(ip) {
  const n = ipv4ToInt(ip);
  if (n === null) return true;                                   // refuse malformed
  if ((n & 0xff000000) >>> 0 === 0x7f000000) return true;        // 127.0.0.0/8
  if ((n & 0xff000000) >>> 0 === 0x00000000) return true;        // 0.0.0.0/8
  if ((n & 0xff000000) >>> 0 === 0x0a000000) return true;        // 10.0.0.0/8
  if ((n & 0xfff00000) >>> 0 === 0xac100000) return true;        // 172.16.0.0/12
  if ((n & 0xffff0000) >>> 0 === 0xc0a80000) return true;        // 192.168.0.0/16
  if ((n & 0xffff0000) >>> 0 === 0xa9fe0000) return true;        // 169.254.0.0/16 (link-local + AWS metadata)
  if ((n & 0xffc00000) >>> 0 === 0x64400000) return true;        // 100.64.0.0/10 (CGNAT)
  return false;
}

function isBlockedIPv6(ip) {
  const lower = String(ip).toLowerCase().trim();
  if (!lower) return true;
  if (lower === '::' || lower === '::1') return true;            // unspecified + loopback
  // IPv4-mapped IPv6 — recheck against IPv4 rules.
  const mapped = lower.match(/^::ffff:([0-9.]+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  // Link-local fe80::/10 — high 10 bits = 1111111010.
  if (/^fe[89ab][0-9a-f]?:/.test(lower)) return true;
  // ULA fc00::/7 — high 7 bits = 1111110.
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  // Site-local fec0::/10 (deprecated but still rejected).
  if (/^fec[0-9a-f]:/.test(lower)) return true;
  return false;
}

function isBlockedIp(ip) {
  if (net.isIPv4(ip)) return isBlockedIPv4(ip);
  if (net.isIPv6(ip)) return isBlockedIPv6(ip);
  return true;                                                   // not a valid IP — refuse
}

// Resolve a hostname to its A + AAAA records. Returns the array of IPs,
// or throws on resolution failure. Used at dispatch time to defeat DNS
// rebinding (where a hostname resolves to a public IP at registration
// but a private IP at fetch time).
async function resolveAll(hostname) {
  const ips = [];
  try {
    const a = await dns.resolve4(hostname);
    ips.push(...a);
  } catch (_) { /* no A records — ok if AAAA exists */ }
  try {
    const aaaa = await dns.resolve6(hostname);
    ips.push(...aaaa);
  } catch (_) { /* no AAAA records */ }
  if (ips.length === 0) {
    // Some hostnames only resolve via getaddrinfo (e.g. /etc/hosts entries
    // in dev). Fall back to a single lookup() result.
    const r = await dns.lookup(hostname, { all: true });
    for (const x of r) ips.push(x.address);
  }
  return ips;
}

// ─── URL validation (registration time) ──────────────────────────────────
// Refuse any URL that targets a private/internal network, cloud metadata
// service, or non-routable address. localhost is only allowed in dev
// (NODE_ENV === 'development') so a misconfigured prod env can't be
// abused to SSRF via 127.0.0.1.
export function isValidWebhookUrl(raw) {
  if (typeof raw !== 'string') return false;
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  // HTTP only in dev, for localhost. Prod always requires HTTPS.
  if (u.protocol === 'http:') {
    if (process.env.NODE_ENV !== 'development') return false;
    if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return false;
    return true;
  }
  // HTTPS — refuse private IPs and obvious blocked hostnames.
  const host = u.hostname;
  if (!host) return false;
  if (host === 'localhost') return false;
  // Strip brackets from literal IPv6 like [::1].
  const ipLiteral = host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1)
    : host;
  if (net.isIP(ipLiteral)) {
    return !isBlockedIp(ipLiteral);
  }
  // Hostname (non-IP) passes registration validation; DNS-time check
  // happens at dispatch in deliverOne.
  return true;
}

// Resolve and verify the hostname resolves only to public IPs. Returns
// null on success, or a short reason string on block (the dispatcher
// surfaces this as the last_error category).
async function verifyHostnameSafe(urlString) {
  let u;
  try { u = new URL(urlString); } catch { return 'invalid_url'; }
  if (!/^https?:$/.test(u.protocol)) return 'non_http_protocol';
  const host = u.hostname;
  if (!host) return 'no_host';
  // IP literal — already checked at registration time, but recheck here
  // since the row may have been written before the new validator shipped.
  const ipLiteral = host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1)
    : host;
  if (net.isIP(ipLiteral)) {
    return isBlockedIp(ipLiteral) ? 'blocked_ip_literal' : null;
  }
  // Resolve and check every returned address.
  let ips;
  try {
    ips = await resolveAll(host);
  } catch (e) {
    return 'dns_failure';
  }
  if (!ips.length) return 'dns_no_records';
  for (const ip of ips) {
    if (isBlockedIp(ip)) return 'blocked_private_ip';
  }
  return null;
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
// SECURITY: response body is NEVER captured into last_error — only the
// status category. This closes the SSRF read-out vector flagged in the
// May 2026 audit.
export async function deliverOne(webhook, eventName, payload) {
  // 1. DNS re-resolution — defeats DNS rebinding. A hostname that
  //    resolved to a public IP at registration can be re-pointed to a
  //    private IP between then and dispatch. Check now.
  const blockedReason = await verifyHostnameSafe(webhook.url);
  if (blockedReason) {
    await recordDeliveryOutcome(webhook.id, {
      last_delivery_at: new Date().toISOString(),
      last_status: 'blocked',
      last_error: blockedReason,
      failure_count: (webhook.failure_count || 0) + 1,
      updated_at: new Date().toISOString(),
      // 5 strikes deactivate — same threshold as the 4xx path.
      ...((webhook.failure_count || 0) + 1 >= 5 ? { is_active: false } : {}),
    });
    return { webhook_id: webhook.id, status: 'blocked', httpCode: 0, error: blockedReason };
  }

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
      // Stop following redirects — a 302 to a private IP would bypass
      // our pre-fetch hostname check.
      redirect: 'manual',
    });
    clearTimeout(t);
    httpCode = res.status;
    if (res.ok) {
      status = 'success';
    } else if (res.status >= 300 && res.status < 400) {
      // Manual redirect handling — refuse to follow.
      status = 'redirect_refused';
      permanentFailure = true;
    } else {
      status = `http_${res.status}`;
      // 4xx = receiver explicitly rejected. Likely permanent (bad URL,
      // disabled webhook on their side, auth mismatch).
      if (res.status >= 400 && res.status < 500) permanentFailure = true;
    }
  } catch (e) {
    status = e.name === 'AbortError' ? 'timeout' : 'network_error';
  }

  // Diagnostic write — only category-level info, NEVER the response body
  // (the audit flagged that as an SSRF exfiltration vector).
  const wasSuccess = status === 'success';
  const newFailureCount = wasSuccess ? 0 : (webhook.failure_count || 0) + 1;
  const shouldDeactivate = permanentFailure && newFailureCount >= 5;
  const outcome = {
    last_delivery_at: new Date().toISOString(),
    last_status: status,
    last_error: wasSuccess ? null : status,
    failure_count: newFailureCount,
    updated_at: new Date().toISOString(),
  };
  if (shouldDeactivate) outcome.is_active = false;
  await recordDeliveryOutcome(webhook.id, outcome);

  return { webhook_id: webhook.id, status, httpCode };
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
