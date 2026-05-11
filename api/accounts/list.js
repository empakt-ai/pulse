import { authenticate, json } from '../lib/auth.js';
import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  if (!auth.workspace) return json(res, 404, { error: 'Workspace not found' });

  const accounts = await supabase.select('connected_accounts', {
    select: '*',
    eq: { workspace_id: auth.workspace.id },
    order: 'connected_at.asc',
  }).catch(() => []);

  return json(res, 200, { accounts: accounts || [] });
}
