// ═════════════════════════════════════════════════════════════════════════
// src/spa/utilities.jsx — extracted from index.html's leading inline
// <script type="text/babel"> blocks (everything BEFORE the external js/
// src= tags). Defines: PlatformIcons, Icon, COUNTRIES, REGIONS, cls(),
// safeHref(), Card, Btn, Eyebrow, Plat, Sparkline, BarSpark, Pill,
// MashalDot, Progress, StatCard, SectionHead, MashalLogo, tweaks panel,
// and the entire Landing/marketing-tree component family.
//
// Loaded BEFORE the js/ feature files (auth.jsx, api.jsx, billing/*, etc.)
// because those files reference Card / Btn / Icon / cls etc. bare-name.
//
// Provenance: scripts/extract-spa-blocks.mjs — regenerate after any inline
// block edits in index.html (which itself will be empty of babel scripts
// once step 3 lands).
// ═════════════════════════════════════════════════════════════════════════

import React from 'react';

// ═════════════════════════════════════════════════════════════════════════
// Extracted from index.html lines 490-594
// ═════════════════════════════════════════════════════════════════════════
// Mashal Icons — Platform SVGs (real) + thin-stroke utility icons
const PlatformIcons = () => (
  <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
    <defs>
      {/* Instagram gradient */}
      <linearGradient id="igg" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#feda75" />
        <stop offset="25%" stopColor="#fa7e1e" />
        <stop offset="50%" stopColor="#d62976" />
        <stop offset="75%" stopColor="#962fbf" />
        <stop offset="100%" stopColor="#4f5bd5" />
      </linearGradient>
    </defs>
    <symbol id="ic-ig" viewBox="0 0 24 24">
      <rect width="20" height="20" x="2" y="2" rx="6" fill="url(#igg)" />
      <circle cx="12" cy="12" r="4.5" fill="none" stroke="white" strokeWidth="1.6" />
      <circle cx="17" cy="7" r="1.2" fill="white" />
    </symbol>
    <symbol id="ic-tt" viewBox="0 0 24 24">
      <rect width="24" height="24" rx="6" fill="#010101" />
      <path d="M16.6 5.8A4.3 4.3 0 0 1 14.3 3h-2.4v12.4a2.1 2.1 0 0 1-2.1 1.8 2.1 2.1 0 0 1-2.1-2.1 2.1 2.1 0 0 1 2.1-2.1c.2 0 .4 0 .6.1v-2.4a4.5 4.5 0 0 0-.6 0A4.5 4.5 0 0 0 5.3 15.1a4.5 4.5 0 0 0 4.5 4.5 4.5 4.5 0 0 0 4.5-4.5V9.3a6.7 6.7 0 0 0 3.9 1.2V8.1A4.3 4.3 0 0 1 16.6 5.8z" fill="white" />
    </symbol>
    <symbol id="ic-yt" viewBox="0 0 24 24">
      <rect width="24" height="24" rx="5" fill="#FF0000" />
      <polygon points="10,8.5 10,15.5 16,12" fill="white" />
    </symbol>
    <symbol id="ic-li" viewBox="0 0 24 24">
      <rect width="24" height="24" rx="5" fill="#0A66C2" />
      <path d="M7.5 10h2v7h-2zM8.5 9a1.1 1.1 0 1 1 0-2.2A1.1 1.1 0 0 1 8.5 9zM11 10h1.9v1s.6-1.1 2.1-1.1c1.6 0 2.5 1 2.5 2.9V17h-2v-3.7c0-.9-.3-1.5-1.1-1.5-.8 0-1.4.6-1.4 1.6V17H11V10z" fill="white" />
    </symbol>
    <symbol id="ic-fb" viewBox="0 0 24 24">
      <rect width="24" height="24" rx="5" fill="#1877F2" />
      <path d="M13.5 19.5v-7h2.3l.3-2.7h-2.6V8c0-.8.2-1.3 1.3-1.3h1.4V4.4c-.2 0-1-.1-2-.1-2 0-3.3 1.2-3.3 3.4v1.9H8.6v2.7h2.3v7h2.6z" fill="white" />
    </symbol>
    <symbol id="ic-x" viewBox="0 0 24 24">
      <rect width="24" height="24" rx="5" fill="#0A0A0B" />
      <path d="M16.5 5h2.4l-5.2 6 6.1 8h-4.8l-3.8-4.9L6.8 19H4.4l5.5-6.3L4 5h4.9l3.4 4.5L16.5 5zm-.85 12.5h1.34L8.4 6.4H7L15.65 17.5z" fill="white" />
    </symbol>
    <symbol id="ic-sc" viewBox="0 0 24 24">
      <rect width="24" height="24" rx="5" fill="#FFFC00" />
      <path d="M12 4.5c2.4 0 4.4 1.8 4.6 4.2.1 1 0 2-.1 3 .1.1.3.1.4.1.4 0 .6-.2 1-.4.2-.1.3-.1.5-.1.4 0 .9.3.9.7 0 .4-.4.7-1.3 1-.4.2-.7.3-.9.5 0 .3.5 1.4 1.4 2.4.5.5 1.2 1.1 2.1 1.5.1.1.2.2.2.3 0 .3-.5.7-1.5 1-.1 0-.1.1-.2.2 0 .1-.1.4-.1.5-.1.2-.2.3-.4.3-.1 0-.2 0-.4-.1-.3 0-.6-.1-1-.1-.3 0-.6 0-.9.1-.5.1-1 .5-1.5.8-.7.5-1.4 1-2.5 1h-.4c-1.1 0-1.8-.5-2.5-1-.5-.4-1-.7-1.5-.8-.3-.1-.6-.1-.9-.1-.4 0-.7.1-1 .1-.1.1-.3.1-.4.1-.2 0-.3-.1-.4-.3-.1-.2-.1-.4-.1-.5-.1-.1-.1-.2-.2-.2-1-.3-1.5-.7-1.5-1 0-.1.1-.2.2-.3.9-.5 1.6-1 2.1-1.5.9-1 1.4-2.1 1.4-2.4-.2-.2-.5-.4-.9-.5C5.8 11 5.5 10.7 5.5 10.3c0-.4.5-.7.9-.7.2 0 .3 0 .5.1.4.2.6.4 1 .4.2 0 .3 0 .4-.1-.1-1-.2-2-.1-3C8.2 6.3 9.6 4.5 12 4.5z" fill="#0A0A0B" />
    </symbol>
  </svg>
);

// Thin stroke icon set
const Icon = ({ name, className = 'w-4 h-4', stroke = 1.5 }) => {
  const props = { width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
    arrowUpRight: <path d="M7 17 17 7M9 7h8v8" />,
    arrowDownRight: <path d="M7 7 17 17M17 9v8H9" />,
    chevDown: <path d="m6 9 6 6 6-6" />,
    chevRight: <path d="m9 6 6 6-6 6" />,
    check: <path d="M5 13l4 4L19 7" />,
    x: <path d="M6 6l12 12M18 6 6 18" />,
    refresh: <><path d="M1 4v6h6" /><path d="M23 20v-6h-6" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    bell: <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21a2 2 0 0 0 4 0" />,
    sparkle: <><path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.5 5.5l3.5 3.5M15 15l3.5 3.5M5.5 18.5 9 15M15 9l3.5-3.5" /></>,
    brain: <path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 3 3 3 0 0 0 2 3v1a3 3 0 0 0 3 3 3 3 0 0 0 3 3V4a3 3 0 0 0-3 0zm6 0a3 3 0 0 1 3 3v1a3 3 0 0 1 2 3 3 3 0 0 1-2 3v1a3 3 0 0 1-3 3 3 3 0 0 1-3 3V4a3 3 0 0 1 3 0z" />,
    flame: <path d="M12 2c1 4-3 5-3 9a3 3 0 0 0 6 0c0-1-1-2-1-3 3 1 5 4 5 7a7 7 0 0 1-14 0c0-5 5-7 7-13z" />,
    bolt: <path d="m13 2-9 12h7l-2 8 9-12h-7z" />,
    target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
    trending: <path d="M3 17 9 11l4 4 8-8M14 5h7v7" />,
    pulse: <path d="M3 12h4l2-6 4 12 2-6h6" />,
    eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
    heart: <path d="M12 21s-7-4.5-9.5-9.5C.5 7 4 3 7.5 3c2 0 3.5 1 4.5 2.5C13 4 14.5 3 16.5 3 20 3 23.5 7 21.5 11.5 19 16.5 12 21 12 21z" />,
    message: <path d="M21 12c0 4.5-4 8-9 8-1.5 0-3-.3-4-.8L3 21l1.8-5C4.3 15 4 13.5 4 12c0-4.5 4-8 8.5-8S21 7.5 21 12z" />,
    share: <><circle cx="6" cy="12" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="M8.6 10.5 15.4 7.5M8.6 13.5l6.8 3" /></>,
    bookmark: <path d="M6 4h12v17l-6-3-6 3z" />,
    filter: <path d="M3 5h18M6 12h12M10 19h4" />,
    download: <path d="M12 4v12m0 0-4-4m4 4 4-4M4 20h16" />,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15-.3.5a1.7 1.7 0 0 0 .3 2l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2-.3 1.7 1.7 0 0 0-1 1.5V22a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-2 .3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-2A1.7 1.7 0 0 0 2.1 14H2a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-2l-.1-.1A2 2 0 1 1 6 4.1l.1.1a1.7 1.7 0 0 0 2 .3H8a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 2-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 2v0a1.7 1.7 0 0 0 1.5 1H22a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4 12H2m20 0h-2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></>,
    moon: <path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    layers: <path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5M3 18l9 5 9-5" />,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    users: <><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a6 6 0 0 0-4-5.7" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
    lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
    google: <><path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4c-.2 1.3-1 2.4-2.1 3.2v2.6h3.4c2-1.8 3-4.5 3-7.6z" fill="#4285F4" stroke="none" /><path d="M12 22c2.7 0 5-.9 6.7-2.4l-3.4-2.6c-.9.6-2 1-3.3 1-2.6 0-4.7-1.7-5.5-4H3v2.5A10 10 0 0 0 12 22z" fill="#34A853" stroke="none" /><path d="M6.5 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.5H3a10 10 0 0 0 0 9z" fill="#FBBC04" stroke="none" /><path d="M12 6c1.5 0 2.8.5 3.8 1.5L18.8 4A10 10 0 0 0 3 7.5L6.5 10c.8-2.3 2.9-4 5.5-4z" fill="#EA4335" stroke="none" /></>,
    github: <path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-2c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 0 1.6 1 1.6 1 .9 1.5 2.3 1.1 2.9.8.1-.6.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.8v2.6c0 .3.2.6.7.5A10 10 0 0 0 12 2z" fill="currentColor" />,
    apple: <path d="M16.4 12.7c0-2.4 2-3.6 2.1-3.6-1.1-1.7-2.9-1.9-3.5-2-1.5-.1-2.9.9-3.7.9s-1.9-.9-3.2-.9c-1.6 0-3.2 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.6-.8 1-1.6 1.3-2.4-2.2-.9-2.6-3.9-.4-4.2zM14 5.9c.7-.8 1.1-2 1-3.2-1 0-2.2.7-2.9 1.5-.7.7-1.2 1.9-1.1 3.1 1.1.1 2.3-.6 3-1.4z" fill="currentColor" />,
    logo: <><circle cx="12" cy="12" r="2" /><circle cx="12" cy="12" r="6" opacity=".5" /><circle cx="12" cy="12" r="10" opacity=".2" /></>,
    play: <polygon points="6 4 20 12 6 20" />,
    folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
    headphones: <path d="M3 18v-6a9 9 0 0 1 18 0v6m0 0a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zm-18 0a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />,
    rocket: <path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.8-.8.8-2.2 0-3s-2.2-.8-3 0zM12 15 9 12a11 11 0 0 1 3-7c5-5 11-5 11-5s0 6-5 11a11 11 0 0 1-7 3zM15 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" /></>,
    menu: <path d="M3 6h18M3 12h18M3 18h18" />,
    quote: <path d="M3 11c0-4 2-7 6-8v3c-2 .5-3 2-3 4h3v6H3zm10 0c0-4 2-7 6-8v3c-2 .5-3 2-3 4h3v6h-6z" />,
  };
  return <svg {...props} className={className}>{paths[name]}</svg>;
};

