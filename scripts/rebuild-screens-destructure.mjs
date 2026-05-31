// Repair pass — regenerates the `const { ... } = window;` block at the top
// of src/spa/screens.jsx so it pulls EVERY symbol published by upstream
// modules off window. The first pass of finalize-spa-bundle.mjs gave
// screens.jsx a hand-picked SHARED_WINDOW_SYMBOLS list, which missed many
// names (TeamPanel, AdsIntelComparePanel, Landing, Pricing, Footer, …)
// that the App() router references. They blow up with ReferenceError at
// runtime in the production bundle.
//
// Source of truth for "what's on window": every `Object.assign(window, {…})`
// trailer in utilities.jsx + every js/**/*.jsx feature file. We harvest
// those names, dedupe, drop the ones screens.jsx defines itself, and
// rewrite the destructure block in place.
//
// Run with: node scripts/rebuild-screens-destructure.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, '..');

const sources = [
  'src/spa/utilities.jsx',
  'js/core/auth.jsx',
  'js/core/api.jsx',
  'js/core/data.jsx',
  'js/billing/subscription-banner.jsx',
  'js/billing/upgrade-dialog.jsx',
  'js/ads-intel/settings-section.jsx',
  'js/ads-intel/ads-panels.jsx',
  'js/referral/panel.jsx',
  'js/team/panel.jsx',
  'js/support/panel.jsx',
  'js/webhooks/panel.jsx',
];

// Globals we MUST NOT destructure off window — doing so shadows the
// builtin/runtime binding inside the module and breaks everything that
// uses it. This list isn't exhaustive (JavaScript has many globals), but
// it covers the ones a SPA realistically touches.
const FORBIDDEN_DESTRUCTURE = new Set([
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Math', 'Date', 'JSON',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Error',
  'RegExp', 'Function', 'Proxy', 'Reflect',
  'window', 'document', 'globalThis', 'self', 'console',
  'fetch', 'localStorage', 'sessionStorage', 'navigator', 'location',
  'history', 'URL', 'URLSearchParams', 'FormData', 'Headers', 'Request',
  'Response', 'AbortController', 'IntersectionObserver', 'MutationObserver',
  'React', 'ReactDOM',
]);

// Match every `Object.assign(window, { … })` trailer and collect the
// property keys inside the object literal. Strips comments first so
// identifiers inside comments don't end up as fake exports, and only
// captures the leading identifier of each comma-separated entry so
// shorthand (`Foo,`) and `key: value` both yield just `Foo`.
function harvest(content) {
  const names = new Set();
  const re = /Object\.assign\(\s*window\s*,\s*\{([\s\S]*?)\}\s*\)/g;
  for (const m of content.matchAll(re)) {
    let body = m[1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const entry of body.split(',')) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const head = trimmed.match(/^([A-Za-z_$][\w$]*)/);
      if (head && !FORBIDDEN_DESTRUCTURE.has(head[1])) names.add(head[1]);
    }
  }
  return names;
}

const published = new Set();
for (const rel of sources) {
  const txt = fs.readFileSync(path.join(repoRoot, rel), 'utf-8');
  for (const n of harvest(txt)) published.add(n);
}

// Top-level declarations IN screens.jsx itself — must NOT appear in
// its own destructure block (would cause "already declared" errors
// from the bundler, the same trap we hit on subscription-banner.jsx).
function topLevelDecls(content) {
  const names = new Set();
  const re = /^(?:const|let|var|function|async\s+function)\s+(\w+)/gm;
  for (const m of content.matchAll(re)) names.add(m[1]);
  return names;
}

const screensPath = path.join(repoRoot, 'src', 'spa', 'screens.jsx');
const screensBefore = fs.readFileSync(screensPath, 'utf-8');
const screensOwn = topLevelDecls(screensBefore);

// Final destructure list: everything published, minus what screens
// declares itself. React stays out (already imported by name).
const finalNames = [...published]
  .filter(n => !screensOwn.has(n))
  .filter(n => n !== 'React') // module import, not a window destructure
  .sort();

// Replace the existing destructure block — it's the first
// `const { … } = window;` in the file.
const blockRe = /const\s*\{[\s\S]*?\}\s*=\s*window;\s*\n/;
const newBlock =
  `const {\n` +
  finalNames.map(n => `  ${n},`).join('\n') + '\n' +
  `} = window;\n`;

if (!blockRe.test(screensBefore)) {
  throw new Error('No existing `const { … } = window;` block found in screens.jsx');
}

const screensAfter = screensBefore.replace(blockRe, newBlock);

if (screensAfter === screensBefore) {
  console.log('screens.jsx destructure unchanged.');
} else {
  fs.writeFileSync(screensPath, screensAfter);
  console.log(`Rewrote screens.jsx destructure with ${finalNames.length} names from window.`);
  console.log('  ' + finalNames.join(', '));
}
