// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Headless-Chromium PDF rendering on Vercel Functions. Uses
// @sparticuz/chromium for the binary (Vercel-compatible Linux build) and
// puppeteer-core to drive it. Idle browsers are slow to launch — ~2s cold
// start — so the function timeout in vercel.json (60s) is the upper bound
// per render. Pages stay under 5s typically.
// ═════════════════════════════════════════════════════════════════════════

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export async function renderPdfFromHtml(html, { format = 'A4', landscape = true } = {}) {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    // 'networkidle0' is overkill for an inline HTML doc — 'load' is enough.
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
    // emulateMediaType('print') makes @page rules + print stylesheet apply.
    await page.emulateMediaType('print');
    const buffer = await page.pdf({
      format,
      landscape,
      printBackground: true,
      preferCSSPageSize: true,
    });
    return buffer;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
