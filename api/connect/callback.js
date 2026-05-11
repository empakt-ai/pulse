// OAuth landing — Zernio handles the actual token exchange.
// We just bounce the user back into the SPA with a flag.

export default function handler(req, res) {
  const appUrl = process.env.APP_URL || 'https://karvan-pulse.vercel.app';
  const platform = req.query?.platform || '';
  const params = new URLSearchParams({ connected: 'true' });
  if (platform) params.set('platform', platform);
  res.statusCode = 302;
  res.setHeader('Location', `${appUrl}/#settings?${params.toString()}`);
  res.end();
}
