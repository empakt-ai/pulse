// One-shot migration helper — slices the single inline
// <script type="text/babel"> block out of admin.html and writes it as
// src/admin/main.jsx with the React + ReactDOM imports + the admin
// stylesheet import prepended.
//
// admin.html (pre-migration) is a self-contained SPA — its inline block
// defines its own sbAuth/sbHeaders helpers, has no dependency on the
// main SPA's utilities.jsx, and ends with its own ReactDOM mount call.
// So unlike index.html (which had to split into utilities vs screens),
// this is a clean one-file extraction.
//
// Idempotent — re-running overwrites src/admin/main.jsx.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, '..');
const target    = path.join(repoRoot, 'admin.html');
const outFile   = path.join(repoRoot, 'src', 'admin', 'main.jsx');

fs.mkdirSync(path.dirname(outFile), { recursive: true });

const html = fs.readFileSync(target, 'utf-8');
const lines = html.split(/\r?\n/);

const startIdx = lines.findIndex(l => /^\s*<script\s+type="text\/babel"\s*>\s*$/.test(l));
if (startIdx === -1) throw new Error('admin.html: no inline babel block found');

let endIdx = -1;
for (let i = startIdx + 1; i < lines.length; i++) {
  if (/^\s*<\/script>\s*$/.test(lines[i])) { endIdx = i; break; }
}
if (endIdx === -1) throw new Error('admin.html: babel block missing closing </script>');

const body = lines.slice(startIdx + 1, endIdx).join('\n');

const header = `// ═════════════════════════════════════════════════════════════════════════
// src/admin/main.jsx — Mashal Admin Console SPA entry.
//
// Extracted from the single inline <script type="text/babel"> block
// that lived in admin.html lines ${startIdx + 1}-${endIdx + 1} before the
// Vite migration. Pure 1:1 lift; the React + ReactDOM imports below
// replace the unpkg CDN script tags that used to load them.
//
// Independent of the main Mashal SPA — own React tree, own auth helpers,
// own Tailwind config (via src/styles/admin.css).
// ═════════════════════════════════════════════════════════════════════════

import React from 'react';
import ReactDOM from 'react-dom/client';

// Expose globally so any string-eval / console debugging keeps working
// the way it did under the CDN-loaded React.
window.React = React;
window.ReactDOM = ReactDOM;

import '../styles/admin.css';

`;

fs.writeFileSync(outFile, header + body + '\n');
console.log(`Wrote ${path.relative(repoRoot, outFile)} (${body.split('\n').length} lines extracted from admin.html lines ${startIdx + 1}-${endIdx + 1})`);
