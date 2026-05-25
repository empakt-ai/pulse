// ═════════════════════════════════════════════════════════════════════════
// Mashal Data Layer — the global D object + hydrateD().
//
// D is the in-memory runtime state every screen reads from. Initial
// shape is a "loading-safe" stub so components that paint before
// /api/brief resolves don't blow up on D.accounts.ig.followers etc.
//
// hydrateD(brief) is the only writer. It maps the /api/brief response
// onto D in-place. The rest of the SPA bumps a React key after hydration
// to force a remount; D itself is never replaced (any cached references
// to `window.D` stay valid across re-renders).
//
// Loaded as <script type="text/babel" src="js/core/data.js"></script>
// in index.html after auth + api libs.
// ═════════════════════════════════════════════════════════════════════════

// Empty seed. Every field below is replaced by hydrateD() once
// /api/brief returns. The initial shape exists so screens that render
// during the loading window (before the brief resolves) don't blow up
// on undefined property access.
const D = {
  user: { firstName: null, name: 'You', initials: 'YO', plan: 'Creator' },
  workspace: 'Workspace',
  workspaces: [],
  activeWorkspaceId: null,
  briefLanguage: 'en',
  // Caller's role on the active workspace, plus a write-allowed boolean
  // for UI gating. Hydrated from /api/brief. Defaults to 'owner' so the
  // first paint (before the brief resolves) doesn't briefly hide buttons
  // the owner has every right to click.
  workspaceRole: 'owner',
  canWrite: true,
  // Referral unlock — surfaces the "Add card to unlock 30-day trial" CTA
  // on TrialBanner when this Creator workspace was referred.
  referralUnlockAvailable: false,
  lastSync: null,
  nextSync: null,
  intelScore: null,
  accounts: {},
  posts: [],
  signals: [],
  todayActions: [],
  actionPlan: [],
  formula: null,
  rewrite: null,
  marketContext: null,
  briefMetrics: null,
  competitors: [],
  // 6 rows × 7 cols, all zero. Real values come from /api/brief.heatmap.
  heatmap: Array.from({ length: 6 }, () => Array(7).fill(0)),
  heatmapHours: ['06–09','09–12','12–15','15–18','18–21','21–00'],
  ads: null,
  verdict: null,
  connectedPlatforms: [],
  // Admin-controlled runtime context populated by hydrateD(). Defaults
  // mean no flags honored, no admin UI activated, no tier override —
  // bit-identical to pre-Phase-3 behavior until /api/brief returns.
  isAdmin: false,
  asTier:  null,
  flags:   {},
};

// ── Formatters and lookup tables ─────────────────────────────────────────
const formatNum = (n) => {
  if (n >= 1e6) return (n/1e6).toFixed(n>=10e6?0:1).replace(/\.0$/,'') + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(n>=10e3?0:1).replace(/\.0$/,'') + 'K';
  return String(n);
};

const platformLabel = { ig: 'Instagram', tt: 'TikTok', yt: 'YouTube', li: 'LinkedIn', fb: 'Facebook', all: 'All platforms' };
const platformBrand = { ig: '#D62976', tt: '#010101', yt: '#FF0000', li: '#0A66C2', fb: '#1877F2' };

