// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Workspace webhooks CRUD.
//
//   GET    /api/workspace/webhooks                → list workspace webhooks
//   POST   /api/workspace/webhooks                → create new webhook
//   PUT    /api/workspace/webhooks?id=...         → update toggle/events/label
//   POST   /api/workspace/webhooks?action=test&id=...  → fire a test delivery
//   DELETE /api/workspace/webhooks?id=...         → delete webhook
//
// Cap: 5 active webhooks per workspace. Lives in code (not the table)
// so the policy is easy to evolve per-tier if we want to.
//
// The POST response includes the freshly-generated `secret` once. Every
// subsequent read returns a redacted form (secret_preview only). If a
// user loses the secret they must rotate by deleting and re-creating
// the webhook — by design; secret material doesn't sit on the API
// surface where it could be logged or browser-cached.
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json } from '../_lib/auth.js';
import { supabase } from '../_lib/supabase.js';
import { assertRole } from '../_lib/permissions.js';
import {
  ALLOWED_EVENTS,
  generateWebhookSecret,
  isValidWebhookUrl,
  redactWebhook,
  dispatchEvent,
} from '../_lib/webhooks.js';

const MAX_PER_WORKSPACE = 5;

// Parse + validate the JSON body. Returns { body, error }.
async function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return { body: null, error: 'Invalid JSON body' }; }
  }
  if (!body || typeof body !== 'object') return { body: null, error: 'Empty body' };
  return { body, error: null };
}

// Normalise the events array — strip unknowns, dedupe, lowercase.
function normaliseEvents(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const e of raw) {
    if (typeof e !== 'string') continue;
    const k = e.toLowerCase().trim();
    if (!ALLOWED_EVENTS.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  if (req.method === 'GET') {
    const rows = await supabase.select('workspace_webhooks', {
      select: '*',
      eq: { workspace_id: ws.id },
      order: 'created_at.desc',
    }).catch(() => []);
    return json(res, 200, {
      webhooks: (rows || []).map(redactWebhook),
      allowed_events: [...ALLOWED_EVENTS],
      max_per_workspace: MAX_PER_WORKSPACE,
    });
  }

  // Everything below mutates — viewers can't write.
  const denied = assertRole(auth, 'member');
  if (denied) return json(res, denied.status, denied.body);

  if (req.method === 'POST' && req.query?.action === 'test') {
    const id = req.query?.id;
    if (!id) return json(res, 400, { error: 'id required for test' });
    const row = await supabase.select('workspace_webhooks', {
      select: '*',
      eq: { id, workspace_id: ws.id },
      single: true,
    }).catch(() => null);
    if (!row) return json(res, 404, { error: 'Webhook not found' });

    // Dispatch a one-off test event so the user can see the receiver
    // accepting a signed payload. We don't filter by subscribed events
    // here — the test fires regardless of subscription.
    const subscribers = [row];
    const results = await Promise.all(subscribers.map(async w => {
      const r = await dispatchEvent(ws.id, 'brief_generated', {
        test: true,
        message: 'This is a test delivery from Mashal. If you can read this, the webhook is wired correctly.',
        workspace_name: ws.name,
      });
      return r;
    }));
    return json(res, 200, { ok: true, results });
  }

  if (req.method === 'POST') {
    const { body, error } = await parseBody(req);
    if (error) return json(res, 400, { error });

    if (!isValidWebhookUrl(body.url)) {
      return json(res, 400, { error: 'URL must be https:// (or http://localhost for dev)' });
    }
    const events = normaliseEvents(body.events);

    // Enforce per-workspace cap.
    const existing = await supabase.select('workspace_webhooks', {
      select: 'id', eq: { workspace_id: ws.id },
    }).catch(() => []);
    if ((existing || []).length >= MAX_PER_WORKSPACE) {
      return json(res, 429, {
        error: `Webhook limit reached (${MAX_PER_WORKSPACE} per workspace). Remove one before adding another.`,
      });
    }

    const secret = generateWebhookSecret();
    let inserted = null;
    try {
      const result = await supabase.insert('workspace_webhooks', {
        workspace_id: ws.id,
        url: body.url,
        label: body.label || null,
        secret,
        events,
        is_active: true,
        created_by: auth.user.id,
      });
      inserted = result?.[0] || null;
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
    if (!inserted) return json(res, 500, { error: 'Insert failed' });

    // Return the secret ONCE, in the create response only. Subsequent
    // GETs only see the secret_preview.
    return json(res, 200, {
      webhook: { ...redactWebhook(inserted), secret },
    });
  }

  if (req.method === 'PUT') {
    const id = req.query?.id;
    if (!id) return json(res, 400, { error: 'id required' });
    const { body, error } = await parseBody(req);
    if (error) return json(res, 400, { error });

    const patch = { updated_at: new Date().toISOString() };
    if (typeof body.label === 'string') patch.label = body.label || null;
    if (typeof body.is_active === 'boolean') patch.is_active = body.is_active;
    if (Array.isArray(body.events)) patch.events = normaliseEvents(body.events);
    if (typeof body.url === 'string') {
      if (!isValidWebhookUrl(body.url)) {
        return json(res, 400, { error: 'URL must be https://' });
      }
      patch.url = body.url;
    }
    // A successful PUT with new url/is_active should reset failure_count
    // so a previously-disabled webhook can be re-enabled cleanly.
    if (patch.is_active === true || patch.url) {
      patch.failure_count = 0;
      patch.last_error = null;
    }

    try {
      await supabase.update('workspace_webhooks', patch, { eq: { id, workspace_id: ws.id } });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
    const refreshed = await supabase.select('workspace_webhooks', {
      select: '*', eq: { id, workspace_id: ws.id }, single: true,
    }).catch(() => null);
    return json(res, 200, { webhook: redactWebhook(refreshed) });
  }

  if (req.method === 'DELETE') {
    const id = req.query?.id;
    if (!id) return json(res, 400, { error: 'id required' });
    try {
      await supabase.delete('workspace_webhooks', { eq: { id, workspace_id: ws.id } });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: 'Method not allowed' });
}