Object.assign(window, { PlatformIcons, Icon });


// ═════════════════════════════════════════════════════════════════════════
// Extracted from index.html lines 595-658
// ═════════════════════════════════════════════════════════════════════════

// Canonical lookup tables shared by Onboarding + Settings.
// Each entry is [id, label] — id is what gets persisted, label is what's shown.
// Add to these lists in one place and both flows update automatically.

const CATEGORIES = [
  ['music', 'Music / Culture'],
  ['ecommerce', 'Ecommerce / Retail'],
  ['food', 'Food & Beverage'],
  ['fashion', 'Fashion & Beauty'],
  ['tech', 'Tech / SaaS'],
  ['realestate', 'Real Estate'],
  ['education', 'Education'],
  ['health', 'Health & Wellness'],
  ['finance', 'Finance & Business'],
  ['entertainment', 'Entertainment'],
  ['other', 'Other'],
];

const COUNTRIES = [
  ['GLOBAL', '🌍 Global / Multi-region'],
  ['CA', 'Canada'], ['US', 'United States'], ['GB', 'United Kingdom'],
  ['SA', 'Saudi Arabia'], ['AE', 'United Arab Emirates'], ['KW', 'Kuwait'],
  ['QA', 'Qatar'], ['BH', 'Bahrain'], ['OM', 'Oman'],
  ['EG', 'Egypt'], ['JO', 'Jordan'], ['LB', 'Lebanon'], ['IL', 'Israel'], ['TR', 'Turkey'],
  ['PK', 'Pakistan'], ['IN', 'India'], ['BD', 'Bangladesh'], ['LK', 'Sri Lanka'],
  ['ID', 'Indonesia'], ['MY', 'Malaysia'], ['SG', 'Singapore'], ['PH', 'Philippines'],
  ['TH', 'Thailand'], ['VN', 'Vietnam'],
  ['JP', 'Japan'], ['KR', 'South Korea'], ['CN', 'China'], ['HK', 'Hong Kong'], ['TW', 'Taiwan'],
  ['AU', 'Australia'], ['NZ', 'New Zealand'],
  ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'],
  ['NL', 'Netherlands'], ['BE', 'Belgium'], ['CH', 'Switzerland'], ['AT', 'Austria'],
  ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'], ['FI', 'Finland'], ['IE', 'Ireland'],
  ['PL', 'Poland'], ['PT', 'Portugal'], ['GR', 'Greece'],
  ['MX', 'Mexico'], ['BR', 'Brazil'], ['AR', 'Argentina'], ['CL', 'Chile'],
  ['CO', 'Colombia'], ['PE', 'Peru'],
  ['ZA', 'South Africa'], ['NG', 'Nigeria'], ['KE', 'Kenya'], ['GH', 'Ghana'],
  ['MA', 'Morocco'], ['TN', 'Tunisia'], ['DZ', 'Algeria'],
];

const REGION_PRESETS = [
  ['gcc', 'GCC (Gulf states)'],
  ['mena', 'MENA'],
  ['north-america', 'North America'],
  ['eu', 'European Union'],
  ['uk-ireland', 'UK & Ireland'],
  ['nordics', 'Nordic countries'],
  ['apac', 'Asia-Pacific'],
  ['south-asia', 'South Asia'],
  ['southeast-asia', 'Southeast Asia'],
  ['latam', 'Latin America'],
  ['africa', 'Africa'],
];

// Build a focus-regions multi-select: presets first (chips), then a separate
// section for individual countries (chips again, ordered same as COUNTRIES).
const ALL_FOCUS_OPTIONS = [...REGION_PRESETS, ...COUNTRIES.filter(([id]) => id !== 'GLOBAL')];

const labelFor = (list, id) => list.find(([k]) => k === id)?.[1] || id;

Object.assign(window, { CATEGORIES, COUNTRIES, REGION_PRESETS, ALL_FOCUS_OPTIONS, labelFor });


// ═════════════════════════════════════════════════════════════════════════
// Extracted from index.html lines 659-816
// ═════════════════════════════════════════════════════════════════════════
// Mashal UI primitives

const cls = (...a) => a.filter(Boolean).join(' ');

// SECURITY (audit, May 2026): scraped permalinks (from Apify, the Meta
// Ad Library scrape, etc.) are competitor-controlled — a competitor who
// puts `javascript:fetch(...)` in their bio "url" field would otherwise
// land that string in <a href={p.permalink}>, and React 18 doesn't
// block javascript: URLs (only warns). safeHref returns null for any
// non-https URL (or http to localhost in dev) so <a href={null}> simply
// renders without a clickable href.
const safeHref = (url) => {
  if (!url || typeof url !== 'string') return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol === 'https:') return url;
  // Allow http: only for localhost dev origin. Everything else (javascript:,
  // data:, file:, ftp:, vbscript:, etc.) is refused.
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return url;
  return null;
};

// Card wrapper — bordered, paper
const Card = ({ children, className = '', as: As = 'div', ...rest }) => (
  <As className={cls('card bg-chalk dark:bg-coalsoft border border-line dark:border-lineDark rounded-2xl p-5', className)} {...rest}>
    {children}
  </As>
);

// Primary button
const Btn = ({ children, variant = 'ink', size = 'md', className = '', as: As = 'button', ...rest }) => {
  const sizes = { sm: 'h-9 px-3.5 text-[13px]', md: 'h-11 px-5 text-sm', lg: 'h-12 px-6 text-[15px]' };
  const variants = {
    ink: 'bg-ink text-paper hover:bg-coal dark:bg-paper dark:text-ink dark:hover:bg-chalk',
    lime: 'bg-lime text-ink hover:bg-limeDeep',
    ultra: 'bg-ultra text-paper hover:brightness-110',
    ghost: 'bg-transparent text-ink dark:text-paper hover:bg-ink/5 dark:hover:bg-paper/5',
    outline: 'bg-transparent border border-ink/15 dark:border-paper/15 text-ink dark:text-paper hover:border-ink/40 dark:hover:border-paper/40',
    magenta: 'bg-magenta text-white hover:brightness-110'
  };
  return (
    <As className={cls('inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all', sizes[size], variants[variant], className)} {...rest}>
      {children}
    </As>
  );
};

// Eyebrow label — bold caps, mono
const Eyebrow = ({ children, color = 'text-ultra', className = '' }) => (
  <span className={cls('font-mono text-[10px] uppercase tracking-[0.18em] font-medium', color, className)}>{children}</span>
);

// Platform icon ref
const Plat = ({ p, className = 'w-5 h-5' }) => (
  <svg className={className}><use href={`#ic-${p}`} /></svg>
);

// Sparkline
const Sparkline = ({ data, color = 'currentColor', width = 90, height = 32 }) => {
  if (!data?.length) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline className="spark-line" points={pts} stroke={color} />
    </svg>
  );
};

// Bar sparkline (stat card variant)
const BarSpark = ({ data, color = '#6B5BFF', highlightIdx = -1, height = 28 }) => {
  const max = Math.max(...data) || 1;
  return (
    <div className="flex items-end gap-0.5" style={{ height }}>
      {data.map((v, i) => (
        <div key={i}
          className="flex-1 rounded-sm transition-all"
          style={{ height: `${(v / max) * 100}%`, background: i === highlightIdx ? color : `${color}33`, minHeight: 2 }} />
      ))}
    </div>
  );
};

// Pill badge
const Pill = ({ children, color = 'ink', className = '' }) => {
  const colors = {
    ink: 'bg-ink/8 text-ink dark:bg-paper/10 dark:text-paper',
    lime: 'bg-lime text-ink',
    magenta: 'bg-magenta text-white',
    magentaSoft: 'bg-magentaSoft text-magenta dark:bg-magenta/20 dark:text-magenta',
    ultra: 'bg-ultra text-white',
    ultraSoft: 'bg-ultraSoft text-ultra dark:bg-ultra/20 dark:text-ultra',
    paper: 'bg-paper text-ink dark:bg-paper/10 dark:text-paper',
    amber: 'bg-amber/20 text-amber'
  };
  return <span className={cls('inline-flex items-center gap-1.5 px-2.5 h-6 rounded-full text-[11px] font-medium tracking-tight whitespace-nowrap', colors[color], className)}>{children}</span>;
};

// Mashal live dot
const MashalDot = ({ color = 'bg-magenta', size = 'w-2 h-2' }) => (
  <span className={cls('relative inline-block rounded-full pulse-dot', size, color)} style={{ color: undefined }} />
);

// Progress bar
const Progress = ({ value, max = 100, color = 'bg-ultra', height = 'h-1.5', animate = true }) => {
  const [w, setW] = React.useState(0);
  React.useEffect(() => { const t = setTimeout(() => setW((value / max) * 100), 100); return () => clearTimeout(t); }, [value, max]);
  return (
    <div className={cls('w-full rounded-full bg-ink/8 dark:bg-paper/10 overflow-hidden', height)}>
      <div className={cls('h-full rounded-full transition-all duration-[1200ms] ease-out', color)} style={{ width: `${animate ? w : (value / max) * 100}%` }} />
    </div>
  );
};

// Stat card — label, value, delta, sparkline
const StatCard = ({ label, value, delta, deltaPositive = true, sparkData, color = '#6B5BFF', icon }) => (
  <div className="stat-card card bg-chalk dark:bg-coalsoft border border-line dark:border-lineDark rounded-2xl p-5 hover:border-ink/20 dark:hover:border-paper/20 transition-all">
    <div className="flex items-start justify-between mb-3">
      <div className="flex items-center gap-2">
        {icon && <div className="w-7 h-7 rounded-lg bg-ink/5 dark:bg-paper/5 flex items-center justify-center"><Icon name={icon} className="w-3.5 h-3.5" /></div>}
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-mute dark:text-muteDark">{label}</span>
      </div>
      {delta !== undefined && (
        <span className={cls('font-mono text-[11px] flex items-center gap-0.5', deltaPositive ? 'text-emerald-600 dark:text-lime' : 'text-magenta')}>
          {deltaPositive ? '↑' : '↓'} {Math.abs(delta)}%
        </span>
      )}
    </div>
    <div className="font-display text-[34px] leading-none font-semibold tracking-tighter mb-3">{value}</div>
    {sparkData && <BarSpark data={sparkData} color={color} highlightIdx={sparkData.length - 2} />}
  </div>
);