// Initials from a name/email — used by hydrateD to seed D.user.initials.
const initialsOf = (s) => {
  if (!s) return 'PU';
  const parts = String(s).split(/[ @._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || 'PU';
};

// Format a "last sync" timestamp into "Today, 06:04" / "2 hrs ago".
const formatSync = (iso) => {
  if (!iso) return '—';
  const then = new Date(iso);
  const now = new Date();
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return then.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// ── hydrateD — single writer onto D ──────────────────────────────────────
// Map /api/brief response onto the prototype's D shape.
const hydrateD = (brief) => {
  if (!brief) return;
  const u = brief.user || {};
  const a = brief.accountSummary || {};

  // User block. firstName is the explicit value captured during onboarding;
  // name falls back to the first word of that, or the email prefix.
  D.user = {
    firstName: u.first_name || null,
    name: u.first_name || u.name || u.email?.split('@')[0] || 'You',
    initials: initialsOf(u.first_name || u.name || u.email),
    plan: brief.tier?.label || 'Creator',
  };

  // Workspace label + list (powers the TopBar switcher).
  D.workspace = brief.workspace?.name || 'Workspace';
  D.workspaces = brief.workspaces || (brief.workspace ? [brief.workspace] : []);
  D.activeWorkspaceId = brief.workspace?.id || null;
  // Brief output language — the language the AI writes the brief in.
  // The shell stays in English regardless. Kept as a sibling field
  // because D.workspace itself is the name string, not the row.
  D.briefLanguage = brief.workspace?.brief_language || 'en';

  // Sync timings
  D.lastSync = formatSync(brief.lastSync);
  D.nextSync = 'Tomorrow, 06:00';

  // Accounts — preserve any platforms not in the live data (so dark mode tests
  // with partial connections don't crash on D.accounts.ig.followers etc.)
  const empty = (label) => ({ handle: '—', name: label, followers: 0, posts: 0, totalViews4W: 0, engRate4W: 0, avgViews: 0, totalPlays: 0, subs: 0, videos: 0, totalViews: 0, connections: 0 });
  // Carry through the new per-account fields (engRate30d, follower history,
  // WoW delta) so the Brief follower cards can render sparklines + deltas
  // without an extra fetch. Older platform shapes keep their existing keys.
  const enrich = (src) => ({
    engRate30d: src?.engRate30d ?? 0,
    reach30d: src?.reach30d ?? 0,
    followerHistory7d: src?.followerHistory7d || [],
    wowFollowers: src?.wowFollowers ?? 0,
  });
  D.accounts = {
    ig: a.ig ? { handle: a.ig.handle, followers: a.ig.followers, posts: a.ig.posts, totalViews4W: a.ig.totalViews4W, engRate4W: a.ig.avgEngRate, avgViews: a.ig.avgViews, ...enrich(a.ig) } : empty('Instagram'),
    tt: a.tt ? { handle: a.tt.handle, followers: a.tt.followers, videos: a.tt.posts, totalPlays: a.tt.totalViews4W, ...enrich(a.tt) } : empty('TikTok'),
    yt: a.yt ? { name: a.yt.handle || a.yt.name, subs: a.yt.followers, videos: a.yt.posts, totalViews: a.yt.totalViews4W, ...enrich(a.yt) } : empty('YouTube'),
    li: a.li ? { name: a.li.handle || a.li.name, connections: a.li.followers, posts: a.li.posts, ...enrich(a.li) } : empty('LinkedIn'),
    fb: a.fb ? { name: a.fb.handle || a.fb.name, followers: a.fb.followers, posts: a.fb.posts, ...enrich(a.fb) } : empty('Facebook'),
  };

  // Posts, signals, competitors, verdict, actions, intel score
  if (brief.posts?.length) D.posts = brief.posts;
  if (brief.signals?.length) D.signals = brief.signals;
  // Always replace competitors (even empty) so the UI reflects the actual
  // workspace state — the mock seed shouldn't leak through.
  D.competitors = brief.competitors || [];
  if (brief.heatmap?.length) D.heatmap = brief.heatmap;
  if (typeof brief.intelScore === 'number') D.intelScore = brief.intelScore;
  if (brief.todayActions?.length) D.todayActions = brief.todayActions;
  // Full action plan (6 actions across all timeframes) — Actions screen.
  D.actionPlan = brief.actionPlan || brief.todayActions || [];
  // Expose the AI verdict for the Brief screen's dark hero card
  if (brief.verdict) {
    D.verdict = brief.verdict;
  }
  // Distilled content formula — null until brief regenerates with the new schema.
  D.formula = brief.formula || null;
  // Strategic rewrite — competitor's top post + user's post + suggested rewrite.
  D.rewrite = brief.rewrite || null;
  // Market context — country-level TAM + platform usage reference.
  D.marketContext = brief.marketContext || null;
  // Aggregated reach / engagement / signals metrics that drive the Brief
  // screen stat cards (period-over-period deltas + per-platform splits).
  D.briefMetrics = brief.briefMetrics || null;
  // Which platforms are actually connected (keys of accountSummary).
  // Used by AccountBar to hide ghost tabs and by Brief's Pipeline status.
  D.connectedPlatforms = Object.keys(a || {});
  // Ad performance summary — null when no ads running.
  D.ads = brief.ads && brief.ads.count > 0 ? brief.ads : null;
  // Ad Intelligence module — benchmark/spot-score/recommendations payload
  // and the workspace's ad-goal/category settings. Both null when the
  // tier doesn't allow ads, no ads exist, or settings aren't configured.
  D.ads_intel = brief.ads_intel || null;
  D.adSettings = brief.adSettings || null;
  // Audience demographics — { allowed, locked, snapshotDate, byAccount }.
  // Always present so the Stats AudienceSection can read .allowed and
  // render the TrialLockedCard for Creator without a falsy guard. Empty
  // shape when the response is missing the field (older API versions).
  D.audience = brief.audience || { allowed: false, locked: false, snapshotDate: null, byAccount: {} };
  // Meta Ad Library competitor scrape — { allowed, locked, byCompetitor, totalAds }.
  // Same gating pattern as audience: Brand+ only, locked while trial active.
  D.competitorAds = brief.competitor_ads || { allowed: false, locked: false, byCompetitor: [], totalAds: 0 };
  // Tier + trial state — drive the trial banner, locked-card teasers,
  // and the full-screen paywall when trial.locked is true.
  D.tier = brief.tier || { key: 'creator', label: 'Creator' };
  D.trial = brief.trial || { active: false, locked: false };

  // Admin-controlled runtime context. flags is read everywhere (every
  // user gets the same flag set); is_admin / as_tier only flip true for
  // mnawaz@gmail.com (or any future profile with profiles.is_admin=true).
  // Nothing in core Mashal branches on these today — wiring is here so
  // future gated features can lazily start reading D.flags[key].
  D.isAdmin = !!brief.is_admin;
  D.asTier  = brief.as_tier || null;
  D.flags   = (brief.flags && typeof brief.flags === 'object') ? brief.flags : {};

  // Workspace role (owner/admin/member/viewer) — drives UI write-action
  // gating. canWrite is a derived convenience: viewers see read-only,
  // everyone else can mutate. API enforces this too; the UI gating is
  // just to avoid showing buttons that would 403.
  D.workspaceRole = brief.role || 'owner';
  D.canWrite      = D.workspaceRole !== 'viewer';

  // Referral unlock — true when this Creator workspace was referred and
  // can still add a card to extend the trial from 7 to 30 days. The
  // TrialBanner reads this to swap its CTA from "Upgrade now" to
  // "Add card. Free for 30 days".
  D.referralUnlockAvailable = !!brief.referral_unlock_available;
};

// Expose to the rest of the SPA (still inside index.html). Same pattern
// as auth.js and api.js.
Object.assign(window, { D, formatNum, platformLabel, platformBrand, initialsOf, formatSync, hydrateD });
