// One-shot migration helper — rewrites admin.html to drop the CDN-loaded
// React/Babel and inline Tailwind config, and to add the Vite module
// entry that loads the extracted src/admin/main.jsx. Mirrors what
// strip-spa-html.mjs does for index.html, but simpler since admin has
// only a single inline babel block and no external js/ src= scripts.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, '..');
const target    = path.join(repoRoot, 'admin.html');

let html = fs.readFileSync(target, 'utf-8');
const before = html;

// 1. Tailwind CDN + the inline `tailwind.config = {...}` script.
html = html.replace(
  /<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>\s*<script>\s*tailwind\.config\s*=\s*\{[\s\S]*?\}\s*;?\s*<\/script>\s*\n?/,
  '',
);

// 2. The three unpkg CDN <script>s for React, ReactDOM, and babel-standalone.
html = html.replace(
  /<script[^>]*react@[\s\S]*?<\/script>\s*<script[^>]*react-dom@[\s\S]*?<\/script>\s*<script[^>]*@babel\/standalone[\s\S]*?<\/script>\s*\n?/,
  '',
);

// 3. The inline babel block (admin has exactly one).
html = html.replace(
  /<script\s+type="text\/babel"\s*>[\s\S]*?<\/script>\s*\n?/,
  '',
);

// 4. Inject the Vite module entry just before </body>. Idempotent.
const moduleTag = `<script type="module" src="/src/admin/main.jsx"></script>\n`;
if (!html.includes(moduleTag.trim())) {
  html = html.replace(/<\/body>/, moduleTag + '</body>');
}

if (html === before) {
  console.log('admin.html already migrated — no changes.');
} else {
  fs.writeFileSync(target, html);
  const deltaLines = before.split('\n').length - html.split('\n').length;
  console.log(`Wrote admin.html — removed ${deltaLines} lines, added Vite module entry.`);
}
