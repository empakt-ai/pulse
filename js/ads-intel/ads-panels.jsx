import React from 'react';

// Snapshot the shared symbols this file references off window.
// They are published there by src/spa/utilities.jsx and the js/core/*
// modules; src/spa/main.jsx guarantees the load order.
const {
  cls,
  safeHref,
  Card,
  Btn,
  Eyebrow,
  Plat,
  Sparkline,
  BarSpark,
  Pill,
  MashalDot,
  Progress,
  StatCard,
  SectionHead,
  MashalLogo,
  PlatformIcons,
  Icon,
  D,
  formatNum,
  platformLabel,
  platformBrand,
  initialsOf,
  formatSync,
  hydrateD,
  api,
  API_BASE,
  sbAuth,
  SUPABASE_URL,
  SUPABASE_ANON,
  restoreSession,
  checkMagicLinkHash,
  SubscriptionBanner,
  UpgradeDialog,
} = window;


// ═════════════════════════════════════════════════════════════════════════
// Mashal Ad Intelligence — AdsScreen panels.
//
// Three self-contained components mounted inside AdsScreen:
//
//   AdsIntelComparePanel    — Spot-Score benchmark table per platform
//   AdsIntelRecommendations — Ranked recommendation cards (or setup CTA)
//   AdsIntelAgencySwitcher  — Per-client workspace switcher (Agency tier)
//   AdsIntelContextChips    — Goal + category pills, used in ScreenHeader sub
//
// All four read from window.D (D.ads_intel, D.adSettings, D.workspaces,
// D.tier, D.workspace) — same source the rest of the SPA uses. Render
// null gracefully when there's nothing to show, so AdsScreen can mount
// them unconditionally.
//
// Loaded as <script type="text/babel" src="js/ads-intel/ads-panels.js"></script>.
// Depends on the global Plat, Pill, Card, Btn, Icon, SectionHead, cls,
// platformLabel from index.html + js/core/data.js.
// ═════════════════════════════════════════════════════════════════════════

// Open Settings on the Ad Intelligence anchor. The existing
// pulse:gotoSettings event already exists in index.html for accounts/
// workspaces anchors; we add a new anchor name 'ad-intel' that
// SettingsScreen maps to id="settings-ad-intel".
const gotoAdIntelSettings = () =>
  window.dispatchEvent(new CustomEvent('pulse:gotoSettings', { detail: { anchor: 'ad-intel' } }));

// ── 1) Benchmark comparison panel ────────────────────────────────────────
const AdsIntelComparePanel = () => {
  const intel = window.D?.ads_intel;
  if (!intel?.platform_intel?.length) return null;

  return (
    <div className="mt-5 sm:mt-7">
      <SectionHead
        eyebrow="Benchmark comparison"
        title="How your spots compare"
        sub={`${(intel.category || '').replace(/_/g, ' ')} · ${(intel.region || '').replace(/_/g, ' ')} · Goal: ${intel.goal || 'not set'}`}
      />
      <Card>
        <div className="grid grid-cols-[1fr_80px_110px_100px] gap-3 text-[10px] font-mono uppercase tracking-[0.12em] text-mute dark:text-muteDark py-2 border-b border-line dark:border-lineDark mb-1">
          <span>Platform</span>
          <span className="text-right">Your CTR</span>
          <span className="text-right">Benchmark</span>
          <span className="text-right">Spot Score</span>
        </div>
        {intel.platform_intel.map(p => {
          const score = p.spot_score;
          const tone =
            score == null ? 'text-mute dark:text-muteDark' :
            score >= 70 ? 'text-emerald-600 dark:text-lime' :
            score >= 40 ? 'text-amber' :
            'text-magenta';
          const dots = score == null ? 0 : Math.max(0, Math.min(5, Math.round(score / 20)));
          return (
            <div key={p.platform} className="grid grid-cols-[1fr_80px_110px_100px] gap-3 py-2.5 items-center border-b border-line/50 dark:border-lineDark/50 last:border-0">
              <div className="flex items-center gap-2 min-w-0">
                <Plat p={p.platform} className="w-4 h-4 flex-shrink-0" />
                <span className="text-[13px] capitalize truncate">{p.platform}</span>
              </div>
              <span className="text-right font-mono text-[12.5px]">{p.ctr}%</span>
              <span className="text-right font-mono text-[12px] text-mute dark:text-muteDark">
                avg {p.benchmark?.avg_ctr ?? '—'}%
              </span>
              <div className="flex items-center justify-end gap-1.5">
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className={cls(
                      'w-2 h-2 rounded-full',
                      i <= dots ? 'bg-ultra dark:bg-lime' : 'bg-line dark:bg-lineDark'
                    )} />
                  ))}
                </div>
                <span className={cls('text-[11px] font-mono', tone)}>
                  {score != null ? `${score}/100` : '—'}
                </span>
              </div>
            </div>
          );
        })}
        <div className="pt-2 text-[11px] text-mute dark:text-muteDark font-mono">
          {intel.data_quality === 'network'
            ? 'Benchmarks from Mashal network data · anonymised cross-advertiser'
            : 'Benchmarks from published industry data · network data accumulates over time'}
        </div>
      </Card>
    </div>
  );
};

