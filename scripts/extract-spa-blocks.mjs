// One-shot migration helper — extracts the 18 inline `<script type="text/babel">`
// blocks out of index.html and lays them down as two .jsx files:
//
//   src/spa/utilities.jsx  — blocks before the external js/ src= tags (icons,
//                            data constants, Card/Btn/Pill, tweaks panel,
//                            Landing components — the stuff downstream blocks
//                            and js/ files depend on)
//   src/spa/screens.jsx    — blocks after the external js/ src= tags (Auth,
//                            Onboarding, TopBar, every dashboard screen, the
//                            App() root + ReactDOM mount)
//
// The split point is the first <script type="text/babel" src="..."> tag.
// Everything before it → utilities. Everything after → screens.
//
// Each output file gets the standard header:
//
//   import React from 'react';
//   // (no destructure needed for utilities.jsx — nothing's been declared yet)
//
// For screens.jsx we also pull every utility this codebase touches off of
// window (since utilities.jsx pushed them there in its trailing
// Object.assign(window, {...}) — added manually post-extraction).
//
// Run once with: node scripts/extract-spa-blocks.mjs
// Idempotent: overwrites the output files each time.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, '..');
const indexHtml = path.join(repoRoot, 'index.html');
const outDir    = path.join(repoRoot, 'src', 'spa');

fs.mkdirSync(outDir, { recursive: true });

const src = fs.readFileSync(indexHtml, 'utf-8');
const lines = src.split(/\r?\n/);

// Walk lines and capture (start, end, content) for every <script type="text/babel">
// block that has inline content (i.e. no src= attribute). External src= scripts
// are ignored — those are the js/ files which stay where they are on disk.
const blocks = [];
let i = 0;
while (i < lines.length) {
  const line = lines[i];
  // Match opening tag without src attribute.
  if (/^\s*<script\s+type="text\/babel"\s*>\s*$/.test(line)) {
    const start = i + 1; // 1-indexed line number where the opening tag sits
    let j = i + 1;
    while (j < lines.length && !/^\s*<\/script>\s*$/.test(lines[j])) j++;
    const end = j + 1; // 1-indexed line of closing tag
    const content = lines.slice(i + 1, j).join('\n');
    blocks.push({ start, end, content });
    i = j + 1;
    continue;
  }
  i++;
}

// Find the first external <script type="text/babel" src="js/..."> tag.
// Everything before it = utilities; at or after = screens.
const firstExternalIdx = lines.findIndex(l =>
  /^\s*<script\s+type="text\/babel"\s+src="js\//.test(l)
);
if (firstExternalIdx === -1) {
  throw new Error('No external js/ babel script found — load-order assumption broken');
}
const splitLine = firstExternalIdx + 1;

const utilities = blocks.filter(b => b.end < splitLine);
const screens   = blocks.filter(b => b.start > splitLine);

console.log(`Found ${blocks.length} inline babel blocks`);
console.log(`  Utilities: ${utilities.length} blocks (lines < ${splitLine})`);
console.log(`  Screens:   ${screens.length} blocks (lines > ${splitLine})`);

// Concatenate, with a banner per block showing its original line range —
// so future debugging can map back to the original index.html version.
function concat(blocks) {
  return blocks.map(b => {
    const banner =
      '// ' + '═'.repeat(73) + '\n' +
      `// Extracted from index.html lines ${b.start}-${b.end}\n` +
      '// ' + '═'.repeat(73) + '\n';
    return banner + b.content;
  }).join('\n\n');
}

const utilitiesHeader = `// ═════════════════════════════════════════════════════════════════════════
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

`;

const screensHeader = `// ═════════════════════════════════════════════════════════════════════════
// src/spa/screens.jsx — extracted from index.html's trailing inline
// <script type="text/babel"> blocks (everything AFTER the external js/
// src= tags). Defines: Auth, Onboarding, TopBar, AccountBar, every
// dashboard screen, and the App() root + ReactDOM mount call.
//
// Loaded AFTER utilities.jsx and the js/ feature files — references their
// exports as bare names (cls, Card, Btn, api, sbAuth, hydrateD, etc.) so
// they must already be in module scope by the time this file evaluates.
//
// Provenance: scripts/extract-spa-blocks.mjs.
// ═════════════════════════════════════════════════════════════════════════

import React from 'react';

`;

fs.writeFileSync(path.join(outDir, 'utilities.jsx'), utilitiesHeader + concat(utilities) + '\n');
fs.writeFileSync(path.join(outDir, 'screens.jsx'),   screensHeader   + concat(screens)   + '\n');

console.log(`\nWrote:`);
console.log(`  ${path.relative(repoRoot, path.join(outDir, 'utilities.jsx'))} (${utilities.length} blocks, ${utilities.reduce((s, b) => s + b.content.split('\n').length, 0)} lines)`);
console.log(`  ${path.relative(repoRoot, path.join(outDir, 'screens.jsx'))} (${screens.length} blocks, ${screens.reduce((s, b) => s + b.content.split('\n').length, 0)} lines)`);
