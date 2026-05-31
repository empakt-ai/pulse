// One-shot migration helper — same pattern as extract-spa-blocks.mjs but
// for demo.html. Concatenates the four inline <script type="text/babel">
// blocks (lines ~202-1573) into src/demo/main.jsx with the React +
// ReactDOM imports prepended.
//
// demo.html is its own SPA — own React tree, own mount call, own state.
// Doesn't share modules with the main SPA, so the concatenated bundle is
// self-contained and doesn't need the window-bridge pattern that
// src/spa/* uses for cross-module references.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, '..');
const target    = path.join(repoRoot, 'demo.html');
const outFile   = path.join(repoRoot, 'src', 'demo', 'main.jsx');

fs.mkdirSync(path.dirname(outFile), { recursive: true });

const html = fs.readFileSync(target, 'utf-8');
const lines = html.split(/\r?\n/);

// Capture every inline <script type="text/babel"> block with its line
// range so the generated file's section headers can map back to source.
const blocks = [];
let i = 0;
while (i < lines.length) {
  if (/^\s*<script\s+type="text\/babel"\s*>\s*$/.test(lines[i])) {
    const start = i + 1;
    let j = i + 1;
    while (j < lines.length && !/^\s*<\/script>\s*$/.test(lines[j])) j++;
    blocks.push({ start, end: j + 1, content: lines.slice(i + 1, j).join('\n') });
    i = j + 1;
    continue;
  }
  i++;
}

if (blocks.length === 0) throw new Error('demo.html: no inline babel blocks found');

const header = `// ═════════════════════════════════════════════════════════════════════════
// src/demo/main.jsx — Mashal Demo Page SPA entry.
//
// Concatenated 1:1 from the ${blocks.length} inline <script type="text/babel">
// blocks that lived in demo.html before the Vite migration. Independent
// of the main SPA and the admin SPA — own React tree, own mount, own
// state. Theme persistence, /css/marketing.css link, and demo-specific
// <style> rules stay inline in demo.html.
//
// Provenance: scripts/extract-demo-blocks.mjs.
// ═════════════════════════════════════════════════════════════════════════

import React from 'react';
import ReactDOM from 'react-dom/client';

// Expose globally for any string-eval / console-debug call sites.
window.React = React;
window.ReactDOM = ReactDOM;

`;

const body = blocks.map(b => {
  const banner =
    '// ' + '─'.repeat(73) + '\n' +
    `// Extracted from demo.html lines ${b.start}-${b.end}\n` +
    '// ' + '─'.repeat(73) + '\n';
  return banner + b.content;
}).join('\n\n');

fs.writeFileSync(outFile, header + body + '\n');
console.log(`Wrote ${path.relative(repoRoot, outFile)} (${blocks.length} blocks, ${body.split('\n').length} lines)`);
