// One-shot diagnostic — opens /demo in a real Chromium, collects every
// console message + page error + failed network request, snapshots
// what's rendered, and screenshots each persona view.
//
// /demo now routes to /index.html (the main SPA) and the SPA's
// demo-mode bootstrap takes over. So we're testing the integrated
// experience, not the old standalone demo.html.

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE   = 'http://127.0.0.1:4173';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const logs = [];
  page.on('console',  msg => logs.push({ kind: 'console', type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => logs.push({ kind: 'pageerror', text: err.stack || err.message }));
  page.on('requestfailed', req => logs.push({ kind: 'requestfailed', url: req.url(), reason: req.failure()?.errorText }));
  // Capture window.onerror + unhandledrejection too — React 18 sometimes
  // catches render errors in a way that doesn't bubble to puppeteer's
  // 'pageerror' event but still logs to console.
  await page.evaluateOnNewDocument(() => {
    window.addEventListener('error', e => {
      console.warn('__caught_error', e.message, e.filename + ':' + e.lineno);
    });
    window.addEventListener('unhandledrejection', e => {
      console.warn('__caught_rejection', String(e.reason));
    });
  });

  // First load — landing at /demo (Creator default).
  const resp = await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle0', timeout: 20000 });
  await new Promise(r => setTimeout(r, 2500));

  const status   = resp ? resp.status() : '(no response)';
  const url      = page.url();
  const dataReady = await page.evaluate(() => document.documentElement.getAttribute('data-ready'));
  const splashGone = await page.evaluate(() => {
    const s = document.getElementById('pulse-splash');
    return s ? getComputedStyle(s).opacity : '(no splash node)';
  });
  const rootChildCount = await page.evaluate(() => (document.getElementById('root')?.children?.length ?? -1));
  const demoMode = await page.evaluate(() => !!window.__MASHAL_DEMO_MODE);
  const demoState = await page.evaluate(() => window.__demoGetState ? window.__demoGetState() : null);
  const visibleText = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400));

  console.log('── /demo first load ──');
  console.log('  HTTP:', status, '· final URL:', url);
  console.log('  __MASHAL_DEMO_MODE:', demoMode);
  console.log('  __demoGetState:', demoState ? `persona=${demoState.personaId} workspace=${demoState.workspaceId} lang=${demoState.briefLang}` : '(undefined)');
  console.log('  html[data-ready]:', dataReady, '· splash opacity:', splashGone);
  console.log('  #root child count:', rootChildCount);
  console.log('  body.innerText[0..400]:', JSON.stringify(visibleText));

  console.log('── Console / pageerror / requestfailed ──');
  if (logs.length === 0) {
    console.log('  (none)');
  } else {
    for (const l of logs) {
      if (l.kind === 'pageerror') console.log(`  [pageerror] ${l.text}`);
      else if (l.kind === 'requestfailed') console.log(`  [requestfailed] ${l.url} — ${l.reason}`);
      else console.log(`  [console.${l.type}] ${l.text.slice(0, 300)}`);
    }
  }

  // Dump the brief that demo-mode published, plus what D actually got.
  const debug = await page.evaluate(() => {
    const brief = window.__demoGetActiveBrief ? window.__demoGetActiveBrief() : null;
    const D = window.D || null;
    return {
      briefKeys: brief ? Object.keys(brief) : null,
      briefState: brief?.state,
      briefVerdictType: typeof brief?.verdict,
      briefVerdictSample: brief?.verdict ? JSON.stringify(brief.verdict).slice(0, 120) : null,
      D_workspace: D?.workspace,
      D_user: D?.user,
      D_accountsKeys: D?.accounts ? Object.keys(D.accounts) : null,
      D_verdict: D?.verdict ? JSON.stringify(D.verdict).slice(0, 120) : null,
      D_actionPlanLen: D?.actionPlan?.length,
      D_connectedPlatforms: D?.connectedPlatforms,
    };
  });
  console.log('── window debug ──');
  for (const [k, v] of Object.entries(debug)) console.log(`  ${k}: ${JSON.stringify(v)}`);

  // Screenshot each persona on the Brief tab (default tab).
  const shots = [
    { name: 'creator',  url: `${BASE}/demo?persona=creator` },
    { name: 'pro',      url: `${BASE}/demo?persona=pro_creator` },
    { name: 'brand-en', url: `${BASE}/demo?persona=brand` },
    { name: 'brand-ar', url: `${BASE}/demo?persona=brand&lang=ar` },
    { name: 'agency',   url: `${BASE}/demo?persona=agency` },
  ];
  fs.mkdirSync('tmp-shots', { recursive: true });
  for (const s of shots) {
    await page.goto(s.url, { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2500));
    const state = await page.evaluate(() => {
      const D = window.D;
      return {
        state: window.__demoGetState ? window.__demoGetState() : null,
        D_accountsCount: D?.accounts ? Object.keys(D.accounts).filter(k => D.accounts[k].followers > 0).length : 0,
        D_connectedPlatforms: D?.connectedPlatforms,
        D_user_firstName: D?.user?.firstName,
        body_first_120: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
      };
    });
    await page.screenshot({ path: `tmp-shots/demo-${s.name}.png`, fullPage: true });
    console.log(`  shot: tmp-shots/demo-${s.name}.png  ${JSON.stringify(state)}`);
  }
} finally {
  await browser.close();
}
