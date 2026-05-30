// One-shot migration helper — rewrites index.html so it loads the Vite
// bundle instead of pulling React, ReactDOM, Babel, and Tailwind off
// CDNs and compiling 8000 lines of inline JSX in the browser.
//
// What this script removes from index.html:
//   - <script src="https://cdn.tailwindcss.com">…</script>
//   - The inline `tailwind.config = {...}` <script> block (now lives in
//     tailwind.config.js)
//   - The three unpkg <script>s for React, ReactDOM, and babel-standalone
//   - The wrapping `<!-- React + Babel -->` comment block
//   - Every external `<script type="text/babel" src="js/…">` tag (those
//     files are now imported by src/spa/main.jsx)
//   - Every inline `<script type="text/babel">…</script>` block (their
//     contents are now in src/spa/utilities.jsx and src/spa/screens.jsx)
//
// What this script adds:
//   - `<script type="module" src="/src/spa/main.jsx"></script>` just
//     before the closing </body> tag — Vite picks this up as the SPA
//     entry and handles both dev-server injection and production
//     bundling (CSS link tag for src/styles/app.css gets injected by
//     Vite automatically because main.jsx imports it).
//
// What this script leaves UNTOUCHED:
//   - Every other <script> block — splash overlay logic, theme-flash
//     prevention, service-worker registration, and the diagnostic panel
//     that watches for failed mounts. Step 7 simplifies the diagnostic
//     panel separately.
//   - The <style> rules, Open Graph / JSON-LD metadata, the splash
//     overlay markup, everything else in the document.
//
// Idempotent — running it on an already-migrated index.html is a no-op
// because the CDN/inline-babel markers will no longer match.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, '..');
const target    = path.join(repoRoot, 'index.html');

let html = fs.readFileSync(target, 'utf-8');
const before = html;

// 1. Tailwind CDN + the inline `tailwind.config = {...}` script.
html = html.replace(
  /<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>\s*<script>\s*tailwind\.config\s*=\s*\{[\s\S]*?\}\s*<\/script>\s*\n?/,
  '',
);

// 2. The wrapping `<!-- React + Babel -->` comment block (multi-line)
//    followed by the three unpkg <script>s. Captures the leading comment
//    so the resulting file doesn't keep an orphaned "React + Babel" note.
html = html.replace(
  /<!--\s*React \+ Babel\s*-->\s*<!--[\s\S]*?-->\s*<script[^>]*react@[\s\S]*?<\/script>\s*<script[^>]*react-dom@[\s\S]*?<\/script>\s*<script[^>]*@babel\/standalone[\s\S]*?<\/script>\s*\n?/,
  '',
);

// 3. External babel src= tags (the 11 js/ files now imported by main.jsx).
html = html.replace(
  /<script\s+type="text\/babel"\s+src="js\/[^"]+"><\/script>\s*\n?/g,
  '',
);

// 4. Inline babel <script> blocks. Non-greedy match — each block is
//    self-contained between its own open and close tag.
html = html.replace(
  /<script\s+type="text\/babel"\s*>[\s\S]*?<\/script>\s*\n?/g,
  '',
);

// 5. Pre-load order comment that's now stale ("Order matters: utilities
//    → icons → data → tweaks → screens → app"). Leaves the comment if
//    the marker isn't found.
html = html.replace(
  /<!--\s*Order matters:[\s\S]*?-->\s*\n?/,
  '',
);

// 6. Inject the Vite entry just before </body>. Idempotent — bail if it
//    is already present.
const moduleTag = `<script type="module" src="/src/spa/main.jsx"></script>\n`;
if (!html.includes(moduleTag.trim())) {
  html = html.replace(/<\/body>/, moduleTag + '</body>');
}

if (html === before) {
  console.log('index.html already migrated — no changes.');
} else {
  fs.writeFileSync(target, html);
  const deltaLines = before.split('\n').length - html.split('\n').length;
  console.log(`Wrote index.html — removed ${deltaLines} lines, added Vite module entry.`);
}
