// One-shot diagnostic — opens the locally-served /demo page in a real
// Chromium, collects every console message + page error + failed
// network request, and prints a concise report so we can see why the
// page mounts empty without playing 20-questions over chat.
//
// Usage: node scripts/diagnose-demo.mjs

import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL    = 'http://127.0.0.1:4173/demo.html';

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

  const resp = await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
  const status = resp ? resp.status() : '(no response)';

  // Wait a beat for any post-mount React work to settle.
  await new Promise(r => setTimeout(r, 1200));

  const rootChildCount = await page.evaluate(() => {
    const root = document.getElementById('root');
    return root ? root.children.length : -1;
  });
  const rootInnerSnippet = await page.evaluate(() => {
    const root = document.getElementById('root');
    return root ? (root.innerHTML || '').slice(0, 240) : '(no #root)';
  });
  const dataReady = await page.evaluate(() => document.documentElement.getAttribute('data-demo-ready'));
  const bodyVisibleText = await page.evaluate(() => (document.body.innerText || '').slice(0, 300));

  console.log('── HTTP ──');
  console.log('  status:', status);
  console.log('── Splash state ──');
  console.log('  html[data-demo-ready]:', dataReady);
  console.log('── React root ──');
  console.log('  #root child count:', rootChildCount);
  console.log('  #root innerHTML[0..240]:', rootInnerSnippet);
  console.log('── Body visible text[0..300] ──');
  console.log('  ', JSON.stringify(bodyVisibleText));
  console.log('── Console / pageerror / requestfailed ──');
  if (logs.length === 0) console.log('  (none)');
  for (const l of logs) {
    if (l.kind === 'pageerror') console.log(`  [pageerror] ${l.text.split('\n').slice(0, 5).join(' | ')}`);
    else if (l.kind === 'requestfailed') console.log(`  [requestfailed] ${l.url} — ${l.reason}`);
    else if (l.type === 'error' || l.type === 'warning') console.log(`  [console.${l.type}] ${l.text}`);
    else console.log(`  [console.${l.type}] ${l.text.slice(0, 200)}`);
  }
  // Screenshot each persona's brief view + the stats view for one tier
  // so we have visual evidence of what actually renders.
  const shots = [
    { name: 'brand-brief-en', q: '?persona=brand&screen=brief' },
    { name: 'brand-brief-ar', q: '?persona=brand&screen=brief&lang=ar' },
  ];
  for (const s of shots) {
    await page.goto(URL + s.q, { waitUntil: 'networkidle0', timeout: 15000 });
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: `./tmp-demo-${s.name}.png`, fullPage: true });
    console.log(`  shot: tmp-demo-${s.name}.png`);
  }
} finally {
  await browser.close();
}
