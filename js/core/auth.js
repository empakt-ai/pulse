// ═════════════════════════════════════════════════════════════════════════
// PULSE Auth — Supabase magic-link + email/password client.
//
// Source of truth for everything in the auth library: the sbAuth object
// (sign in / sign up / refresh / session store), magic-link URL handling,
// and session restoration on page load.
//
// Loaded as <script type="text/babel" src="js/core/auth.js"></script> in
// index.html before any other script that calls these. Exports to window
// at the bottom so the rest of the SPA can read sbAuth / restoreSession
// / checkMagicLinkHash without a module system.
//
// Anything UI-shaped — the <Auth> React component, the sign-in form —
// stays in index.html. This file is the auth LAYER, not the auth SCREEN.
// ═════════════════════════════════════════════════════════════════════════

const SUPABASE_URL  = 'https://gyiiccstlrgzfbwgtuww.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5aWljY3N0bHJnemZid2d0dXd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTcyOTEsImV4cCI6MjA5NDA5MzI5MX0.mC7iQ73NhSsER1c22zT63ntRXwsVLwq6Pv-oRv15kDA';

// ── Lightweight Supabase auth client (no SDK needed) ─────────────────────────
const sbAuth = {
  headers: () => ({
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_ANON,
    'Authorization': `Bearer ${SUPABASE_ANON}`
  }),

  // Magic link (OTP)
  signInWithOtp: async (email) => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
      method: 'POST',
      headers: sbAuth.headers(),
      body: JSON.stringify({ email, create_user: true, options: { emailRedirectTo: window.location.origin } })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || 'Could not send link');
    return data;
  },

  // Email + password sign up
  signUp: async (email, password) => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: sbAuth.headers(),
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || 'Sign up failed');
    return data;
  },

  // Email + password sign in
  signIn: async (email, password) => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: sbAuth.headers(),
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || 'Sign in failed');
    return data; // { access_token, refresh_token, user }
  },

  // Verify OTP token from magic link hash
  verifyOtp: async (token, email) => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
      method: 'POST',
      headers: sbAuth.headers(),
      body: JSON.stringify({ type: 'magiclink', token, email })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || 'Verification failed');
    return data;
  },

  // Update the current user's metadata (e.g. first name). Goes through
  // Supabase Auth's PUT /user endpoint with the user's own access token —
  // the service role is not involved on the client side.
  updateUser: async (accessToken, patch) => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        ...sbAuth.headers(),
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || 'Update failed');
    return data; // updated user
  },

  // Exchange a refresh_token for a fresh access_token. Supabase access tokens
  // expire after 1 hour; without this, anyone who left the tab open and came
  // back gets logged out.
  refresh: async (refreshToken) => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: sbAuth.headers(),
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || 'Token refresh failed');
    return data; // { access_token, refresh_token (new), expires_in, user }
  },

  // Get session from localStorage
  getSession: () => {
    try {
      const raw = localStorage.getItem('pulse_session');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },

  // Save session
  saveSession: (session) => {
    localStorage.setItem('pulse_session', JSON.stringify(session));
    window.__pulseToken = session.access_token;
  },

  // Clear session
  clearSession: () => {
    localStorage.removeItem('pulse_session');
    window.__pulseToken = null;
  }
};

// ── Check for magic link token in URL hash on load ────────────────────────────
const checkMagicLinkHash = async (onAuthed) => {
  const hash = window.location.hash;
  if (!hash.includes('access_token')) return false;

  try {
    const params = new URLSearchParams(hash.replace('#', ''));
    const accessToken  = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken) return false;

    // Get user from token
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey':        SUPABASE_ANON,
        'Authorization': `Bearer ${accessToken}`
      }
    });
    const user = await res.json();

    const session = { access_token: accessToken, refresh_token: refreshToken, user };
    sbAuth.saveSession(session);

    // Log this sign-in for the admin user-history view. Best-effort; the
    // user is signed in whether or not the log call succeeds.
    fetch('/api/auth-log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ method: 'magic_link', session_id: accessToken.slice(0, 32) }),
    }).catch(() => {});

    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);
    onAuthed(session);
    return true;
  } catch (e) {
    console.error('Magic link verification failed:', e);
    return false;
  }
};

// ── Session restore on app load ───────────────────────────────────────────────
// Verifies the saved access_token still works. If it's expired (very likely
// after >1 hour idle), exchanges the refresh_token for a fresh access_token
// before giving up. Only clears the session if the refresh also fails.
// Validates the cached Supabase session.
//   - On success with the SAME token: does NOT call onAuthed → no setState
//     → no re-render. This is the path that previously caused a visible
//     blink ~1.5s after first paint on every page navigation.
//   - On token refresh (new access_token): calls onAuthed so the new
//     token propagates into React state.
//   - On hard failure: calls onInvalidated so the app can redirect.
const restoreSession = (onAuthed, onInvalidated) => {
  const session = sbAuth.getSession();
  if (!session?.access_token) return false;

  window.__pulseToken = session.access_token;

  fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey':        SUPABASE_ANON,
      'Authorization': `Bearer ${session.access_token}`
    }
  }).then(async r => {
    if (r.ok) {
      // Valid session. Do NOT trigger a re-render — the synchronous init
      // already routed us into the app with this session, so no React
      // state change is needed. Quietly stash the freshened user object
      // for components that read it lazily (e.g. via window.__pulseUser).
      try {
        const user = await r.json();
        if (user) window.__pulseUser = user;
      } catch {}
      return;
    }
    // Token rejected — try to refresh before clearing.
    if (session.refresh_token) {
      try {
        const refreshed = await sbAuth.refresh(session.refresh_token);
        sbAuth.saveSession(refreshed);
        // Genuinely new tokens — propagate into state.
        onAuthed?.(refreshed);
        return;
      } catch (e) {
        // Refresh failed too — session is genuinely dead.
      }
    }
    sbAuth.clearSession();
    onInvalidated?.();
  }).catch(() => {
    // Network error reaching Supabase /user. Don't nuke the session for a
    // transient failure — keep the cached session in place. The synchronous
    // init already routed us into the app with this session, so silently
    // bail (no setState, no re-render).
  });

  return true;
};

// Export so the rest of the SPA (still in index.html) can reach them
// without a real module system. Same pattern as admin.html.
Object.assign(window, { sbAuth, checkMagicLinkHash, restoreSession, SUPABASE_URL, SUPABASE_ANON });
