// Post-build helper — copies every static asset that Vite does NOT
// process (marketing HTML pages, /css/, /js/marketing.js, /images/,
// PWA manifest, service worker, robots.txt, sitemap.xml) into dist/
// so Vercel can serve them when outputDirectory is set to "dist".
//
// Vite owns index.html and admin.html (declared as rollupOptions.input).
// Everything else needs to land in dist/ via this script.
//
// Why a copy step instead of more Vite entries:
//   - Marketing HTML pages reference /css/marketing.css and
//     /js/marketing.js by absolute path. Making them Vite entries would
//     force Vite to resolve those references as public assets — which
//     means moving the files into public/, changing git history, and
//     touching every <link> across 16 pages. The copy step keeps the
//     existing layout untouched.
//   - Marketing HTML embeds JSON-LD, OG metadata, and font preconnects
//     that Vite would parse unnecessarily.
//   - api/* serverless functions are auto-detected by Vercel at repo
//     root regardless of outputDirectory, so they need no handling here.
//
// Idempotent — safe to re-run. Existing dist/ files are overwritten.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, '..');
const distDir   = path.join(repoRoot, 'dist');

// Vite-owned HTML entries — already produced by `vite build`, must not
// be overwritten by the copy pass.
const VITE_OWNED_HTML = new Set(['index.html', 'admin.html', 'demo.html']);

function copyFile(srcAbs, destAbs) {
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.copyFileSync(srcAbs, destAbs);
}

function copyDir(srcAbs, destAbs) {
  for (const entry of fs.readdirSync(srcAbs, { withFileTypes: true })) {
    const s = path.join(srcAbs, entry.name);
    const d = path.join(destAbs, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else copyFile(s, d);
  }
}

let n = 0;

// Marketing HTML at repo root (every *.html except the Vite-owned entries).
for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (!entry.name.endsWith('.html')) continue;
  if (VITE_OWNED_HTML.has(entry.name)) continue;
  copyFile(path.join(repoRoot, entry.name), path.join(distDir, entry.name));
  n++;
}

// Directories that copy wholesale.
for (const rel of ['compare', 'css', 'images']) {
  const src = path.join(repoRoot, rel);
  if (!fs.existsSync(src)) continue;
  copyDir(src, path.join(distDir, rel));
}

// Single static files at repo root (don't bulk-copy root — would pull
// node_modules, .git, etc.). Add new ones to this list as needed.
const ROOT_STATIC_FILES = [
  'sw.js',
  'manifest.webmanifest',
  'robots.txt',
  'sitemap.xml',
];

for (const rel of ROOT_STATIC_FILES) {
  const src = path.join(repoRoot, rel);
  if (!fs.existsSync(src)) continue;
  copyFile(src, path.join(distDir, rel));
  n++;
}

// The legacy marketing toggle script — vanilla JS, not part of the SPA
// bundle. Marketing HTML loads it directly via <script src="/js/marketing.js">.
const marketingJs = path.join(repoRoot, 'js', 'marketing.js');
if (fs.existsSync(marketingJs)) {
  copyFile(marketingJs, path.join(distDir, 'js', 'marketing.js'));
  n++;
}

console.log(`Copied ${n} root-level file(s) + compare/, css/, images/ trees to dist/`);
