// OAuth landing page (rendered inside the popup that Zernio redirects back to).
//
// Was a 302 → SPA, which made the popup load the full app and look like a
// connect-loop. Now returns a small standalone page that:
//   (a) posts {type:'pulse:connected', platform} to window.opener
//   (b) closes itself after 600ms
// The opener (main window) listens for that message and re-runs /accounts/sync
// immediately instead of waiting for the next 2s poll.

function esc(s) {
  return String(s || '').replace(/[<>&"']/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default function handler(req, res) {
  const appUrl = process.env.APP_URL || 'https://karvan-pulse.vercel.app';
  const platform = esc(req.query?.platform || 'account');
  const platformLabel = {
    instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube',
    facebook: 'Facebook', linkedin: 'LinkedIn', x: 'X', snapchat: 'Snapchat',
  }[platform] || platform;

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Connected — Pulse</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700&family=Geist:wght@400;500&display=swap" rel="stylesheet" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #F5F1E8; color: #0A0A0B;
    font-family: 'Geist', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  .wrap { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 32px; }
  .card { max-width: 360px; text-align: center; }
  .check { width: 64px; height: 64px; margin: 0 auto 24px; border-radius: 18px;
    background: #D6FF3E; display: inline-flex; align-items: center; justify-content: center; }
  h1 { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-weight: 700;
    font-size: 28px; line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 10px; }
  p { font-size: 14px; color: #6F6B62; margin: 0; }
  .small { font-size: 12px; color: #9A958A; margin-top: 28px; }
  a { color: #6B5BFF; text-decoration: none; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="check">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0A0A0B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 13l4 4L19 7"/>
        </svg>
      </div>
      <h1>${platformLabel} connected.</h1>
      <p>Closing this window…</p>
      <p class="small">If it doesn't close on its own, <a href="${appUrl}/#settings">return to Pulse</a>.</p>
    </div>
  </div>
<script>
(function () {
  var platform = ${JSON.stringify(platform)};
  // Tell the opener (main app) that the OAuth round trip succeeded so it
  // can sync accounts immediately instead of waiting for the next 2s poll.
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'pulse:connected', platform: platform }, '*');
    }
  } catch (e) {}

  // Close — give the message a moment to dispatch on slower hardware.
  setTimeout(function () {
    try { window.close(); } catch (e) {}
  }, 600);

  // Fallback if the browser blocks window.close (rare): redirect the popup to
  // the main app after 3s so the user isn't stranded on a blank-looking page.
  setTimeout(function () {
    if (!window.closed) {
      window.location.href = ${JSON.stringify(appUrl)} + '/#settings';
    }
  }, 3000);
})();
</script>
</body>
</html>`);
}
