// One-shot migration helper — strips CDN React/ReactDOM/Babel and the
// inline `tailwind.config = {...}` block out of demo.html, leaving
// /css/marketing.css, the theme-persistence script, the demo-specific
// <style> block, the splash markup, and the page body untouched. Adds
// the Vite module entry that loads src/demo/main.jsx just before </body>.
//
// Idempotent.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, '..');
const target    = path.join(repoRoot, 'demo.html');

let html = fs.readFileSync(target, 'utf-8');
const before = html;

// 1. Tailwind CDN <script>. demo's inline tailwind.config is embedded
//    inside the same <script>tag that holds the theme-persistence IIFE,
//    so we strip just the CDN tag and clear the `tailwind.config = {…}`
//    assignment from the bigger <script> rather than nuking the whole
//    block (theme-persistence must survive).
html = html.replace(
  /<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>\s*\n?/,
  '',
);
html = html.replace(
  /\n\s*tailwind\.config\s*=\s*\{[\s\S]*?\}\s*;\s*\n/,
  '\n',
);

// 2. The three CDN <script>s for React, ReactDOM, and babel-standalone
//    — plus the comment header above them.
html = html.replace(
  /<!--\s*React 18 \+ Babel[\s\S]*?-->\s*<script[^>]*react@[\s\S]*?<\/script>\s*<script[^>]*react-dom@[\s\S]*?<\/script>\s*<script[^>]*@babel\/standalone[\s\S]*?<\/script>\s*\n?/,
  '',
);

// 3. Every inline <script type="text/babel"> block (demo has four).
html = html.replace(
  /<script\s+type="text\/babel"\s*>[\s\S]*?<\/script>\s*\n?/g,
  '',
);

// 4. Inject the Vite module entry just before </body>.
const moduleTag = `<script type="module" src="/src/demo/main.jsx"></script>\n`;
if (!html.includes(moduleTag.trim())) {
  html = html.replace(/<\/body>/, moduleTag + '</body>');
}

if (html === before) {
  console.log('demo.html already migrated — no changes.');
} else {
  fs.writeFileSync(target, html);
  const deltaLines = before.split('\n').length - html.split('\n').length;
  console.log(`Wrote demo.html — removed ${deltaLines} lines, added Vite module entry.`);
}
