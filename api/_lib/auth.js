// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// Generic Bearer-token validation + workspace selection. No PULSE-specific
// concepts (tier checks, signal logic, etc.) belong in this file.
// ═════════════════════════════════════════════════════════════════════════
//
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

  // Workspace selection: a user may own multiple workspaces (one per
  // subscription). The client picks the active workspace via the
  // `x-workspace-id` header (stored in localStorage). If absent or invalid,
  // fall back to the oldest workspace the user owns — that's their original
  // signup workspace, auto-created by the Supabase trigger.
  const requestedWsId =
    req.headers?.['x-workspace-id'] || req.headers?.['X-Workspace-Id'] || null;

  const owned = await supabase.select('workspaces', {
    select: '*',
    eq: { owner_id: user.id },
    order: 'created_at.asc',
  }) || [];

  let workspace = null;
  if (requestedWsId) {
    workspace = owned.find(w => w.id === requestedWsId) || null;
  }
  if (!workspace) workspace = owned[0] || null;

  return { user, workspace, token, workspaces: owned };
}

// Helper to send JSON consistently
export function json(res, status, body) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(body));
}
