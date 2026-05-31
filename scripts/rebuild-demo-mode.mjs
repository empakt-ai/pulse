// One-shot rebuild — strips the legacy stand-alone-SPA scaffolding out
// of src/spa/demo-mode.jsx (originally src/demo/main.jsx) and replaces
// it with the new "demo-mode bootstrap for the main SPA" module:
//
//   - Detects /demo URL
//   - Pre-seeds a fake pulse_session so App()'s synchronous session
//     hydration returns valid (route lands on 'app' on first paint)
//   - Replaces window.api with an interceptor: /brief returns demo
//     data mapped from PERSONAS; mutations return safe no-ops; reads
//     return empty defaults
//   - Exposes setDemoPersona() / setDemoWorkspace() / setDemoBriefLang()
//     for the persona-switcher banner
//
// Keeps the PERSONAS data block exactly as-is (700+ lines). Everything
// before and after PERSONAS gets replaced.
//
// Run with: node scripts/rebuild-demo-mode.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target    = path.resolve(__dirname, '..', 'src', 'spa', 'demo-mode.jsx');

const src   = fs.readFileSync(target, 'utf-8');
const lines = src.split(/\r?\n/);

// Find `const PERSONAS = {` and walk braces to find the matching close.
const startIdx = lines.findIndex(l => /^const PERSONAS\s*=\s*\{/.test(l));
if (startIdx === -1) throw new Error('PERSONAS not found — file already rebuilt?');

let depth = 0;
let endIdx = -1;
for (let i = startIdx; i < lines.length; i++) {
  for (const ch of lines[i]) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  if (depth === 0 && i > startIdx) { endIdx = i; break; }
}
if (endIdx === -1) throw new Error('PERSONAS closing brace not found');

const personasBlock = lines.slice(startIdx, endIdx + 1).join('\n');

const HEADER = `// ═════════════════════════════════════════════════════════════════════════
// src/spa/demo-mode.jsx — runtime bootstrap that turns the main Mashal
// SPA into a login-free walkthrough when the URL is /demo.
//
// Imported BEFORE screens.jsx in src/spa/main.jsx so its top-level setup
// runs while the SPA still has a chance to read a session and intercept
// api() calls. When the URL isn't /demo this module is a no-op (top-level
// guard short-circuits; PERSONAS data and personaToBrief() still load
// but cost nothing until something invokes them).
//
// The four-tier PERSONAS catalogue below predates the SPA-integrated demo
// — it was the standalone /demo SPA's data model. Verbatim. The shape
// stays a "persona-flavoured nested config", NOT the /api/brief response
// shape; personaToBrief() does the mapping from PERSONAS → /api/brief.
//
// Window globals this module sets (for App()'s detection + the persona-
// switcher banner): __MASHAL_DEMO_MODE, __demoState, __demoSetPersona,
// __demoSetWorkspace, __demoSetBriefLang, __demoGetActiveBrief.
// ═════════════════════════════════════════════════════════════════════════

const DEMO_MODE =
  typeof window !== 'undefined' &&
  (window.location.pathname.replace(/\\/$/, '') === '/demo' ||
   window.location.pathname.replace(/\\/$/, '') === '/demo/index.html');

`;

const BOOTSTRAP = `
// Module-shared mutable state. Populated in the DEMO_MODE branch below.
let _activePersonaId  = 'creator';
let _activeWorkspaceId = null;
let _briefLang        = 'en';

// ── personaToBrief — adapter: PERSONAS → /api/brief response shape ──
// hydrateD() in js/core/data.jsx is the consumer. Anything it indexes
// that we don't supply will fall back to D's empty-defaults in its
// "loading-safe stub" initial value, so the SPA renders without crashes
// even when the demo data is thin in a particular field.
function personaToBrief(personaId, workspaceId, lang) {
  const persona = PERSONAS[personaId] || PERSONAS.creator;
  // Agency: workspace's own data wins; non-agency: the persona itself.
  const ws = persona.workspaces && (
    persona.workspaces.find(w => w.id === workspaceId) ||
    persona.workspaces[0]
  );
  const source = ws || persona;

  // Pick the right brief variant. Brand has briefs_ar for the EN/AR
  // toggle; everything else uses briefs.
  const briefs =
    (personaId === 'brand' && lang === 'ar' && Array.isArray(source.briefs_ar))
      ? source.briefs_ar
      : (source.briefs || persona.briefs || []);
  const firstBrief = briefs[0] || { verdict: '', actions: [] };

  // Map plat-keyed array to {ig, tt, yt, li, fb} object — the shape
  // hydrateD() reads. Anything missing falls through to empty().
  const accountSummary = {};
  for (const a of (source.accounts || persona.accounts || [])) {
    const key = a.plat === 'sc' || a.plat === 'x' ? null : a.plat;
    if (!key) continue; // hydrateD only knows ig/tt/yt/li/fb today
    accountSummary[key] = {
      handle:        a.handle || persona.person?.handle || '@demo',
      followers:     a.followers || 0,
      posts:         a.posts || 12,
      totalViews4W:  a.totalViews4W || Math.round((a.followers || 0) * 0.6),
      avgEngRate:    a.er || 0,
      avgViews:      a.avgViews || Math.round((a.followers || 0) * 0.4),
      engRate30d:    a.er || 0,
      reach30d:      a.reach30d || Math.round((a.followers || 0) * 0.45),
      followerHistory7d: a.spark || [],
      wowFollowers:  a.delta || 0,
    };
  }

  // Tier metadata aligned with current Mashal pricing.
  const TIER = {
    creator:     { key: 'creator',     label: 'Creator' },
    pro_creator: { key: 'pro_creator', label: 'Pro Creator' },
    brand:       { key: 'brand',       label: 'Brand' },
    agency:      { key: 'agency',      label: 'Agency' },
  }[personaId] || { key: personaId, label: persona.name };

  // Map signals to the shape SignalsCard / IntelScreen expects.
  const signalsOut = (source.signals || persona.signals || []).map((s, i) => ({
    id: 'demo-signal-' + i,
    type: s.type || 'general',
    title: s.title,
    body: s.body,
    severity: s.color === 'magenta' ? 'high' : s.color === 'amber' ? 'medium' : 'low',
    platform: 'all',
    createdAt: new Date().toISOString(),
  }));

  // Map competitors.
  const competitorsOut = (source.competitors || persona.competitors || []).map((c, i) => ({
    id: 'demo-comp-' + i,
    handle: c.handle,
    platform: c.plat,
    followers: c.them,
    yourFollowers: c.you,
    pct: c.pct,
  }));

  // Actions — split into todayActions (first 3) + actionPlan (all 6).
  const actionsOut = (firstBrief.actions || []).map((a, i) => ({
    id: 'demo-action-' + i,
    timeframe: a.when,
    platform: a.plat,
    text: a.text,
    rtl: !!a.rtl,
  }));

  // First name shown in "Good morning, X." — agencies skip personal greeting.
  const firstName =
    personaId === 'agency'
      ? (ws?.name || 'team')
      : (persona.person?.firstName || persona.name || 'there');

  return {
    user: {
      first_name: firstName,
      name:       firstName,
      email:      'demo@mashal.app',
    },
    workspace: {
      id:             ws?.id || personaId,
      name:           ws?.name || persona.name,
      brief_language: lang === 'ar' ? 'ar' : 'en',
    },
    workspaces:
      personaId === 'agency'
        ? persona.workspaces.map(w => ({ id: w.id, name: w.name }))
        : [{ id: personaId, name: persona.name }],
    accountSummary,
    posts:        [],
    signals:      signalsOut,
    competitors:  competitorsOut,
    heatmap:      Array.from({ length: 6 }, (_, r) =>
                    Array.from({ length: 7 }, (_, c) =>
                      Math.max(0, Math.round(20 + 80 * Math.sin((r * c + r + c) * 0.7))))),
    intelScore:   source.intel?.score ?? persona.intel?.score ?? null,
    todayActions: actionsOut.slice(0, 3),
    actionPlan:   actionsOut,
    verdict: {
      headline: firstBrief.verdict || '',
      // Render-time RTL marker so the BriefScreen verdict block applies
      // dir="rtl" + Arabic font fallback exactly like the standalone demo did.
      rtl: !!firstBrief.rtl,
      translation: firstBrief.verdictTranslation || null,
    },
    formula:        null,
    rewrite:        null,
    marketContext:  persona.market || null,
    briefMetrics:   null,
    ads:            null,
    ads_intel:      null,
    adSettings:     null,
    audience: {
      allowed:      personaId !== 'creator',
      locked:       false,
      snapshotDate: new Date().toISOString(),
      byAccount:    {},
    },
    competitor_ads: {
      allowed:       personaId === 'brand' || personaId === 'agency',
      locked:        false,
      byCompetitor:  [],
      totalAds:      0,
    },
    tier:  TIER,
    trial: { active: false, locked: false },
    is_admin: false,
    as_tier:  null,
    flags:    {},
    role:     'owner',
    referral_unlock_available: false,
    lastSync: new Date().toISOString(),
  };
}

// ── Setters — invoked by the persona-switcher banner. Each one updates
//    the URL, persists the choice, and triggers a brief re-fetch via the
//    custom event App() listens to.
function syncDemoUrl() {
  try {
    const u = new URL(window.location.href);
    u.searchParams.set('persona', _activePersonaId);
    if (_activePersonaId === 'agency' && _activeWorkspaceId) {
      u.searchParams.set('workspace', _activeWorkspaceId);
    } else {
      u.searchParams.delete('workspace');
    }
    if (_activePersonaId === 'brand' && _briefLang !== 'en') {
      u.searchParams.set('lang', _briefLang);
    } else {
      u.searchParams.delete('lang');
    }
    window.history.replaceState({}, '', u.toString());
  } catch {}
}

function rehydrate() {
  // App()'s brief-fetch effect listens for this event and re-runs api('/brief'),
  // which our interceptor turns into a fresh personaToBrief() call against the
  // updated module-level state.
  window.dispatchEvent(new CustomEvent('demo:rehydrate'));
}

function setDemoPersona(id) {
  if (!PERSONAS[id]) return;
  _activePersonaId = id;
  _activeWorkspaceId =
    id === 'agency' ? PERSONAS.agency.workspaces[0].id : null;
  // Lang toggle only meaningful for Brand — reset to EN otherwise.
  if (id !== 'brand') _briefLang = 'en';
  syncDemoUrl();
  rehydrate();
}

function setDemoWorkspace(wid) {
  if (_activePersonaId !== 'agency') return;
  if (!PERSONAS.agency.workspaces.find(w => w.id === wid)) return;
  _activeWorkspaceId = wid;
  syncDemoUrl();
  rehydrate();
}

function setDemoBriefLang(lang) {
  if (!['en', 'ar'].includes(lang)) return;
  _briefLang = lang;
  syncDemoUrl();
  rehydrate();
}

function getActiveBrief() {
  return personaToBrief(_activePersonaId, _activeWorkspaceId, _briefLang);
}

function getDemoState() {
  return {
    personaId:   _activePersonaId,
    workspaceId: _activeWorkspaceId,
    briefLang:   _briefLang,
    personas:    PERSONAS,
  };
}

// ── DEMO_MODE bootstrap (only runs when the URL is /demo) ──
if (DEMO_MODE) {
  window.__MASHAL_DEMO_MODE = true;

  // Initial active persona / workspace / brief-language from URL params.
  try {
    const params = new URLSearchParams(window.location.search);
    const p = params.get('persona');
    if (p && PERSONAS[p]) _activePersonaId = p;
    if (_activePersonaId === 'agency') {
      const w = params.get('workspace');
      const wsRow = PERSONAS.agency.workspaces.find(x => x.id === w);
      _activeWorkspaceId = wsRow ? wsRow.id : PERSONAS.agency.workspaces[0].id;
    }
    if (params.get('lang') === 'ar' && _activePersonaId === 'brand') {
      _briefLang = 'ar';
    }
  } catch {}

  // Fake Supabase session — App()'s synchronous session initializer
  // (screens.jsx ~line 6155) reads localStorage and treats anything with
  // an access_token as a valid session. user.created_at is set far in the
  // past so the "isNew → onboarding" routing branch doesn't fire.
  try {
    localStorage.setItem('pulse_session', JSON.stringify({
      access_token:  'demo',
      refresh_token: 'demo',
      token_type:    'bearer',
      expires_at:    Math.floor(Date.now() / 1000) + 7 * 86400,
      user: {
        id:         'demo-user',
        email:      'demo@mashal.app',
        created_at: '2024-01-01T00:00:00Z',
      },
    }));
  } catch {}

  // Token that api.jsx reads from window.__pulseToken — keeps Authorization
  // header populated so the interceptor sees the same code path as a real
  // session. Value doesn't matter; interceptor short-circuits before fetch.
  window.__pulseToken = 'demo';

  // Intercept window.api. js/core/api.jsx already ran by import order, so
  // window.api exists; we wrap it.
  const realApi = typeof window.api === 'function' ? window.api : null;
  window.api = async (path, opts = {}) => {
    const clean = String(path || '').split('?')[0];

    // The big one — the SPA's brief fetch.
    if (clean === '/brief') return getActiveBrief();

    // Read-only endpoints — safe empty defaults.
    if (clean === '/workspaces')         return { workspaces: getDemoState().personas[_activePersonaId].workspaces || [{ id: _activePersonaId, name: PERSONAS[_activePersonaId].name }] };
    if (clean === '/team/members')       return { members: [{ id: 'demo-owner', email: 'demo@mashal.app', role: 'owner', accepted_at: new Date().toISOString() }], invitations: [] };
    if (clean === '/workspace/webhooks') return { webhooks: [] };
    if (clean === '/competitors')        return { competitors: getActiveBrief().competitors };
    if (clean === '/referral')           return { code: 'DEMO', referrals: [], earnings: 0 };
    if (clean === '/reports')            return { reports: [] };
    if (clean === '/support')            return { tickets: [] };
    if (clean === '/accounts')           return { accounts: [] };

    // Mutations + on-demand jobs. Return ok=true so the UI proceeds, no
    // actual server work happens.
    if (clean === '/sync')                  return { ok: true, demo: true };
    if (clean === '/accounts/backfill')     return { ok: true, demo: true };
    if (clean === '/analytics/refresh')     return { ok: true, demo: true };
    if (clean === '/intelligence/generate') return { ok: true, demo: true };
    if (clean === '/team/invite')           return { ok: true, demo: true };
    if (clean === '/team/accept')           return { ok: true, demo: true };

    // Catch-all: empty object. Better to silently 200 than to crash a
    // screen that's exploring an endpoint we didn't anticipate.
    if (realApi) {
      // Anything containing the substring '/login' or '/auth' should
      // never hit the network in demo mode either.
      if (clean.startsWith('/auth') || clean.includes('/login')) return {};
    }
    return {};
  };

  // Expose for the persona-switcher banner (or any other consumer).
  window.__demoSetPersona     = setDemoPersona;
  window.__demoSetWorkspace   = setDemoWorkspace;
  window.__demoSetBriefLang   = setDemoBriefLang;
  window.__demoGetState       = getDemoState;
  window.__demoGetActiveBrief = getActiveBrief;
}

export { PERSONAS, personaToBrief, setDemoPersona, setDemoWorkspace, setDemoBriefLang, getDemoState, getActiveBrief, DEMO_MODE };
`;

const next = HEADER + '\n' + personasBlock + '\n' + BOOTSTRAP;
fs.writeFileSync(target, next);

console.log(`Rewrote ${path.relative(path.resolve(__dirname, '..'), target)}`);
console.log(`  PERSONAS block: lines ${startIdx + 1}-${endIdx + 1} of original (${endIdx - startIdx + 1} lines)`);
console.log(`  New file size: ${next.split('\\n').length} lines`);
