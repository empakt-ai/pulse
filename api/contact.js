// ═════════════════════════════════════════════════════════════════════════
// [PULSE-SPECIFIC] Public contact-form handler. Accepts POST { name, email,
// message } from /contact and forwards as an email to CONTACT_TO via Resend.
// No auth — public endpoint. Honeypot field + rate-limit by IP+email to
// keep spam bots out. Idempotent on identical payloads in the last 60s.
// ═════════════════════════════════════════════════════════════════════════

import { sendEmail } from './_lib/email.js';

const CONTACT_TO = process.env.CONTACT_TO || 'hello@karvan.io';

// In-process dedupe — tiny LRU keyed by ip+email+hash(message) for ~60s.
// Survives across requests on the same warm function instance only; that's
// fine — a determined spammer who gets a cold instance still hits the
// Resend rate limit, which is the second line of defence.
const RECENT = new Map();
const TTL_MS = 60 * 1000;
const MAX_RECENT = 500;

function seenRecently(key) {
  const now = Date.now();
  // Sweep expired entries opportunistically.
  for (const [k, t] of RECENT) {
    if (now - t > TTL_MS) RECENT.delete(k);
  }
  if (RECENT.size > MAX_RECENT) {
    const oldest = RECENT.keys().next().value;
    RECENT.delete(oldest);
  }
  if (RECENT.has(key)) return true;
  RECENT.set(key, now);
  return false;
}

function isEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}

function clientIp(req) {
  const fwd = req.headers?.['x-forwarded-for'] || '';
  return String(fwd).split(',')[0].trim() || req.headers?.['x-real-ip'] || 'unknown';
}

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  // CORS — public form, allow same-origin POST only (so the form on
  // /contact works while keeping the surface tight). The page lives on
  // the same Vercel host so Origin matches.
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const name    = String(body?.name    || '').trim().slice(0, 200);
  const email   = String(body?.email   || '').trim().slice(0, 200);
  const message = String(body?.message || '').trim().slice(0, 5000);
  // Honeypot — a real form leaves this empty; bots fill every field.
  const honeypot = String(body?.company || '').trim();

  if (honeypot) return send(res, 200, { ok: true }); // silently drop
  if (!name)              return send(res, 400, { error: 'Name is required' });
  if (!isEmail(email))    return send(res, 400, { error: 'A valid email is required' });
  if (message.length < 5) return send(res, 400, { error: 'Message is too short' });

  // Dedupe identical submissions within 60s window from same IP.
  const key = `${clientIp(req)}|${email.toLowerCase()}|${message.length}`;
  if (seenRecently(key)) {
    return send(res, 200, { ok: true, duplicate: true });
  }

  // Compose + send. Plain text so Resend doesn't escape weird characters
  // in the user's message. HTML version is the same content minimally
  // formatted; both share the user-supplied content (escaped).
  const esc = (s) => String(s).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));

  try {
    await sendEmail({
      to: CONTACT_TO,
      subject: `PULSE contact form: ${name}`,
      text: `New contact form submission\n\nFrom: ${name} <${email}>\n\n${message}\n\n—\nIP: ${clientIp(req)}\nUA: ${req.headers?.['user-agent'] || 'unknown'}`,
      html: `
        <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 580px;">
          <p style="font-size: 13px; color: #888; margin: 0 0 4px;">New contact form submission</p>
          <p style="font-size: 16px; margin: 0 0 16px;"><strong>${esc(name)}</strong> &lt;<a href="mailto:${esc(email)}">${esc(email)}</a>&gt;</p>
          <div style="padding: 16px; background: #f5f1e8; border-radius: 10px; white-space: pre-wrap; font-size: 14px; line-height: 1.55;">${esc(message)}</div>
          <p style="font-size: 11px; color: #aaa; margin-top: 16px;">IP: ${esc(clientIp(req))}</p>
        </div>`,
      // Replies go straight to the sender — no extra CRM round-trip.
      replyTo: email,
    });
    return send(res, 200, { ok: true });
  } catch (e) {
    return send(res, 500, { error: 'send_failed', message: e.message });
  }
}
