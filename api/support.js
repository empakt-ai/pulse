// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] /api/support — user-facing suggestions, bug reports,
// and questions.
//
//   POST /api/support
//     body: { type: 'bug'|'suggestion'|'question', subject, body }
//     → { ticket }
//
//   GET  /api/support
//     → { tickets: [...] }    — caller's own tickets, newest first
//
// Authenticated; any role can submit. The matching admin actions
// (list-all, update status) live in api/admin.js under action=tickets /
// action=ticket-set so only admins can mutate state.
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';
import { sendEmail } from './_lib/email.js';
import { escapeHtml } from './_lib/escape-html.js';

const VALID_TYPES = ['bug', 'suggestion', 'question'];
const SUBJECT_MAX = 140;
const BODY_MAX    = 5000;
const ADMIN_EMAIL = process.env.MASHAL_ADMIN_EMAIL || 'hello@mashal.app';

function adminNotificationHtml({ user, workspace, ticket }) {
  const safeBody = escapeHtml(String(ticket.body).slice(0, BODY_MAX));
  const safeSubject = escapeHtml(String(ticket.subject).slice(0, SUBJECT_MAX));
  return `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; background:#F5F1E8; padding:24px; color:#0A0A0B;">
  <div style="max-width:560px; margin:0 auto; background:#FFFFFF; border-radius:14px; padding:24px;">
    <div style="font-family: 'Geist Mono', monospace; font-size:10px; text-transform:uppercase; letter-spacing:0.14em; color:#6B5BFF;">Mashal · New ticket · ${escapeHtml(ticket.type)}</div>
    <h2 style="font-size:18px; margin:10px 0 8px;">${safeSubject}</h2>
    <pre style="white-space:pre-wrap; font-family:inherit; font-size:13.5px; line-height:1.55; color:#0A0A0B; margin:0 0 16px;">${safeBody}</pre>
    <div style="font-size:12px; color:#8E8B84; line-height:1.7;">
      <div><strong>From:</strong> ${escapeHtml(user.email || user.id)}</div>
      <div><strong>Workspace:</strong> ${escapeHtml(workspace?.name || '—')} (${escapeHtml(workspace?.tier || 'no tier')})</div>
      <div><strong>Ticket id:</strong> <span style="font-family: 'Geist Mono', monospace;">${escapeHtml(ticket.id)}</span></div>
    </div>
  </div>
</body></html>`;
}

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });

  if (req.method === 'GET') {
    const tickets = await supabase.select('support_tickets', {
      select: 'id,type,subject,body,status,founder_note,created_at,updated_at,resolved_at',
      eq: { user_id: auth.user.id },
      order: 'created_at.desc',
      limit: 50,
    }).catch(() => []);
    return json(res, 200, { tickets: tickets || [] });
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const type    = String(body.type    || '').toLowerCase().trim();
    const subject = String(body.subject || '').trim();
    const message = String(body.body    || '').trim();

    if (!VALID_TYPES.includes(type)) {
      return json(res, 400, { error: `type must be one of ${VALID_TYPES.join(', ')}` });
    }
    if (!subject)            return json(res, 400, { error: 'subject is required' });
    if (subject.length > SUBJECT_MAX) return json(res, 400, { error: `subject must be ${SUBJECT_MAX} chars or fewer` });
    if (!message)            return json(res, 400, { error: 'body is required' });
    if (message.length > BODY_MAX) return json(res, 400, { error: `body must be ${BODY_MAX} chars or fewer` });

    let ticket;
    try {
      const inserted = await supabase.insert('support_tickets', {
        user_id:      auth.user.id,
        workspace_id: auth.workspace?.id || null,
        type, subject, body: message,
        status: 'open',
      });
      ticket = inserted?.[0] || null;
    } catch (e) {
      return json(res, 500, { error: e.message });
    }

    // Best-effort admin notification — never fail the submit on a Resend
    // hiccup. The ticket is already persisted; we surface email_status
    // so the UI can flag a delivery failure without losing the data.
    let email_status = 'sent';
    try {
      await sendEmail({
        to:      ADMIN_EMAIL,
        replyTo: auth.user.email,
        subject: `[${type}] ${subject}`.slice(0, 180),
        html:    adminNotificationHtml({ user: auth.user, workspace: auth.workspace, ticket }),
        text:    `New ${type} from ${auth.user.email || auth.user.id}:\n\n${subject}\n\n${message}\n\nTicket id: ${ticket?.id}`,
      });
    } catch (e) {
      email_status = 'failed';
      console.warn('[support] admin notification email failed:', e.message);
    }

    return json(res, 200, { ticket, email_status });
  }

  return json(res, 405, { error: 'Method not allowed' });
}
