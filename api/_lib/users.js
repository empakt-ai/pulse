// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Supabase auth-admin user lookup. The auth.users table isn't
// exposed via PostgREST, but Supabase's admin REST endpoint at
// /auth/v1/admin/users is. We fetch (id, email, user_metadata) for the
// requested user ids and the caller merges in JS.
//
// Same shape as the private helper that lived in api/admin.js — pulled
// out so api/team/members.js can use it without depending on admin
// internals. The function gracefully returns [] on any failure so a
// missing SUPABASE_SERVICE_KEY doesn't crash the caller.
// ═════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gyiiccstlrgzfbwgtuww.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

export async function listAuthUsers({ ids = null, perPage = 1000 } = {}) {
  if (!SERVICE_KEY) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=${perPage}`, {
      headers: {
        'apikey':        SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const users = data?.users || [];
    if (!ids) return users;
    const set = new Set(ids);
    return users.filter(u => set.has(u.id));
  } catch (e) {
    console.warn('[users] listAuthUsers failed:', e.message);
    return [];
  }
}

// Convenience: build a Map of id → { email, first_name, full_name }.
// Used by team panel rendering to avoid N round-trips.
export async function userMapById(ids) {
  if (!ids?.length) return new Map();
  const users = await listAuthUsers({ ids });
  const m = new Map();
  for (const u of users) {
    m.set(u.id, {
      email:      u.email || null,
      first_name: u.user_metadata?.first_name || null,
      full_name:  u.user_metadata?.full_name  || null,
    });
  }
  return m;
}
