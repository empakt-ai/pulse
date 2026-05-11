// Auth middleware for Vercel serverless functions.
// Extracts Bearer token, validates with Supabase, returns { user, workspace }.

import { supabase } from './supabase.js';

export async function authenticate(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return { error: 'No auth token', status: 401 };
  }

  const user = await supabase.getUserFromToken(token);
  if (!user || !user.id) {
    return { error: 'Invalid token', status: 401 };
  }

  // Workspace is auto-created via Supabase trigger on signup.
  const workspace = await supabase.select('workspaces', {
    select: '*',
    eq: { owner_id: user.id },
    limit: 1,
    single: true,
  });

  return { user, workspace, token };
}

// Helper to send JSON consistently
export function json(res, status, body) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(body));
}
