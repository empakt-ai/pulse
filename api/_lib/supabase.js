// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service
// when Content Studio is built. No PULSE-specific logic lives here.
// ═════════════════════════════════════════════════════════════════════════
//
// Server-side Supabase REST client using the service role key.
// Bypasses RLS — only use from /api routes after auth() has validated the caller.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gyiiccstlrgzfbwgtuww.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SERVICE_KEY) {
  console.warn('[supabase] SUPABASE_SERVICE_KEY missing — backend calls will fail');
}

const restHeaders = (extra = {}) => ({
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  ...extra,
});

async function rest(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res = await fetch(url, { ...opts, headers: { ...restHeaders(opts.headers || {}) } });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = (body && (body.message || body.error)) || `Supabase ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const supabase = {
  url: SUPABASE_URL,

  // SELECT helper
  // table, query: { select, eq: { col: val }, limit, order, single }
  async select(table, q = {}) {
    const params = new URLSearchParams();
    if (q.select) params.set('select', q.select);
    if (q.eq) for (const [k, v] of Object.entries(q.eq)) params.set(k, `eq.${v}`);
    if (q.in) for (const [k, vals] of Object.entries(q.in)) params.set(k, `in.(${vals.join(',')})`);
    if (q.order) params.set('order', q.order);
    if (q.limit) params.set('limit', String(q.limit));
    const headers = q.single ? { 'Accept': 'application/vnd.pgrst.object+json' } : {};
    const path = `/${table}?${params.toString()}`;
    try {
      return await rest(path, { method: 'GET', headers });
    } catch (e) {
      if (q.single && e.status === 406) return null;
      throw e;
    }
  },

  async insert(table, rows, { returning = 'representation' } = {}) {
    const headers = { 'Prefer': `return=${returning}` };
    return rest(`/${table}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
    });
  },

  async upsert(table, rows, { onConflict, returning = 'representation' } = {}) {
    const headers = { 'Prefer': `resolution=merge-duplicates,return=${returning}` };
    const qp = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
    return rest(`/${table}${qp}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
    });
  },

  async update(table, patch, q = {}) {
    const params = new URLSearchParams();
    if (q.eq) for (const [k, v] of Object.entries(q.eq)) params.set(k, `eq.${v}`);
    return rest(`/${table}?${params.toString()}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(patch),
    });
  },

  async delete(table, q = {}) {
    const params = new URLSearchParams();
    if (q.eq) for (const [k, v] of Object.entries(q.eq)) params.set(k, `eq.${v}`);
    return rest(`/${table}?${params.toString()}`, { method: 'DELETE' });
  },

  // Auth — verify a user JWT and return the user record.
  async getUserFromToken(token) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json();
  },
};

export default supabase;
