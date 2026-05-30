// One-shot migration helper — prepends the React import / window-destructure
// header to each js/**/*.jsx feature file and appends an
// `Object.assign(window, { ... })` publish footer to src/spa/utilities.jsx
// and src/spa/screens.jsx.
//
// Idempotent: if a file already starts with `import React` (or already ends
// with our publish footer marker), the relevant change is skipped.
//
// Run with: node scripts/finalize-spa-bundle.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, '..');

// ── Per-file inputs ────────────────────────────────────────────────────────

// Files in js/core/ are "leaf libraries" — they define sbAuth, api, D etc.
// and consume nothing from the SPA's shared utilities namespace, so they
// need only the React import (and not always even that, but uniform is
// cheaper to reason about than per-file decisions).
const coreFiles = [
  'js/core/auth.jsx',
  'js/core/api.jsx',
  'js/core/data.jsx',
];

// Feature files reference Card / Btn / Icon / cls / api / sbAuth etc. by
// bare name. They get the React import PLUS a destructure block that
// snapshots the shared symbols off window at module-load time. The order
// in main.jsx guarantees those symbols are present by the time these
// files evaluate.
const featureFiles = [
  'js/billing/subscription-banner.jsx',
  'js/billing/upgrade-dialog.jsx',
  'js/ads-intel/settings-section.jsx',
  'js/ads-intel/ads-panels.jsx',
  'js/referral/panel.jsx',
  'js/team/panel.jsx',
  'js/support/panel.jsx',
  'js/webhooks/panel.jsx',
];

// Names that feature files commonly destructure from window. Unused names
// are harmless module-scope `undefined`s — they just sit there. The
// inclusive list spares us from per-file dependency analysis.
const SHARED_WINDOW_SYMBOLS = [
  // UI primitives + icons (from utilities.jsx)
  'cls', 'safeHref',
  'Card', 'Btn', 'Eyebrow', 'Plat',
  'Sparkline', 'BarSpark',
  'Pill', 'MashalDot', 'Progress',
  'StatCard', 'SectionHead', 'MashalLogo',
  'PlatformIcons', 'Icon',
  // Data layer (from js/core/data.jsx)
  'D', 'formatNum', 'platformLabel', 'platformBrand',
  'initialsOf', 'formatSync', 'hydrateD',
  // Core lib (from js/core/api.jsx, js/core/auth.jsx)
  'api', 'API_BASE',
  'sbAuth', 'SUPABASE_URL', 'SUPABASE_ANON',
  'restoreSession', 'checkMagicLinkHash',
  // Cross-feature panels
  'SubscriptionBanner', 'UpgradeDialog',
];

const PUBLISH_FOOTER_MARKER = '/* === SPA-BUNDLE-PUBLISH === */';

// ── Helpers ────────────────────────────────────────────────────────────────

function ensureReactImport(content) {
  if (/^import React\b/m.test(content.split('\n').slice(0, 3).join('\n'))) {
    return content;
  }
  return `import React from 'react';\n\n` + content;
}

function ensureWindowDestructure(content) {
  if (content.includes('const {') && content.includes('= window;')) {
    return content;
  }
  // Insert immediately after the React import we just added (or any existing
  // top-of-file imports).
  const lines = content.split('\n');
  let insertAt = 0;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (/^import\s/.test(lines[i])) insertAt = i + 1;
  }
  const block =
    `\n// Snapshot the shared symbols this file references off window.\n` +
    `// They are published there by src/spa/utilities.jsx and the js/core/*\n` +
    `// modules; src/spa/main.jsx guarantees the load order.\n` +
    `const {\n` +
    SHARED_WINDOW_SYMBOLS.map(s => `  ${s},`).join('\n') + '\n' +
    `} = window;\n`;
  lines.splice(insertAt, 0, block);
  return lines.join('\n');
}

// Extract every top-level `const | let | var | function | async function`
// declaration name from the file. Ignores indented declarations
// (those are inside functions, not module-level).
function topLevelNames(content) {
  const names = new Set();
  const re = /^(?:const|let|var|function|async\s+function)\s+(\w+)/gm;
  for (const m of content.matchAll(re)) names.add(m[1]);
  // Drop anything we deliberately don't want re-exposed (the destructure
  // block itself creates module-local `const cls, Card, ...` lines on
  // consumer files — utilities.jsx doesn't have those, but be defensive).
  for (const s of SHARED_WINDOW_SYMBOLS) names.delete(s);
  // Filter out lone-underscore-prefixed internals (private style strings,
  // helpers nobody else cares about). They'd be harmless to publish but
  // they'd also clutter window.
  return [...names].filter(n => !n.startsWith('_'));
}

function ensurePublishFooter(content) {
  if (content.includes(PUBLISH_FOOTER_MARKER)) return content;
  const names = topLevelNames(content);
  if (names.length === 0) return content;
  const footer =
    `\n\n${PUBLISH_FOOTER_MARKER}\n` +
    `// Push every top-level export of this module onto window so the rest\n` +
    `// of the SPA (other modules + any string-eval call sites) can keep\n` +
    `// using bare-name references exactly as it did under the script-tag\n` +
    `// concatenation model.\n` +
    `Object.assign(window, {\n` +
    names.map(n => `  ${n},`).join('\n') + '\n' +
    `});\n`;
  return content.trimEnd() + footer;
}

// ── Apply ──────────────────────────────────────────────────────────────────

let changed = 0;

for (const rel of coreFiles) {
  const p = path.join(repoRoot, rel);
  const before = fs.readFileSync(p, 'utf-8');
  const after = ensureReactImport(before);
  if (after !== before) {
    fs.writeFileSync(p, after);
    console.log(`  patched: ${rel} (React import)`);
    changed++;
  }
}

for (const rel of featureFiles) {
  const p = path.join(repoRoot, rel);
  const before = fs.readFileSync(p, 'utf-8');
  let after = ensureReactImport(before);
  after = ensureWindowDestructure(after);
  if (after !== before) {
    fs.writeFileSync(p, after);
    console.log(`  patched: ${rel} (React + window destructure)`);
    changed++;
  }
}

// utilities.jsx and screens.jsx — extract-spa-blocks.mjs already added the
// `import React` header. We only append the publish footer here.
// screens.jsx ALSO needs a window-destructure block so its inline blocks
// can reach utilities + js/core helpers by bare name.
for (const rel of ['src/spa/utilities.jsx', 'src/spa/screens.jsx']) {
  const p = path.join(repoRoot, rel);
  const before = fs.readFileSync(p, 'utf-8');
  let after = before;
  if (rel.endsWith('screens.jsx')) {
    after = ensureWindowDestructure(after);
  }
  after = ensurePublishFooter(after);
  if (after !== before) {
    fs.writeFileSync(p, after);
    console.log(`  patched: ${rel}`);
    changed++;
  }
}

console.log(`\nDone — ${changed} file(s) changed.`);