// Section header
const SectionHead = ({ eyebrow, title, sub, right, className = '' }) => (
  <div className={cls('flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5', className)}>
    <div>
      {eyebrow && <div className="mb-2"><Eyebrow>{eyebrow}</Eyebrow></div>}
      <h2 className="font-display text-[22px] sm:text-[26px] leading-none font-semibold tracking-tighter">{title}</h2>
      {sub && <p className="text-[13px] text-mute dark:text-muteDark mt-1.5 max-w-md">{sub}</p>}
    </div>
    {right}
  </div>
);

// Logo
const MashalLogo = ({ className = 'h-7' }) => (
  <div className={cls('inline-flex items-center gap-2', className)}>
    <img src="/images/mashal-logo.png" alt="" className="h-full w-auto" />
    <span className="font-display text-[20px] font-bold tracking-tightest">Mashal<span className="text-magenta">.</span></span>
  </div>
);

Object.assign(window, { cls, Card, Btn, Eyebrow, Plat, Sparkline, BarSpark, Pill, MashalDot, Progress, StatCard, SectionHead, MashalLogo });


// ═════════════════════════════════════════════════════════════════════════
// Extracted from index.html lines 817-1387
// ═════════════════════════════════════════════════════════════════════════

// tweaks-panel.jsx
// Reusable Tweaks shell + form-control helpers.
//
// Owns the host protocol (listens for __activate_edit_mode / __deactivate_edit_mode,
// posts __edit_mode_available / __edit_mode_set_keys / __edit_mode_dismissed) so
// individual prototypes don't re-roll it. Ships a consistent set of controls so you
// don't hand-draw <input type="range">, segmented radios, steppers, etc.
//
// Usage (in an HTML file that loads React + Babel):
//
//   const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
//     "primaryColor": "#D97757",
//     "palette": ["#D97757", "#29261b", "#f6f4ef"],
//     "fontSize": 16,
//     "density": "regular",
//     "dark": false
//   }/*EDITMODE-END*/;
//
//   function App() {
//     const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
//     return (
//       <div style={{ fontSize: t.fontSize, color: t.primaryColor }}>
//         Hello
//         <TweaksPanel>
//           <TweakSection label="Typography" />
//           <TweakSlider label="Font size" value={t.fontSize} min={10} max={32} unit="px"
//                        onChange={(v) => setTweak('fontSize', v)} />
//           <TweakRadio  label="Density" value={t.density}
//                        options={['compact', 'regular', 'comfy']}
//                        onChange={(v) => setTweak('density', v)} />
//           <TweakSection label="Theme" />
//           <TweakColor  label="Primary" value={t.primaryColor}
//                        options={['#D97757', '#2A6FDB', '#1F8A5B', '#7A5AE0']}
//                        onChange={(v) => setTweak('primaryColor', v)} />
//           <TweakColor  label="Palette" value={t.palette}
//                        options={[['#D97757', '#29261b', '#f6f4ef'],
//                                  ['#475569', '#0f172a', '#f1f5f9']]}
//                        onChange={(v) => setTweak('palette', v)} />
//           <TweakToggle label="Dark mode" value={t.dark}
//                        onChange={(v) => setTweak('dark', v)} />
//         </TweaksPanel>
//       </div>
//     );
//   }
//
// ─────────────────────────────────────────────────────────────────────────────

const __TWEAKS_STYLE = `
  .twk-panel{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:280px;
    max-height:calc(100vh - 32px);display:flex;flex-direction:column;
    transform:scale(var(--dc-inv-zoom,1));transform-origin:bottom right;
    background:rgba(250,249,247,.78);color:#29261b;
    -webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);
    border:.5px solid rgba(255,255,255,.6);border-radius:14px;
    box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 12px 40px rgba(0,0,0,.18);
    font:11.5px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden}
  .twk-hd{display:flex;align-items:center;justify-content:space-between;
    padding:10px 8px 10px 14px;cursor:move;user-select:none}
  .twk-hd b{font-size:12px;font-weight:600;letter-spacing:.01em}
  .twk-x{appearance:none;border:0;background:transparent;color:rgba(41,38,27,.55);
    width:22px;height:22px;border-radius:6px;cursor:default;font-size:13px;line-height:1}
  .twk-x:hover{background:rgba(0,0,0,.06);color:#29261b}
  .twk-body{padding:2px 14px 14px;display:flex;flex-direction:column;gap:10px;
    overflow-y:auto;overflow-x:hidden;min-height:0;
    scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.15) transparent}
  .twk-body::-webkit-scrollbar{width:8px}
  .twk-body::-webkit-scrollbar-track{background:transparent;margin:2px}
  .twk-body::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:4px;
    border:2px solid transparent;background-clip:content-box}
  .twk-body::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.25);
    border:2px solid transparent;background-clip:content-box}
  .twk-row{display:flex;flex-direction:column;gap:5px}
  .twk-row-h{flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
  .twk-lbl{display:flex;justify-content:space-between;align-items:baseline;
    color:rgba(41,38,27,.72)}
  .twk-lbl>span:first-child{font-weight:500}
  .twk-val{color:rgba(41,38,27,.5);font-variant-numeric:tabular-nums}

  .twk-sect{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:rgba(41,38,27,.45);padding:10px 0 0}
  .twk-sect:first-child{padding-top:0}

  .twk-field{appearance:none;width:100%;height:26px;padding:0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;
    background:rgba(255,255,255,.6);color:inherit;font:inherit;outline:none}
  .twk-field:focus{border-color:rgba(0,0,0,.25);background:rgba(255,255,255,.85)}
  select.twk-field{padding-right:22px;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.5)' d='M0 0h10L5 6z'/></svg>");
    background-repeat:no-repeat;background-position:right 8px center}

  .twk-slider{appearance:none;-webkit-appearance:none;width:100%;height:4px;margin:6px 0;
    border-radius:999px;background:rgba(0,0,0,.12);outline:none}
  .twk-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;
    width:14px;height:14px;border-radius:50%;background:#fff;
    border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}
  .twk-slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;
    background:#fff;border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}

  .twk-seg{position:relative;display:flex;padding:2px;border-radius:8px;
    background:rgba(0,0,0,.06);user-select:none}
  .twk-seg-thumb{position:absolute;top:2px;bottom:2px;border-radius:6px;
    background:rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(0,0,0,.12);
    transition:left .15s cubic-bezier(.3,.7,.4,1),width .15s}
  .twk-seg.dragging .twk-seg-thumb{transition:none}
  .twk-seg button{appearance:none;position:relative;z-index:1;flex:1;border:0;
    background:transparent;color:inherit;font:inherit;font-weight:500;min-height:22px;
    border-radius:6px;cursor:default;padding:4px 6px;line-height:1.2;
    overflow-wrap:anywhere}

  .twk-toggle{position:relative;width:32px;height:18px;border:0;border-radius:999px;
    background:rgba(0,0,0,.15);transition:background .15s;cursor:default;padding:0}
  .twk-toggle[data-on="1"]{background:#34c759}
  .twk-toggle i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
  .twk-toggle[data-on="1"] i{transform:translateX(14px)}

  .twk-num{display:flex;align-items:center;height:26px;padding:0 0 0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;background:rgba(255,255,255,.6)}
  .twk-num-lbl{font-weight:500;color:rgba(41,38,27,.6);cursor:ew-resize;
    user-select:none;padding-right:8px}
  .twk-num input{flex:1;min-width:0;height:100%;border:0;background:transparent;
    font:inherit;font-variant-numeric:tabular-nums;text-align:right;padding:0 8px 0 0;
    outline:none;color:inherit;-moz-appearance:textfield}
  .twk-num input::-webkit-inner-spin-button,.twk-num input::-webkit-outer-spin-button{
    -webkit-appearance:none;margin:0}
  .twk-num-unit{padding-right:8px;color:rgba(41,38,27,.45)}

  .twk-btn{appearance:none;height:26px;padding:0 12px;border:0;border-radius:7px;
    background:rgba(0,0,0,.78);color:#fff;font:inherit;font-weight:500;cursor:default}
  .twk-btn:hover{background:rgba(0,0,0,.88)}
  .twk-btn.secondary{background:rgba(0,0,0,.06);color:inherit}
  .twk-btn.secondary:hover{background:rgba(0,0,0,.1)}

  .twk-swatch{appearance:none;-webkit-appearance:none;width:56px;height:22px;
    border:.5px solid rgba(0,0,0,.1);border-radius:6px;padding:0;cursor:default;
    background:transparent;flex-shrink:0}
  .twk-swatch::-webkit-color-swatch-wrapper{padding:0}
  .twk-swatch::-webkit-color-swatch{border:0;border-radius:5.5px}
  .twk-swatch::-moz-color-swatch{border:0;border-radius:5.5px}

  .twk-chips{display:flex;gap:6px}
  .twk-chip{position:relative;appearance:none;flex:1;min-width:0;height:46px;
    padding:0;border:0;border-radius:6px;overflow:hidden;cursor:default;
    box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.06);
    transition:transform .12s cubic-bezier(.3,.7,.4,1),box-shadow .12s}
  .twk-chip:hover{transform:translateY(-1px);
    box-shadow:0 0 0 .5px rgba(0,0,0,.18),0 4px 10px rgba(0,0,0,.12)}
  .twk-chip[data-on="1"]{box-shadow:0 0 0 1.5px rgba(0,0,0,.85),
    0 2px 6px rgba(0,0,0,.15)}
  .twk-chip>span{position:absolute;top:0;bottom:0;right:0;width:34%;
    display:flex;flex-direction:column;box-shadow:-1px 0 0 rgba(0,0,0,.1)}
  .twk-chip>span>i{flex:1;box-shadow:0 -1px 0 rgba(0,0,0,.1)}
  .twk-chip>span>i:first-child{box-shadow:none}
  .twk-chip svg{position:absolute;top:6px;left:6px;width:13px;height:13px;
    filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))}
`;

// ── useTweaks ───────────────────────────────────────────────────────────────
// Single source of truth for tweak values. setTweak persists via the host
// (__edit_mode_set_keys → host rewrites the EDITMODE block on disk).
function useTweaks(defaults) {
  const [values, setValues] = React.useState(defaults);
  // Accepts either setTweak('key', value) or setTweak({ key: value, ... }) so a
  // useState-style call doesn't write a "[object Object]" key into the persisted
  // JSON block.
  const setTweak = React.useCallback((keyOrEdits, val) => {
    const edits = typeof keyOrEdits === 'object' && keyOrEdits !== null
      ? keyOrEdits : { [keyOrEdits]: val };
    setValues((prev) => ({ ...prev, ...edits }));
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits }, '*');
    // Same-window signal so in-page listeners (deck-stage rail thumbnails)
    // can react — the parent message only reaches the host, not peers.
    window.dispatchEvent(new CustomEvent('tweakchange', { detail: edits }));
  }, []);
  return [values, setTweak];
}

