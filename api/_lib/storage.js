// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Supabase Storage helpers — fetch-only, no SDK dependency.
// Service-role key bypasses bucket RLS, so we can upload + sign without
// needing per-bucket policies. The 'reports' bucket must exist (see
// migrations/011_reports.sql for setup notes).
// ═════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gyiiccstlrgzfbwgtuww.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const authHeaders = (extra = {}) => ({
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  ...extra,
});

// Upload a Buffer/Uint8Array to <bucket>/<path>. Overwrites existing file.
// Throws on non-2xx with body for diagnosis. Returns the storage path on success.
export async function uploadFile(bucket, path, body, { contentType = 'application/octet-stream' } = {}) {
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY missing');
  const url = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders({
      'Content-Type': contentType,
      'x-upsert': 'true', // overwrite if exists — idempotent regen
      'Cache-Control': 'max-age=3600',
    }),
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Storage upload failed (${res.status}): ${text || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return path;
}

// Create a signed URL valid for `expiresIn` seconds. Used by the API to hand
// the front-end a read URL without exposing the service key.
export async function createSignedUrl(bucket, path, expiresIn = 3600) {
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY missing');
  const url = `${SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Signed URL creation failed (${res.status}): ${text || res.statusText}`);
  }
  const data = await res.json();
  // signedURL is path-only (e.g. "/storage/v1/object/sign/..."), prepend host.
  return data.signedURL ? `${SUPABASE_URL}${data.signedURL}` : data.signedUrl || null;
}

// Permanently remove an object from storage. Best-effort — swallows 404
// (already gone) but throws on other errors.
export async function removeFile(bucket, path) {
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY missing');
  const url = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`Storage delete failed (${res.status}): ${text || res.statusText}`);
  }
}
