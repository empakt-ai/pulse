// One-shot helper — removes "Demo" links from marketing HTML nav +
// footer across all 9 marketing pages, and drops the /demo entry from
// sitemap.xml. Leaves the demo machinery itself intact (vercel.json
// rewrite, src/spa/demo-mode.jsx, PERSONAS data) so we can re-expose
// the link with one revert once the demo's Settings-screen gating is
// finished.
//
// Run with: node scripts/hide-demo-links.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, '..');

const marketingHtml = [
  'about.html', 'contact.html', 'features.html', 'integrations.html',
  'pricing.html', 'privacy.html', 'stack.html', 'terms.html', 'updates.html',
];

let touched = 0;

for (const rel of marketingHtml) {
  const p = path.join(repoRoot, rel);
  let html = fs.readFileSync(p, 'utf-8');
  const before = html;

  // Primary nav: <a href="/demo">Demo</a> on its own line (with leading
  // whitespace) — drop the entire line including the newline.
  html = html.replace(/^\s*<a href="\/demo">Demo<\/a>\r?\n/m, '');

  // Footer Product list: an inline <li><a href="/demo">Demo</a></li> sits
  // between Pricing and Updates. Drop the <li> only.
  html = html.replace(/<li><a href="\/demo">Demo<\/a><\/li>/g, '');

  if (html !== before) {
    fs.writeFileSync(p, html);
    console.log(`  patched: ${rel}`);
    touched++;
  }
}

// Sitemap entry. Remove the entire <url>...</url> block for /demo so
// search engines stop crawling/indexing it while it's a known issue.
const sitemapPath = path.join(repoRoot, 'sitemap.xml');
const sitemap = fs.readFileSync(sitemapPath, 'utf-8');
const next = sitemap.replace(
  /\s*<url>\s*<loc>https:\/\/mashal\.app\/demo<\/loc>[\s\S]*?<\/url>/,
  '',
);
if (next !== sitemap) {
  fs.writeFileSync(sitemapPath, next);
  console.log('  patched: sitemap.xml');
  touched++;
}

console.log(`\nDone — ${touched} file(s) patched.`);