// ── TweaksPanel ─────────────────────────────────────────────────────────────
// Floating shell. Registers the protocol listener BEFORE announcing
// availability — if the announce ran first, the host's activate could land
// before our handler exists and the toolbar toggle would silently no-op.
// The close button posts __edit_mode_dismissed so the host's toolbar toggle
// flips off in lockstep; the host echoes __deactivate_edit_mode back which
// is what actually hides the panel.
function TweaksPanel({ title = 'Tweaks', noDeckControls = false, children }) {
  const [open, setOpen] = React.useState(false);
  const dragRef = React.useRef(null);
  // Auto-inject a rail toggle when a <deck-stage> is on the page. The
  // toggle drives the deck's per-viewer _railVisible via window message;
  // state is mirrored from the same localStorage key the deck reads so
  // the control reflects reality across reloads. The mechanism is the
  // message — authors who want custom placement can post it directly
  // and pass noDeckControls to suppress this one.
  const hasDeckStage = React.useMemo(
    () => typeof document !== 'undefined' && !!document.querySelector('deck-stage'),
    [],
  );
  // Hide the toggle until the host has actually enabled the rail (the
  // __omelette_rail_enabled window message, posted only when the
  // omelette_deck_rail_enabled flag is on for this user). The initial read
  // covers TweaksPanel mounting after the message already arrived; the
  // listener covers the common case of mounting first.
  const [railEnabled, setRailEnabled] = React.useState(
    () => hasDeckStage && !!document.querySelector('deck-stage')?._railEnabled,
  );
  React.useEffect(() => {
    if (!hasDeckStage || railEnabled) return undefined;
    const onMsg = (e) => {
      if (e.data && e.data.type === '__omelette_rail_enabled') setRailEnabled(true);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [hasDeckStage, railEnabled]);
  const [railVisible, setRailVisible] = React.useState(() => {
    try { return localStorage.getItem('deck-stage.railVisible') !== '0'; } catch (e) { return true; }
  });
  const toggleRail = (on) => {
    setRailVisible(on);
    window.postMessage({ type: '__deck_rail_visible', on }, '*');
  };
  const offsetRef = React.useRef({ x: 16, y: 16 });
  const PAD = 16;

  const clampToViewport = React.useCallback(() => {
    const panel = dragRef.current;
    if (!panel) return;
    const w = panel.offsetWidth, h = panel.offsetHeight;
    const maxRight = Math.max(PAD, window.innerWidth - w - PAD);
    const maxBottom = Math.max(PAD, window.innerHeight - h - PAD);
    offsetRef.current = {
      x: Math.min(maxRight, Math.max(PAD, offsetRef.current.x)),
      y: Math.min(maxBottom, Math.max(PAD, offsetRef.current.y)),
    };
    panel.style.right = offsetRef.current.x + 'px';
    panel.style.bottom = offsetRef.current.y + 'px';
  }, []);

  React.useEffect(() => {
    if (!open) return;
    clampToViewport();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', clampToViewport);
      return () => window.removeEventListener('resize', clampToViewport);
    }
    const ro = new ResizeObserver(clampToViewport);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [open, clampToViewport]);

  React.useEffect(() => {
    const onMsg = (e) => {
      const t = e?.data?.type;
      if (t === '__activate_edit_mode') setOpen(true);
      else if (t === '__deactivate_edit_mode') setOpen(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const dismiss = () => {
    setOpen(false);
    window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*');
  };

  const onDragStart = (e) => {
    const panel = dragRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = (ev) => {
      offsetRef.current = {
        x: startRight - (ev.clientX - sx),
        y: startBottom - (ev.clientY - sy),
      };
      clampToViewport();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (!open) return null;
  return (
    <>
      <style>{__TWEAKS_STYLE}</style>
      <div ref={dragRef} className="twk-panel" data-noncommentable=""
           style={{ right: offsetRef.current.x, bottom: offsetRef.current.y }}>
        <div className="twk-hd" onMouseDown={onDragStart}>
          <b>{title}</b>
          <button className="twk-x" aria-label="Close tweaks"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={dismiss}>✕</button>
        </div>
        <div className="twk-body">
          {children}
          {hasDeckStage && railEnabled && !noDeckControls && (
            <TweakSection label="Deck">
              <TweakToggle label="Thumbnail rail" value={railVisible} onChange={toggleRail} />
            </TweakSection>
          )}
        </div>
      </div>
    </>
  );
}

// ── Layout helpers ──────────────────────────────────────────────────────────

function TweakSection({ label, children }) {
  return (
    <>
      <div className="twk-sect">{label}</div>
      {children}
    </>
  );
}

function TweakRow({ label, value, children, inline = false }) {
  return (
    <div className={inline ? 'twk-row twk-row-h' : 'twk-row'}>
      <div className="twk-lbl">
        <span>{label}</span>
        {value != null && <span className="twk-val">{value}</span>}
      </div>
      {children}
    </div>
  );
}

// ── Controls ────────────────────────────────────────────────────────────────

function TweakSlider({ label, value, min = 0, max = 100, step = 1, unit = '', onChange }) {
  return (
    <TweakRow label={label} value={`${value}${unit}`}>
      <input type="range" className="twk-slider" min={min} max={max} step={step}
             value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </TweakRow>
  );
}

function TweakToggle({ label, value, onChange }) {
  return (
    <div className="twk-row twk-row-h">
      <div className="twk-lbl"><span>{label}</span></div>
      <button type="button" className="twk-toggle" data-on={value ? '1' : '0'}
              role="switch" aria-checked={!!value}
              onClick={() => onChange(!value)}><i /></button>
    </div>
  );
}

function TweakRadio({ label, value, options, onChange }) {
  const trackRef = React.useRef(null);
  const [dragging, setDragging] = React.useState(false);
  // The active value is read by pointer-move handlers attached for the lifetime
  // of a drag — ref it so a stale closure doesn't fire onChange for every move.
  const valueRef = React.useRef(value);
  valueRef.current = value;

  // Segments wrap mid-word once per-segment width runs out. The track is
  // ~248px (280 panel − 28 body pad − 4 seg pad), each button loses 12px
  // to its own padding, and 11.5px system-ui averages ~6.3px/char — so 2
  // options fit ~16 chars each, 3 fit ~10. Past that (or >3 options), fall
  // back to a dropdown rather than wrap.
  const labelLen = (o) => String(typeof o === 'object' ? o.label : o).length;
  const maxLen = options.reduce((m, o) => Math.max(m, labelLen(o)), 0);
  const fitsAsSegments = maxLen <= ({ 2: 16, 3: 10 }[options.length] ?? 0);
  if (!fitsAsSegments) {
    // <select> emits strings — map back to the original option value so the
    // fallback stays type-preserving (numbers, booleans) like the segment path.
    const resolve = (s) => {
      const m = options.find((o) => String(typeof o === 'object' ? o.value : o) === s);
      return m === undefined ? s : typeof m === 'object' ? m.value : m;
    };
    return <TweakSelect label={label} value={value} options={options}
                        onChange={(s) => onChange(resolve(s))} />;
  }
  const opts = options.map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
  const idx = Math.max(0, opts.findIndex((o) => o.value === value));
  const n = opts.length;

  const segAt = (clientX) => {
    const r = trackRef.current.getBoundingClientRect();
    const inner = r.width - 4;
    const i = Math.floor(((clientX - r.left - 2) / inner) * n);
    return opts[Math.max(0, Math.min(n - 1, i))].value;
  };

  const onPointerDown = (e) => {
    setDragging(true);
    const v0 = segAt(e.clientX);
    if (v0 !== valueRef.current) onChange(v0);
    const move = (ev) => {
      if (!trackRef.current) return;
      const v = segAt(ev.clientX);
      if (v !== valueRef.current) onChange(v);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <TweakRow label={label}>
      <div ref={trackRef} role="radiogroup" onPointerDown={onPointerDown}
           className={dragging ? 'twk-seg dragging' : 'twk-seg'}>
        <div className="twk-seg-thumb"
             style={{ left: `calc(2px + ${idx} * (100% - 4px) / ${n})`,
                      width: `calc((100% - 4px) / ${n})` }} />
        {opts.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={o.value === value}>
            {o.label}
          </button>
        ))}
      </div>
    </TweakRow>
  );
}

function TweakSelect({ label, value, options, onChange }) {
  return (
    <TweakRow label={label}>
      <select className="twk-field" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => {
          const v = typeof o === 'object' ? o.value : o;
          const l = typeof o === 'object' ? o.label : o;
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
    </TweakRow>
  );
}

function TweakText({ label, value, placeholder, onChange }) {
  return (
    <TweakRow label={label}>
      <input className="twk-field" type="text" value={value} placeholder={placeholder}
             onChange={(e) => onChange(e.target.value)} />
    </TweakRow>
  );
}

function TweakNumber({ label, value, min, max, step = 1, unit = '', onChange }) {
  const clamp = (n) => {
    if (min != null && n < min) return min;
    if (max != null && n > max) return max;
    return n;
  };
  const startRef = React.useRef({ x: 0, val: 0 });
  const onScrubStart = (e) => {
    e.preventDefault();
    startRef.current = { x: e.clientX, val: value };
    const decimals = (String(step).split('.')[1] || '').length;
    const move = (ev) => {
      const dx = ev.clientX - startRef.current.x;
      const raw = startRef.current.val + dx * step;
      const snapped = Math.round(raw / step) * step;
      onChange(clamp(Number(snapped.toFixed(decimals))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="twk-num">
      <span className="twk-num-lbl" onPointerDown={onScrubStart}>{label}</span>
      <input type="number" value={value} min={min} max={max} step={step}
             onChange={(e) => onChange(clamp(Number(e.target.value)))} />
      {unit && <span className="twk-num-unit">{unit}</span>}
    </div>
  );
}

// Relative-luminance contrast pick — checkmarks drawn over a swatch need to
// read on both #111 and #fafafa without per-option configuration. Hex input
// only (#rgb / #rrggbb); named or rgb()/hsl() colors fall through to "light".
function __twkIsLight(hex) {
  const h = String(hex).replace('#', '');
  const x = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.padEnd(6, '0');
  const n = parseInt(x.slice(0, 6), 16);
  if (Number.isNaN(n)) return true;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return r * 299 + g * 587 + b * 114 > 148000;
}

const __TwkCheck = ({ light }) => (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3 7.2 5.8 10 11 4.2" fill="none" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round"
          stroke={light ? 'rgba(0,0,0,.78)' : '#fff'} />
  </svg>
);

// TweakColor — curated color/palette picker. Each option is either a single
// hex string or an array of 1-5 hex strings; the card adapts — a lone color
// renders solid, a palette renders colors[0] as the hero (left ~2/3) with the
// rest stacked in a sharp column on the right. onChange emits the
// option in the shape it was passed (string stays string, array stays array).
// Without options it falls back to the native color input for back-compat.
function TweakColor({ label, value, options, onChange }) {
  if (!options || !options.length) {
    return (
      <div className="twk-row twk-row-h">
        <div className="twk-lbl"><span>{label}</span></div>
        <input type="color" className="twk-swatch" value={value}
               onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }
  // Native <input type=color> emits lowercase hex per the HTML spec, so
  // compare case-insensitively. String() guards JSON.stringify(undefined),
  // which returns the primitive undefined (no .toLowerCase).
  const key = (o) => String(JSON.stringify(o)).toLowerCase();
  const cur = key(value);
  return (
    <TweakRow label={label}>
      <div className="twk-chips" role="radiogroup">
        {options.map((o, i) => {
          const colors = Array.isArray(o) ? o : [o];
          const [hero, ...rest] = colors;
          const sup = rest.slice(0, 4);
          const on = key(o) === cur;
          return (
            <button key={i} type="button" className="twk-chip" role="radio"
                    aria-checked={on} data-on={on ? '1' : '0'}
                    aria-label={colors.join(', ')} title={colors.join(' · ')}
                    style={{ background: hero }}
                    onClick={() => onChange(o)}>
              {sup.length > 0 && (
                <span>
                  {sup.map((c, j) => <i key={j} style={{ background: c }} />)}
                </span>
              )}
              {on && <__TwkCheck light={__twkIsLight(hero)} />}
            </button>
          );
        })}
      </div>
    </TweakRow>
  );
}

function TweakButton({ label, onClick, secondary = false }) {
  return (
    <button type="button" className={secondary ? 'twk-btn secondary' : 'twk-btn'}
            onClick={onClick}>{label}</button>
  );
}

Object.assign(window, {
  useTweaks, TweaksPanel, TweakSection, TweakRow,
  TweakSlider, TweakToggle, TweakRadio, TweakSelect,
  TweakText, TweakNumber, TweakColor, TweakButton,
});


// ═════════════════════════════════════════════════════════════════════════
// Extracted from index.html lines 1388-2156
// ═════════════════════════════════════════════════════════════════════════
// Mashal Landing page

const Landing = ({ onSignIn, onSignUp, theme, toggleTheme, heroVariant = 'gradient', activePlan = 'brand' }) => {
  return (
    <div className="min-h-screen bg-paper dark:bg-ink text-ink dark:text-paper">
      <LandingNav onSignIn={onSignIn} onSignUp={onSignUp} theme={theme} toggleTheme={toggleTheme} />
      <Hero variant={heroVariant} onSignUp={onSignUp} />
      <SocialProofMarquee />
      <DashboardPreview />
      <HowItWorks />
      <Features />
      <Integrations />
      <Testimonials />
      <Pricing activePlan={activePlan} onSignUp={onSignUp} />
      <FAQ />
      <CTA onSignUp={onSignUp} />
      <Footer />
    </div>
  );
};

const LandingNav = ({ onSignIn, onSignUp, theme, toggleTheme }) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  // Close the mobile menu on Escape and on viewport widen so the open state
  // doesn't leak into the desktop layout if the user resizes mid-toggle.
  React.useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    const onResize = () => { if (window.innerWidth >= 768) setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-paper/80 dark:bg-ink/80 border-b border-line dark:border-lineDark">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        <a href="/" className="cursor-pointer hover:opacity-80 transition" aria-label="Mashal home"><MashalLogo /></a>
        <nav className="hidden md:flex items-center gap-7 text-[13.5px] text-mute dark:text-muteDark">
          <a href="/features"     className="hover:text-ink dark:hover:text-paper transition">Features</a>
          <a href="/integrations" className="hover:text-ink dark:hover:text-paper transition">Integrations</a>
          <a href="/pricing"      className="hover:text-ink dark:hover:text-paper transition">Pricing</a>
          <a href="/updates"      className="hover:text-ink dark:hover:text-paper transition">Updates</a>
          <a href="/about"        className="hover:text-ink dark:hover:text-paper transition">About</a>
          <a href="/contact"      className="hover:text-ink dark:hover:text-paper transition">Contact</a>
        </nav>
        <div className="flex items-center gap-2">
          {toggleTheme && (
            <button
              type="button"
              onClick={toggleTheme}
              className="hidden md:inline-flex w-9 h-9 rounded-full hover:bg-ink/5 dark:hover:bg-paper/5 items-center justify-center transition"
              title="Toggle theme"
              aria-label="Toggle theme"
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="w-4 h-4" />
            </button>
          )}
          <div className="hidden md:inline-flex"><Btn variant="ghost" size="sm" onClick={onSignIn}>Sign in</Btn></div>
          <Btn variant="ink" size="sm" onClick={onSignUp}>Start free trial</Btn>
          <button
            type="button"
            onClick={() => setMenuOpen(o => !o)}
            className="md:hidden w-9 h-9 rounded-full hover:bg-ink/5 dark:hover:bg-paper/5 inline-flex items-center justify-center transition"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="landing-mobile-nav"
          >
            <Icon name={menuOpen ? 'x' : 'menu'} className="w-5 h-5" />
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav
          id="landing-mobile-nav"
          className="md:hidden absolute left-0 right-0 top-16 bg-paper/95 dark:bg-ink/95 backdrop-blur-md border-b border-line dark:border-lineDark px-5 pb-3"
        >
          {[
            { t: 'Features',     u: '/features'     },
            { t: 'Integrations', u: '/integrations' },
            { t: 'Pricing',      u: '/pricing'      },
            { t: 'Updates',      u: '/updates'      },
            { t: 'About',        u: '/about'        },
            { t: 'Contact',      u: '/contact'      },
          ].map(l => (
            <a
              key={l.u}
              href={l.u}
              onClick={() => setMenuOpen(false)}
              className="block py-3.5 text-[15px] text-ink dark:text-paper border-b border-line dark:border-lineDark"
            >{l.t}</a>
          ))}
          <div className="flex items-center justify-between pt-3">
            <button
              type="button"
              onClick={() => { setMenuOpen(false); onSignIn && onSignIn(); }}
              className="text-[14px] text-ink dark:text-paper"
            >Sign in</button>
            {toggleTheme && (
              <button
                type="button"
                onClick={toggleTheme}
                className="w-9 h-9 rounded-full hover:bg-ink/5 dark:hover:bg-paper/5 inline-flex items-center justify-center transition"
                aria-label="Toggle theme"
              >
                <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="w-4 h-4" />
              </button>
            )}
          </div>
        </nav>
      )}
    </header>
  );
};

const Hero = ({ variant, onSignUp }) => {
  if (variant === 'editorial') return <HeroEditorial onSignUp={onSignUp} />;
  if (variant === 'split') return <HeroSplit onSignUp={onSignUp} />;
  return <HeroGradient onSignUp={onSignUp} />;
};

// Hero — spacey single-column layout. Above-fold reviewer feedback is
// addressed by the new headline, benefit-focused CTA, and the 3-step
// "how it works" strip. The product visual lives in the standalone
// DashboardPreview section directly below the hero (full-width), not
// crammed into a hero column — that experiment squeezed the brief
// mockup uncomfortably.
const HeroGradient = ({ onSignUp }) => (
  <section className="relative overflow-hidden">
    <div className="blob bg-ultra" style={{ width: 600, height: 600, top: -200, left: -100 }} />
    <div className="blob bg-magenta" style={{ width: 500, height: 500, top: -150, right: -100, opacity: 0.4 }} />
    <div className="blob bg-lime" style={{ width: 400, height: 400, bottom: -150, left: '40%', opacity: 0.5 }} />

    <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-8 pt-16 sm:pt-24 pb-16 sm:pb-24">
      <div className="max-w-5xl">
        <div className="inline-flex items-center gap-2 px-3 h-8 rounded-full border border-line dark:border-lineDark bg-chalk/70 dark:bg-coalsoft/70 backdrop-blur mb-7">
          <MashalDot color="bg-magenta" />
          <span className="text-[12px] font-mono uppercase tracking-[0.14em] text-mute dark:text-muteDark whitespace-nowrap">Your daily brief at 6 AM</span>
        </div>

        <h1 className="font-display text-[44px] sm:text-[72px] lg:text-[88px] leading-[0.94] font-semibold tracking-tightest mb-7">
          Know what to post <span className="text-ultra">tomorrow</span>.
          <br />
          <span className="italic font-serif font-normal tracking-tight">Before</span> you wake up.
        </h1>

        <p className="text-[17px] sm:text-[20px] leading-snug text-mute dark:text-muteDark max-w-3xl mb-9">
          A 2-minute morning brief on what's working, what's not, and the one thing to do today — across all seven of your platforms.
        </p>

        <div className="flex flex-wrap items-center gap-3 mb-12">
          <Btn variant="ink" size="lg" onClick={onSignUp}>
            See your first brief by 6 AM
            <Icon name="arrowRight" className="w-4 h-4" />
          </Btn>
          <span className="text-[12px] text-mute dark:text-muteDark ml-2">No credit card · Cancel anytime</span>
        </div>

        {/* 3-step "how it works" strip — teaches the flow in one glance.
            Sits inside the hero so first-time visitors don't have to
            scroll to understand what they're signing up for. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-y-6 gap-x-6 sm:gap-x-10 pt-8 border-t border-line dark:border-lineDark">
          {[
            { n: '01', t: 'Connect',        d: 'Authorize once. 90 seconds, no password sharing.' },
            { n: '02', t: 'Brief by 6 AM',  d: 'Mashal reads your numbers overnight, writes the memo.' },
            { n: '03', t: 'Act today',      d: 'Verdict, actions, signals. Open with your coffee.' },
          ].map((s) => (
            <div key={s.n}>
              <div className="font-mono text-[12px] text-mute dark:text-muteDark uppercase tracking-[0.12em] mb-2.5">{s.n}</div>
              <div className="font-display text-[18px] sm:text-[20px] font-semibold tracking-tight leading-snug mb-2">{s.t}</div>
              <div className="text-[14px] sm:text-[15px] text-mute dark:text-muteDark leading-relaxed">{s.d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

const HeroEditorial = ({ onSignUp }) => (
  <section className="max-w-7xl mx-auto px-5 sm:px-8 pt-16 sm:pt-24 pb-16">
    <div className="grid lg:grid-cols-12 gap-10 items-end">
      <div className="lg:col-span-8">
        <Eyebrow color="text-magenta">Daily Social Intelligence</Eyebrow>
        <h1 className="font-display text-[44px] sm:text-[80px] leading-[0.9] font-semibold tracking-tightest mt-5 mb-8">
          Stop scrolling dashboards. <span className="italic font-serif font-normal">Start reading</span> them.
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <Btn variant="ink" size="lg" onClick={onSignUp}>Start free trial <Icon name="arrowRight" className="w-4 h-4" /></Btn>
          <Btn variant="outline" size="lg">See sample brief</Btn>
        </div>
      </div>
      <div className="lg:col-span-4">
        <p className="text-[17px] leading-relaxed text-mute dark:text-muteDark">
          Mashal is a morning briefing for serious creators. Seven platforms. One signal. Every day at 6 AM — in language you'd actually say out loud.
        </p>
      </div>
    </div>
  </section>
);

const HeroSplit = ({ onSignUp }) => (
  <section className="grid lg:grid-cols-2 min-h-[600px]">
    <div className="p-8 sm:p-12 lg:p-16 flex flex-col justify-center">
      <Eyebrow color="text-ultra">Mashal for creators</Eyebrow>
      <h1 className="font-display text-[40px] sm:text-[64px] leading-[0.94] font-semibold tracking-tightest mt-5 mb-6">
        One brief. Seven platforms. Every morning.
      </h1>
      <p className="text-[17px] text-mute dark:text-muteDark mb-8 max-w-md">
        Stop checking seven apps. Mashal reads your numbers, finds the signal, and tells you exactly what to do — before you've finished your coffee.
      </p>
      <div className="flex flex-wrap gap-3">
        <Btn variant="ink" size="lg" onClick={onSignUp}>Start free trial</Btn>
        <Btn variant="outline" size="lg">Watch demo</Btn>
      </div>
    </div>
    <div className="bg-ink text-paper p-8 sm:p-12 flex items-center justify-center">
      <MiniBriefPreview />
    </div>
  </section>
);

const MiniBriefPreview = () => (
  <div className="w-full max-w-md bg-coalsoft border border-lineDark rounded-2xl p-6 fade-up">
    <div className="flex items-center justify-between mb-4">
      <Eyebrow color="text-lime">Today · 06:04 AM</Eyebrow>
      <MashalDot color="bg-lime" />
    </div>
    <h3 className="font-display text-[26px] leading-tight font-semibold tracking-tighter mb-3">Good morning, Alex.</h3>
    <p className="text-[14px] text-muteDark mb-5">Your Future-of-Work Reel hit 842K overnight. 3 high-priority signals detected.</p>
    <div className="space-y-2.5">
      {[
        { i: 'flame', t: 'Reply to 124K Reel', s: 'Engagement is peaking now' },
        { i: 'clock', t: 'Post TikTok at 4 PM', s: 'Peak window detected' },
        { i: 'sparkle', t: 'Slow Tech is +180%', s: 'Trend match' }
      ].map((a,i) => (
        <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-ink/30">
          <div className="w-8 h-8 rounded-lg bg-lime/15 text-lime flex items-center justify-center"><Icon name={a.i} className="w-4 h-4" /></div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium">{a.t}</div>
            <div className="text-[11px] text-muteDark">{a.s}</div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

// Live "Trusted by" marquee. Pulls real workspace names from /api/featured
// (workspaces that opted in from Settings). Returns null when no one has
// opted in yet — better to hide the section than to ship fabricated logos.
const SocialProofMarquee = () => {
  const [names, setNames] = React.useState(null); // null = loading, [] = none
  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/featured')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setNames(Array.isArray(d?.names) ? d.names : []); })
      .catch(() => { if (!cancelled) setNames([]); });
    return () => { cancelled = true; };
  }, []);
  // Hide entirely while loading and when there's nothing to show.
  if (!names || names.length === 0) return null;
  return (
    <section className="py-7 border-y border-line dark:border-lineDark bg-chalk/50 dark:bg-coal/50 overflow-hidden">
      <div className="text-center mb-5"><span className="text-[11px] uppercase tracking-[0.18em] font-mono text-mute dark:text-muteDark">Trusted by creators, brands &amp; agencies worldwide</span></div>
      <div className="flex marquee whitespace-nowrap gap-12 font-display text-[22px] font-semibold tracking-tighter opacity-50">
        {[...Array(2)].map((_, k) => (
          <div key={k} className="flex gap-12 px-6">
            {names.map((b, i) => <span key={i}>{b}</span>)}
          </div>
        ))}
      </div>
    </section>
  );
};

const DashboardPreview = () => (
  <section className="max-w-7xl mx-auto px-5 sm:px-8 py-16 sm:py-24">
    <div className="text-center max-w-2xl mx-auto mb-12">
      <Eyebrow>The dashboard</Eyebrow>
      <h2 className="font-display text-[32px] sm:text-[48px] leading-[1] font-semibold tracking-tightest mt-3 mb-4">Looks like a feed.<br/><span className="italic font-serif font-normal">Reads like a strategist.</span></h2>
      <p className="text-[15px] text-mute dark:text-muteDark">No menus to learn. No charts to decode. Mashal writes you a daily memo and shows the work.</p>
    </div>
    <div className="relative rounded-3xl overflow-hidden border border-line dark:border-lineDark shadow-pop bg-chalk dark:bg-coalsoft">
      <div className="absolute inset-x-0 top-0 h-10 bg-ink/[0.03] dark:bg-paper/[0.04] border-b border-line dark:border-lineDark flex items-center px-4 gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-ink/15" />
        <span className="w-2.5 h-2.5 rounded-full bg-ink/15" />
        <span className="w-2.5 h-2.5 rounded-full bg-ink/15" />
        <span className="ml-3 text-[11px] font-mono text-mute">mashal.app/brief</span>
      </div>
      <div className="pt-12 p-6 sm:p-10">
        <MockBrief />
      </div>
    </div>
  </section>
);

const MockBrief = () => (
  <div className="grid lg:grid-cols-12 gap-5">
    <div className="lg:col-span-8 rounded-2xl bg-ink text-paper p-6 sm:p-8 relative overflow-hidden">
      <div className="absolute -right-12 -top-12 w-48 h-48 rounded-full bg-ultra/30 blur-2xl" />
      <Eyebrow color="text-lime">AI Verdict · Live</Eyebrow>
      <h3 className="font-display text-[32px] sm:text-[40px] leading-[1.02] font-semibold tracking-tightest mt-4 mb-3 max-w-lg">Your Future-of-Work reel is still receiving shares at 48 hrs.</h3>
      <p className="text-[14px] text-paper/70 max-w-md mb-6">Replying to top comments now extends the algorithm window by ~14 hours. Your tutorial-format posts earn 6× more saves than reels.</p>
      <div className="flex flex-wrap gap-2">
        <Btn variant="lime" size="sm">Open comments →</Btn>
        <Btn variant="outline" size="sm" className="border-paper/20 text-paper">See full action plan</Btn>
      </div>
    </div>
    <div className="lg:col-span-4 grid grid-cols-2 gap-3">
      <Card className="!p-4"><Eyebrow>Total reach</Eyebrow><div className="font-display text-[26px] font-semibold tracking-tighter mt-2">1.24M</div><span className="text-[11px] text-emerald-600 dark:text-lime font-mono">↑ 24.8%</span></Card>
      <Card className="!p-4"><Eyebrow>Eng. rate</Eyebrow><div className="font-display text-[26px] font-semibold tracking-tighter mt-2">8.4%</div><span className="text-[11px] text-emerald-600 dark:text-lime font-mono">↑ 1.2%</span></Card>
      <Card className="!p-4 col-span-2"><Eyebrow color="text-magenta">New signals</Eyebrow><div className="font-display text-[26px] font-semibold tracking-tighter mt-2">14 fresh insights</div></Card>
    </div>
  </div>
);

const HowItWorks = () => (
  <section id="how" className="max-w-7xl mx-auto px-5 sm:px-8 py-16 sm:py-24">
    <SectionHead eyebrow="How it works" title="From scrolling to strategic in three mornings." sub="Mashal runs on autopilot. Here's what happens behind the scenes." />
    <div className="grid md:grid-cols-3 gap-5">
      {[
        { n: '01', t: 'Connect your accounts', d: 'Authorize Instagram, TikTok, YouTube, LinkedIn, Facebook, X, and Snapchat in under 90 seconds. No password sharing, no scrapers to install.' },
        { n: '02', t: 'Mashal syncs every morning', d: 'At 6 AM your local time, Mashal pulls fresh data, runs cross-platform analysis, and writes a personalized brief in plain English.' },
        { n: '03', t: 'Read. Act. Repeat.', d: 'Open Mashal with your coffee. You\'ll know the one thing to do today, the two trends to watch this week, and where you stand against your goals.' }
      ].map((s,i) => (
        <div key={i} className="relative rounded-2xl border border-line dark:border-lineDark p-6 bg-chalk dark:bg-coalsoft">
          <div className="font-mono text-[11px] text-mute dark:text-muteDark mb-5">{s.n}</div>
          <h3 className="font-display text-[22px] font-semibold tracking-tighter leading-tight mb-3">{s.t}</h3>
          <p className="text-[14px] text-mute dark:text-muteDark leading-relaxed">{s.d}</p>
        </div>
      ))}
    </div>
  </section>
);

const Features = () => (
  <section id="features" className="bg-chalk dark:bg-coal text-ink dark:text-paper border-y border-line dark:border-lineDark">
    <div className="max-w-7xl mx-auto px-5 sm:px-8 py-16 sm:py-24">
      <div className="grid lg:grid-cols-12 gap-10 mb-12">
        <div className="lg:col-span-7">
          <Eyebrow>Features</Eyebrow>
          <h2 className="font-display text-[36px] sm:text-[56px] leading-[0.96] font-semibold tracking-tightest mt-3">Every metric you'd check. <span className="italic font-serif font-normal text-mute dark:text-muteDark">Already read for you.</span></h2>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-line dark:bg-lineDark">
        {[
          { i: 'sparkle', t: 'Morning Brief', d: 'A 2-minute read every day. AI verdict, top signals, 3 prioritized actions.' },
          { i: 'brain', t: 'AI Signal Engine', d: 'Cross-platform pattern detection finds viral formulas, content gaps, and emerging trends.' },
          { i: 'target', t: 'Targets & Cycles', d: 'Set 30-day cycles. Mashal tracks pace, predicts outcomes, and recommends pivots.' },
          { i: 'flame', t: 'Live Viral Alerts', d: 'Get notified the moment a post crosses algorithmic threshold — before the spike ends.' },
          { i: 'users', t: 'Competitor Tracking', d: 'Track up to 50 competitor accounts. See their wins, gaps, and posting cadence.' },
          { i: 'rocket', t: 'Content Deep-Dive', d: 'Anatomize any post: format, hook, niche, timing — and a "replicate this" playbook.' },
          { i: 'globe', t: 'Seven Platforms, One View', d: 'Instagram, TikTok, YouTube, LinkedIn, Facebook, X, and Snapchat. Switch context with one click.' },
          { i: 'download', t: 'Daily Email + Export', d: 'Brief in your inbox by 6 AM. Export anything to CSV, PDF, or your team\'s Slack.' },
          { i: 'layers', t: 'White-Label Workspaces', d: 'Agencies: 20 client workspaces, branded reports, bulk export. Built for scale.' }
        ].map((f,i) => (
          <div key={i} className="bg-chalk dark:bg-coal p-7 hover:bg-paper dark:hover:bg-coalsoft transition">
            <div className="w-10 h-10 rounded-xl bg-ultra/15 text-ultra flex items-center justify-center mb-4"><Icon name={f.i} className="w-5 h-5" /></div>
            <h3 className="font-display text-[18px] font-semibold tracking-tight mb-2">{f.t}</h3>
            <p className="text-[13.5px] text-mute dark:text-muteDark leading-relaxed">{f.d}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const Integrations = () => (
  <section className="max-w-7xl mx-auto px-5 sm:px-8 py-16 sm:py-24">
    <div className="grid lg:grid-cols-12 gap-12 items-center">
      <div className="lg:col-span-5">
        <Eyebrow>Integrations</Eyebrow>
        <h2 className="font-display text-[32px] sm:text-[44px] leading-[0.98] font-semibold tracking-tightest mt-3 mb-4">Seven platforms.<br/>One source of truth.</h2>
        <p className="text-[15px] text-mute dark:text-muteDark mb-6">Mashal reads from official APIs only. Read-only OAuth, no password sharing, no scrapers on your account. Disconnect anytime.</p>
        <a href="/integrations" className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-line dark:border-lineDark text-[13px] font-medium hover:bg-ink/5 dark:hover:bg-paper/5 transition">
          See all integrations <Icon name="arrowRight" className="w-4 h-4" />
        </a>
      </div>
      <div className="lg:col-span-7 grid grid-cols-4 sm:grid-cols-4 lg:grid-cols-4 gap-3">
        {['ig','tt','yt','li','fb','x','sc'].map((p,i) => (
          <div key={p} className="aspect-square rounded-2xl border border-line dark:border-lineDark bg-chalk dark:bg-coalsoft flex flex-col items-center justify-center gap-3 hover:scale-105 transition" style={{ animationDelay: `${i * 60}ms` }}>
            <Plat p={p} className="w-10 h-10 sm:w-12 sm:h-12" />
            <span className="text-[11px] font-mono uppercase tracking-[0.1em] text-mute dark:text-muteDark">{platformLabel[p]}</span>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const Testimonials = () => (
  <section className="bg-chalk dark:bg-coal py-16 sm:py-24">
    <div className="max-w-7xl mx-auto px-5 sm:px-8">
      <SectionHead eyebrow="From the field" title="Creators who stopped guessing." />
      <div className="grid md:grid-cols-3 gap-5">
        {[
          { q: 'I used to spend 90 minutes every Monday building dashboards. Mashal does it before I wake up. The signals are uncannily specific.', n: 'Maya Chen', r: 'Creator · 240K IG', avatar: 'MC' },
          { q: 'We run 14 client accounts. The white-label briefs replaced our weekly reports. Clients literally forward them to their leadership.', n: 'Daniel Ortiz', r: 'Founder, LEDR Agency', avatar: 'DO' },
          { q: 'The cross-platform gap analysis surfaced 29 reels I\'d never uploaded as Shorts. Two of them have outperformed the original.', n: 'Sana Patel', r: 'Brand, kanaa.', avatar: 'SP' }
        ].map((t,i) => (
          <Card key={i} className="!p-7">
            <Icon name="quote" className="w-6 h-6 text-ultra mb-4" stroke={1.2} />
            <p className="text-[15px] leading-relaxed mb-6">"{t.q}"</p>
            <div className="flex items-center gap-3 pt-5 border-t border-line dark:border-lineDark">
              <div className="w-9 h-9 rounded-full bg-ink text-paper dark:bg-paper dark:text-ink font-mono text-[11px] font-medium flex items-center justify-center">{t.avatar}</div>
              <div>
                <div className="text-[13px] font-medium">{t.n}</div>
                <div className="text-[11px] text-mute dark:text-muteDark">{t.r}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  </section>
);

// Compare table data — defined outside Pricing so the inline ComparePlans
// component can share it without re-allocating on every render.
const COMPARE_GROUPS = [
  { category: 'Workspaces & Accounts', rows: [
    { label: 'Workspaces',         creator: '2',                  pro_creator: '2',                       brand: '3',                  agency: '20 client workspaces' },
    { label: 'Social accounts',    creator: '5 total',            pro_creator: '7 (1 per platform)',      brand: '7 (1 per platform)', agency: '~100 (5 per workspace)' },
    { label: 'Competitors tracked',creator: '5',                  pro_creator: '10',                      brand: '10',                 agency: '30' },
    { label: 'Platforms',          creator: 'IG, TT, YT, FB, LI', pro_creator: 'All 7 incl. X & Snapchat',brand: 'All 7 incl. X & Snapchat', agency: 'All 7 incl. X & Snapchat' },
  ]},
  { category: 'Intelligence', rows: [
    { label: 'Daily morning brief',                  creator: true,  pro_creator: true,  brand: true,  agency: true },
    { label: 'Weekly recap + next-week plan email',  creator: false, pro_creator: true,  brand: true,  agency: true },
    { label: 'Multilingual brief (9 langs)',         creator: false, pro_creator: true,  brand: true,  agency: true },
    { label: 'Live signal alerts',           creator: false, pro_creator: false, brand: false, agency: true },
    { label: 'Competitor analysis',          creator: true,  pro_creator: true,  brand: true,  agency: true },
    { label: 'AI verdict + signals',         creator: true,  pro_creator: true,  brand: true,  agency: true },
    { label: 'Market context & cultural calendar', creator: false, pro_creator: true, brand: true, agency: true },
  ]},
  { category: 'Ad Intelligence', rows: [
    { label: 'Ad performance dashboard',     creator: false, pro_creator: false, brand: true,  agency: true },
    { label: 'Organic vs paid comparison',   creator: false, pro_creator: false, brand: true,  agency: true },
    { label: 'Cross-platform ad reporting',  creator: false, pro_creator: false, brand: true,  agency: true },
    { label: 'Spot score benchmarking',      creator: false, pro_creator: false, brand: true,  agency: true },
    { label: 'Meta Ad Library competitor scrape', creator: false, pro_creator: false, brand: true, agency: true },
    { label: 'Audience demographics',        creator: false, pro_creator: false, brand: true,  agency: true },
    { label: 'Per-client ad reporting',      creator: false, pro_creator: false, brand: false, agency: true },
  ]},
  { category: 'Reports & Export', rows: [
    { label: 'PDF reports',        creator: false, pro_creator: true,  brand: true,  agency: true },
    { label: 'White-label reports',creator: false, pro_creator: false, brand: false, agency: true },
    { label: 'CSV export',         creator: false, pro_creator: true,  brand: true,  agency: true },
  ]},
  { category: 'Billing', rows: [
    { label: 'Monthly price',      creator: '$15',        pro_creator: '$29',      brand: '$99',           agency: '$449' },
    { label: 'Free trial',         creator: '7 days, no CC', pro_creator: '7 days, no CC', brand: '7 days, no CC', agency: 'Contact us' },
  ]},
];

// Borderless side-by-side comparison. Renders as a CSS grid (no <table>)
// so we can layer the featured-column tint as a single rounded background
// behind the column instead of per-cell. Plan headers + CTAs live at the
// top; category breaks are full-width display-font headings — the same
// visual rhythm as the Features and FAQ sections.
const ComparePlans = ({ onSignUp }) => {
  const Val = ({ v, featured }) => {
    if (v === true) {
      // Solid bubble with a dark ink check — keeps the check legible
      // regardless of mode. The pale lime/15 tint that used to back the
      // check was so close to the icon color that the glyph disappeared.
      return (
        <span className={cls('inline-flex items-center justify-center w-6 h-6 rounded-full text-ink',
          featured ? 'bg-lime' : 'bg-ultra/90 text-paper')}>
          <Icon name="check" className="w-3.5 h-3.5" stroke={3} />
        </span>
      );
    }
    if (v === false) return <span className="text-mute/40 dark:text-muteDark/40 text-[15px]">—</span>;
    return <span className={cls('text-[13px] leading-snug', featured && 'font-medium')}>{v}</span>;
  };

  // Label column (1.4fr) + 4 plan columns (1fr each). With the new Pro
  // Creator column the row gets wider — keep overflow-x-auto on the
  // outer card so the table scrolls on narrow viewports instead of
  // wrapping awkwardly.
  const cols = 'grid-cols-[1.4fr_1fr_1fr_1fr_1fr]';

  return (
    <div className="mt-10 sm:mt-12">
      <div className="rounded-3xl bg-chalk/60 dark:bg-coalsoft/60 px-3 sm:px-6 py-6 sm:py-8 overflow-x-auto">
        {/* Plan header row */}
        <div className={cls('grid items-end gap-x-3 sm:gap-x-6 px-3 pb-5 border-b border-line dark:border-lineDark min-w-[680px]', cols)}>
          <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-mute dark:text-muteDark">
            Compare features
          </div>
          {[
            { key: 'creator',     name: 'Creator',     price: '$15',  cta: 'Start trial',   variant: 'outline', featured: false },
            { key: 'pro_creator', name: 'Pro Creator', price: '$29',  cta: 'Start trial',   variant: 'outline', featured: false },
            { key: 'brand',       name: 'Brand',       price: '$99',  cta: 'Start trial',   variant: 'ink',     featured: true  },
            { key: 'agency',      name: 'Agency',      price: '$449', cta: 'Talk to sales', variant: 'outline', featured: false },
          ].map(p => (
            <div key={p.key} className={cls('text-center px-1 sm:px-2', p.featured && 'relative')}>
              {p.featured && (
                <span className="inline-flex items-center px-2 h-5 rounded-full bg-lime text-ink text-[9.5px] font-mono uppercase tracking-[0.12em] font-medium mb-1.5">Popular</span>
              )}
              <div className="font-display text-[16px] sm:text-[18px] font-semibold tracking-tight">{p.name}</div>
              <div className="font-mono text-[12px] text-mute dark:text-muteDark mt-0.5">{p.price}/mo</div>
              <Btn variant={p.variant} size="sm" onClick={onSignUp} className="mt-3 w-full justify-center text-[11.5px]">
                {p.cta}
              </Btn>
            </div>
          ))}
        </div>

        {/* Feature groups */}
        {COMPARE_GROUPS.map((group, gi) => (
          <div key={gi} className="pt-7 sm:pt-9">
            <div className={cls('grid gap-x-3 sm:gap-x-6 px-3 mb-2 min-w-[680px]', cols)}>
              <h4 className="font-display text-[17px] sm:text-[18px] font-semibold tracking-tight">
                {group.category}
              </h4>
            </div>
            <div className="rounded-xl overflow-hidden min-w-[680px]">
              {group.rows.map((row, ri) => (
                <div
                  key={ri}
                  className={cls(
                    'grid items-center gap-x-3 sm:gap-x-6 px-3 py-3.5',
                    cols,
                    ri > 0 && 'border-t border-line/60 dark:border-lineDark/40'
                  )}
                >
                  <div className="text-[13px] sm:text-[13.5px] text-ink/85 dark:text-paper/85">{row.label}</div>
                  <div className="text-center px-1 rounded-md">
                    <Val v={row.creator} />
                  </div>
                  <div className="text-center px-1 rounded-md">
                    <Val v={row.pro_creator} />
                  </div>
                  <div className="text-center px-1 py-1 rounded-md bg-ultra/[0.06] dark:bg-ultra/[0.12]">
                    <Val v={row.brand} featured />
                  </div>
                  <div className="text-center px-1">
                    <Val v={row.agency} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const Pricing = ({ activePlan, onSignUp }) => {
  const plans = [
    { id: 'creator', name: 'Creator', price: 15, blurb: 'For solo creators starting out.',
      bullets: [
        '2 workspaces',
        '5 social accounts total',
        '5 competitors tracked',
        '5 platforms (IG, TT, YT, FB, LI)',
        'Daily morning brief',
        '7-day free trial — no credit card'
      ],
      cta: 'Start free trial', featured: false },
    { id: 'pro_creator', name: 'Pro Creator', price: 29, blurb: 'For serious creators on the full stack.',
      bullets: [
        '2 workspaces',
        '7 accounts (1 per platform)',
        '10 competitors tracked',
        'All 7 platforms incl. X & Snapchat',
        'Multilingual brief — 9 languages, dialect-aware',
        'Market context & cultural calendar',
        'PDF reports + weekly recap email'
      ],
      cta: 'Start free trial', featured: false },
    { id: 'brand', name: 'Brand', price: 99, blurb: 'For businesses tracking real performance.',
      bullets: [
        '3 workspaces',
        '1 account per platform (7 total)',
        '10 competitors tracked',
        'All 7 platforms incl. X & Snapchat',
        'Daily brief + weekly recap email',
        'Ad performance dashboard (Meta, TikTok, X)',
      ],
      cta: 'Start free trial', featured: true },
    { id: 'agency', name: 'Agency', price: 449, blurb: 'For agencies managing multiple clients.',
      bullets: [
        '20 client workspaces',
        '5 accounts per workspace (~100 total)',
        '30 competitors tracked',
        'All 7 platforms',
        'Daily brief + weekly recap + alerts',
        'Ad performance across all clients',
        'White-label PDF reports'
      ],
      cta: 'Talk to sales', featured: false }
  ];
  const [showCompare, setShowCompare] = React.useState(false);

  // Auto-open the comparison if the page is loaded with #compare in the
  // URL (or the user clicks a #compare link after first paint). Smooth-
  // scroll into view once the panel has mounted.
  React.useEffect(() => {
    const apply = () => {
      if (typeof window === 'undefined') return;
      if (window.location.hash !== '#compare') return;
      setShowCompare(true);
      requestAnimationFrame(() => {
        const el = document.getElementById('compare');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  return (
    <section id="pricing" className="max-w-7xl mx-auto px-5 sm:px-8 py-16 sm:py-24">
      <SectionHead eyebrow="Pricing" title="Pick a plan. Cancel anytime." sub="7-day free trial on Creator, Pro Creator & Brand. No credit card required." />
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        {plans.map(p => {
          const featured = p.id === activePlan;
          return (
            <div key={p.id} className={cls(
              'relative rounded-3xl p-7 transition-all bg-chalk dark:bg-coalsoft',
              featured
                ? 'border-2 border-ultra scale-[1.02] shadow-[0_14px_44px_-14px_rgba(107,91,255,0.45)]'
                : 'border border-line dark:border-lineDark'
            )}>
              {featured && (
                <span className="absolute -top-3 left-7 inline-flex items-center gap-1.5 px-3 h-6 rounded-full bg-ultra text-paper text-[11px] font-mono uppercase tracking-[0.12em] font-medium">Most popular</span>
              )}
              <h3 className="font-display text-[22px] font-semibold tracking-tighter">{p.name}</h3>
              <p className="text-[13px] mt-1 mb-5 text-mute dark:text-muteDark">{p.blurb}</p>
              <div className="flex items-baseline gap-1 mb-6">
                <span className="font-display text-[48px] font-semibold tracking-tightest leading-none">${p.price}</span>
                <span className="text-[13px] text-mute dark:text-muteDark">/month</span>
              </div>
              <ul className="space-y-2.5 mb-7">
                {p.bullets.map((b,i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[13.5px] leading-snug">
                    <Icon name="check" className="w-4 h-4 mt-0.5 flex-shrink-0 text-ultra" stroke={2} />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <Btn variant={featured ? 'ultra' : 'ink'} size="md" className="w-full" onClick={onSignUp}>{p.cta}</Btn>
            </div>
          );
        })}
      </div>

      {/* Compare toggle — collapsed by default so the Pricing area stays
          calm. Anchor lives on the wrapping div so #compare jumps land
          on the toggle/comparison area, not the section top. */}
      <div id="compare" className="mt-10 flex justify-center scroll-mt-20">
        <button
          type="button"
          onClick={() => setShowCompare(v => !v)}
          aria-expanded={showCompare}
          className="inline-flex items-center gap-2 px-5 h-11 rounded-full border border-line dark:border-lineDark bg-chalk/60 dark:bg-coalsoft/60 hover:bg-chalk dark:hover:bg-coalsoft text-[13.5px] font-medium transition"
        >
          {showCompare ? 'Hide full comparison' : 'Compare all features'}
          <Icon name="chevDown" className={cls('w-4 h-4 transition-transform', showCompare && 'rotate-180')} />
        </button>
      </div>
      {showCompare && <ComparePlans onSignUp={onSignUp} />}
    </section>
  );
};

const FAQ = () => {
  const [open, setOpen] = React.useState(0);
  const qs = [
    { q: 'How does Mashal get my data?', a: 'Mashal connects through each platform\'s official API. You authorize once, we never see your password, and you can disconnect any account from Settings at any time.' },
    { q: 'When does the brief arrive?', a: 'Every morning at 6 AM in your local time zone. You can also enable a same-time email summary. The dashboard updates automatically when the sync completes.' },
    { q: 'Can I track competitors?', a: 'Yes. Creator tracks up to 5, Brand up to 15, Agency up to 50. You add a public handle and Mashal runs the same analysis as it does for your own accounts.' },
    { q: 'What about TikTok / Instagram API limits?', a: 'We use the official Business / Creator APIs. Mashal handles rate-limiting and retry logic so you never see "data delayed" messages.' },
    { q: 'Is there a free trial?', a: '7 days on Creator & Brand, no credit card required. You\'ll get the full feature set — including the daily brief — for the full trial.' },
    { q: 'What happens after the trial?', a: 'Your data goes read-only — nothing is deleted. You can upgrade at any time and pick up exactly where you left off. We hold your data for 30 days before clearing inactive trial accounts.' },
    { q: 'Can I cancel anytime?', a: 'Yes, from the Billing page in Settings. No phone calls, no retention specialists, no friction. Your data is exported automatically.' }
  ];
  return (
    <section id="faq" className="max-w-3xl mx-auto px-5 sm:px-8 py-16 sm:py-24">
      <SectionHead eyebrow="FAQ" title="Questions, answered." />
      <div className="divide-y divide-line dark:divide-lineDark border-y border-line dark:border-lineDark">
        {qs.map((q,i) => (
          <div key={i}>
            <button onClick={() => setOpen(open === i ? -1 : i)} className="w-full flex items-center justify-between py-5 text-left">
              <span className="font-display text-[18px] font-semibold tracking-tight pr-6">{q.q}</span>
              <Icon name={open === i ? 'minus' : 'plus'} className="w-4 h-4 flex-shrink-0" />
            </button>
            {open === i && <p className="pb-5 text-[14.5px] text-mute dark:text-muteDark leading-relaxed -mt-1">{q.a}</p>}
          </div>
        ))}
      </div>
    </section>
  );
};

const CTA = ({ onSignUp }) => (
  <section className="max-w-7xl mx-auto px-5 sm:px-8 pb-16 sm:pb-24">
    <div className="relative rounded-3xl bg-ink text-paper p-10 sm:p-16 overflow-hidden">
      <div className="blob bg-ultra" style={{ width: 400, height: 400, top: -100, right: -100 }} />
      <div className="blob bg-lime" style={{ width: 300, height: 300, bottom: -100, left: -50, opacity: 0.3 }} />
      <div className="relative z-10 max-w-2xl">
        <h2 className="font-display text-[36px] sm:text-[56px] leading-[0.96] font-semibold tracking-tightest mb-5">Tomorrow morning, you'll already know.</h2>
        <p className="text-[16px] text-paper/70 mb-7">Get your first Mashal brief in less than 24 hours.</p>
        <div className="flex flex-wrap gap-3">
          <Btn variant="lime" size="lg" onClick={onSignUp}>Start free 7-day trial <Icon name="arrowRight" className="w-4 h-4" /></Btn>
          <Btn variant="outline" size="lg" className="border-paper/20 text-paper">Book a 15-min demo</Btn>
        </div>
      </div>
    </div>
  </section>
);

const Footer = () => (
  <footer className="border-t border-line dark:border-lineDark">
    <div className="max-w-7xl mx-auto px-5 sm:px-8 py-12">
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-8">
        <div className="lg:col-span-2">
          <a href="/" className="inline-block hover:opacity-80 transition" aria-label="Mashal home"><MashalLogo /></a>
          <p className="text-[13.5px] text-mute dark:text-muteDark mt-4 max-w-xs">Daily social intelligence for serious creators, brands and agencies.</p>
          <nav aria-label="Follow Mashal" className="flex gap-2.5 mt-4">
            <a href="https://instagram.com/getmashal" target="_blank" rel="noopener" aria-label="Instagram" className="w-9 h-9 rounded-lg border border-line dark:border-lineDark text-mute dark:text-muteDark inline-flex items-center justify-center hover:text-ultra hover:border-ultra transition">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="w-4 h-4"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
            </a>
            <a href="https://tiktok.com/@getmashal" target="_blank" rel="noopener" aria-label="TikTok" className="w-9 h-9 rounded-lg border border-line dark:border-lineDark text-mute dark:text-muteDark inline-flex items-center justify-center hover:text-ultra hover:border-ultra transition">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-4 h-4"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-.88-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.05a8.16 8.16 0 0 0 4.77 1.52V6.11a4.85 4.85 0 0 1-1.84-.42z"/></svg>
            </a>
            <a href="https://facebook.com/getmashal" target="_blank" rel="noopener" aria-label="Facebook" className="w-9 h-9 rounded-lg border border-line dark:border-lineDark text-mute dark:text-muteDark inline-flex items-center justify-center hover:text-ultra hover:border-ultra transition">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-4 h-4"><path d="M13 22v-8h3l1-4h-4V7.5a1 1 0 0 1 1-1h3v-4h-3a5 5 0 0 0-5 5V10H5v4h4v8z"/></svg>
            </a>
            <a href="https://x.com/getmashalapp" target="_blank" rel="noopener" aria-label="X (Twitter)" className="w-9 h-9 rounded-lg border border-line dark:border-lineDark text-mute dark:text-muteDark inline-flex items-center justify-center hover:text-ultra hover:border-ultra transition">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-4 h-4"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a>
          </nav>
        </div>
        {[
          { h: 'Product', l: [{ t: 'Features', u: '/features' }, { t: 'Integrations', u: '/integrations' }, { t: 'Pricing', u: '/pricing' }, { t: 'Updates', u: '/updates' }, { t: 'In your stack', u: '/stack' }, { t: 'Compare', u: '/compare' }] },
          { h: 'Company', l: [{ t: 'About',    u: '/about'    }, { t: 'Contact', u: '/contact' }] },
          { h: 'Legal',   l: [{ t: 'Privacy',  u: '/privacy'  }, { t: 'Terms',   u: '/terms'   }] },
        ].map((g, i) => (
          <div key={i}>
            <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-mute dark:text-muteDark mb-3">{g.h}</div>
            <ul className="space-y-2">
              {g.l.map((l, j) => <li key={j}><a href={l.u} className="text-[13.5px] hover:text-ultra transition">{l.t}</a></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-12 pt-6 border-t border-line dark:border-lineDark flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[12px] text-mute dark:text-muteDark">
        <span>© 2026 Empakt Financial Inc. All rights reserved.</span>
        <div className="flex items-center gap-5">
          <a href="/privacy" className="hover:text-ink dark:hover:text-paper">Privacy</a>
          <a href="/terms" className="hover:text-ink dark:hover:text-paper">Terms</a>
        </div>
      </div>
    </div>
  </footer>
);

Object.assign(window, { Landing });

/* === SPA-BUNDLE-PUBLISH === */
// Push every top-level export of this module onto window so the rest
// of the SPA (other modules + any string-eval call sites) can keep
// using bare-name references exactly as it did under the script-tag
// concatenation model.
Object.assign(window, {
  CATEGORIES,
  COUNTRIES,
  REGION_PRESETS,
  ALL_FOCUS_OPTIONS,
  labelFor,
  useTweaks,
  TweaksPanel,
  TweakSection,
  TweakRow,
  TweakSlider,
  TweakToggle,
  TweakRadio,
  TweakSelect,
  TweakText,
  TweakNumber,
  TweakColor,
  TweakButton,
  Landing,
  LandingNav,
  Hero,
  HeroGradient,
  HeroEditorial,
  HeroSplit,
  MiniBriefPreview,
  SocialProofMarquee,
  DashboardPreview,
  MockBrief,
  HowItWorks,
  Features,
  Integrations,
  Testimonials,
  COMPARE_GROUPS,
  ComparePlans,
  Pricing,
  FAQ,
  CTA,
  Footer,
});