// ── 2) Recommended spots panel ───────────────────────────────────────────
const AdsIntelRecommendations = () => {
  const intel = window.D?.ads_intel;
  const adSettings = window.D?.adSettings;

  // Configured but no recs — render nothing (the compare panel covers it).
  if (intel?.recommendations?.length) {
    return (
      <div className="mt-5 sm:mt-7">
        <SectionHead eyebrow="Ad spot intelligence" title="Recommended spots" />
        <Card className="divide-y divide-line/50 dark:divide-lineDark/50 !p-0">
          {intel.recommendations.map((rec, i) => (
            <div key={i} className="flex gap-3 p-4 sm:p-5">
              <div className={cls(
                'flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-mono font-bold mt-0.5',
                rec.priority === 'high'
                  ? 'bg-ultra/15 text-ultra dark:text-limeDeep'
                  : 'bg-line/60 dark:bg-lineDark text-mute dark:text-muteDark'
              )}>{i + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <div className="flex items-center gap-1.5">
                    <Plat p={rec.platform} className="w-3.5 h-3.5" />
                    <span className="text-[13px] font-semibold capitalize">{rec.platform}</span>
                    {rec.format && (
                      <span className="text-[11px] font-mono text-mute dark:text-muteDark capitalize">
                        {rec.format.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  {rec.priority === 'high' && <Pill color="ultraSoft">Priority</Pill>}
                  {rec.locked && (
                    <Pill color="ink">🔒 {rec.lockReason || 'Locked'}</Pill>
                  )}
                </div>
                <p className="text-[13px] text-mute dark:text-muteDark leading-relaxed">
                  {rec.reason}
                </p>
              </div>
            </div>
          ))}
        </Card>
      </div>
    );
  }

  // Not configured yet — surface the setup CTA. Only show when ads exist
  // (otherwise the parent "No ad data yet" empty state already covers it).
  if (window.D?.ads && !adSettings?.category) {
    return (
      <div className="mt-5 sm:mt-7">
        <Card className="!p-5 text-center">
          <div className="text-[13px] text-mute dark:text-muteDark mb-3">
            Set your ad goal and category to unlock spot-score benchmarks and recommendations.
          </div>
          <Btn variant="ghost" onClick={gotoAdIntelSettings}>
            Set up Ad Intelligence →
          </Btn>
        </Card>
      </div>
    );
  }

  return null;
};

// ── 3) Agency per-client workspace switcher ──────────────────────────────
const AdsIntelAgencySwitcher = () => {
  const tierKey = (window.D?.tier?.key || 'creator').toLowerCase();
  const workspaces = window.D?.workspaces || [];
  const activeId = window.D?.activeWorkspaceId;
  if (tierKey !== 'agency' || workspaces.length < 2) return null;

  return (
    <div className="mb-5 overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
      <div className="flex gap-2 min-w-max pb-1">
        {workspaces.map(w => {
          const isActive = w.id === activeId;
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => !isActive && window.switchWorkspace?.(w.id)}
              className={cls(
                'flex items-center gap-2 h-8 px-3 rounded-xl border text-[12.5px] font-medium whitespace-nowrap transition',
                isActive
                  ? 'bg-ink text-paper dark:bg-lime dark:text-ink border-transparent'
                  : 'bg-chalk dark:bg-coalsoft border-line dark:border-lineDark text-mute dark:text-muteDark hover:border-ultra/40'
              )}
            >
              {w.name || 'Unnamed'}
              {isActive && <span className="w-1.5 h-1.5 rounded-full bg-paper dark:bg-ink opacity-60" />}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ── 4) Context chips (rendered in AdsScreen header sub) ──────────────────
const AdsIntelContextChips = () => {
  const ad = window.D?.adSettings;
  if (!ad?.goal && !ad?.category) return null;
  const chip = (label, key) => (
    <button
      key={key}
      type="button"
      onClick={gotoAdIntelSettings}
      className={cls(
        'inline-flex items-center gap-1 px-2 h-5 rounded-full text-[10px] font-mono transition capitalize',
        key === 'goal'
          ? 'bg-ultra/10 text-ultra dark:text-lime hover:bg-ultra/20'
          : 'bg-line/60 dark:bg-lineDark text-mute dark:text-muteDark hover:bg-line dark:hover:bg-lineDark/80'
      )}
    >
      {label}
    </button>
  );
  return (
    <span className="inline-flex items-center gap-2 flex-wrap ml-2">
      {ad.goal && chip(ad.goal, 'goal')}
      {ad.category && chip(ad.category.replace(/_/g, ' '), 'category')}
    </span>
  );
};

Object.assign(window, {
  AdsIntel: Object.assign(window.AdsIntel || {}, {
    ComparePanel:    AdsIntelComparePanel,
    Recommendations: AdsIntelRecommendations,
    AgencySwitcher:  AdsIntelAgencySwitcher,
    ContextChips:    AdsIntelContextChips,
  }),
});
