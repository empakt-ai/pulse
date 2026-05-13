// ═════════════════════════════════════════════════════════════════════════
// PULSE API client — single fetch wrapper used by every screen.
//
// All requests:
//   - hit `${API_BASE}/api${path}` (API_BASE empty in production → same
//     origin; settable via window.PULSE_API_URL for staging/dev)
//   - send Bearer token from window.__pulseToken (set by js/core/auth.js)
//   - send x-workspace-id when localStorage has one set (the workspace
//     switcher path)
//   - throw a real Error on non-2xx so screens can `try / catch` cleanly
//
// `window.switchWorkspace(id)` lives here because it's the only mutation
// to the localStorage key the api wrapper reads. Keeping them adjacent
// makes the contract obvious.
// ═════════════════════════════════════════════════════════════════════════

const API_BASE = window.PULSE_API_URL || '';

// ── API client (calls our backend, which holds keys) ─────────────────────────
const api = async (path, opts = {}) => {
  const token = window.__pulseToken; // set by auth layer
  // Active workspace selector — let the user own multiple workspaces and
  // scope every API call to whichever one is "active" in the UI. Defaults to
  // null (server falls back to oldest workspace).
  const wsId = (() => {
    try { return localStorage.getItem('pulse:workspaceId') || null; } catch { return null; }
  })();
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(wsId ? { 'x-workspace-id': wsId } : {}),
      ...(opts.headers || {})
    }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

// Workspace switcher — sets the active workspace, persists it, and forces a
// hard reload so every screen re-hydrates from /api/brief with the new scope.
window.switchWorkspace = (id) => {
  try {
    if (id) localStorage.setItem('pulse:workspaceId', id);
    else localStorage.removeItem('pulse:workspaceId');
  } catch {}
  window.location.reload();
};

// Expose to the rest of the SPA (which still lives inside index.html and
// has no module system). Auth lib was extracted the same way.
Object.assign(window, { api, API_BASE });
