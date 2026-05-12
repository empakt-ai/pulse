// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Resend email wrapper — raw fetch, no SDK. Used by the weekly
// digest cron and (eventually) any transactional emails. RESEND_API_KEY
// must be set in Vercel; we ship from PULSE_FROM_EMAIL or a default.
// ═════════════════════════════════════════════════════════════════════════

const RESEND_API = 'https://api.resend.com/emails';
const KEY = process.env.RESEND_API_KEY;
const FROM = process.env.PULSE_FROM_EMAIL || 'PULSE <reports@karvan-pulse.vercel.app>';

// Send an email. attachments is an optional array of
//   { filename: string, content: Buffer | base64 string }
// Resend accepts base64-encoded content under `content`. If we get a Buffer
// we'll convert. Returns Resend's response JSON on success.
export async function sendEmail({ to, subject, html, text, attachments = [], replyTo } = {}) {
  if (!KEY) throw new Error('RESEND_API_KEY missing');
  if (!to || !subject) throw new Error('sendEmail requires to + subject');

  const body = { from: FROM, to: Array.isArray(to) ? to : [to], subject };
  if (html) body.html = html;
  if (text) body.text = text;
  if (replyTo) body.reply_to = replyTo;
  if (attachments.length) {
    body.attachments = attachments.map(a => ({
      filename: a.filename,
      content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
    }));
  }

  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Resend ${res.status}: ${data?.message || res.statusText}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}
