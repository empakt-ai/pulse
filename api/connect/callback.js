// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// Generic OAuth callback handling for both Zernio and Google. The branded
// HTML it renders is light enough to template per-product later.
// ═════════════════════════════════════════════════════════════════════════
//
// OAuth landing page (rendered inside the popup that Zernio or Google redirects
// back to). Two modes:
//
//   1. Zernio bounce-back: ?platform=instagram (no code). Zernio already
//      handled token exchange server-side; we just render success.
//
//   2. Google OAuth callback: ?code=...&state=youtube|<workspace>|<exp>|<sig>.
//      We exchange the code for tokens, fetch the user's channel via
//      youtube.googleapis.com, insert into connected_accounts with the tokens
//      stored in metadata (jsonb), then render the same success page.
//
// In both cases, returns a small standalone HTML page that:
//   (a) posts {type:'pulse:connected', platform} to window.opener
//   (b) closes itself after 600ms

import { supabase } from '../_lib/supabase.js';
import { exchangeCode, getOwnChannel, verifyOAuthState } from '../_lib/youtube.js';

function esc(s) {
  return String(s || '').replace(/[<>&"']/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderError(res, title, detail) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html><head><title>Connection failed</title>
  <style>body{font-family:system-ui;background:#F5F1E8;color:#0A0A0B;padding:80px 20px;text-align:center}
  h1{font-size:22px;margin:0 0 10px}p{font-size:14px;color:#6F6B62;margin:0 0 24px}
  pre{font-size:11px;color:#9A958A;background:transparent;text-align:left;display:inline-block;max-width:520px;white-space:pre-wrap}
  a{color:#6B5BFF;text-decoration:none}</style></head>
  <body>
    <h1>${esc(title)}</h1>
    <p>${esc(detail || 'Try again from Settings.')}</p>
    <p><a href="${esc(process.env.APP_URL || 'https://karvan-pulse.vercel.app')}/#settings">Return to Pulse</a></p>
    <script>try{window.opener?.postMessage({type:'pulse:connect-failed',error:${JSON.stringify(detail || title)}}, '*');}catch(e){}
    setTimeout(function(){try{window.close()}catch(e){}}, 4000);</script>
  </body></html>`);
}

async function handleGoogleCallback(req, res, code, state) {
  const verified = verifyOAuthState(state);
  if (!verified) return renderError(res, 'Invalid or expired state', 'Sign-in link expired — try Connect again.');

  const appUrl = process.env.APP_URL || 'https://karvan-pulse.vercel.app';
  const redirectUri = `${appUrl}/api/connect/callback`;

  let tokens;
  try {
    tokens = await exchangeCode(code, redirectUri);
  } catch (e) {
    return renderError(res, 'Token exchange failed', e.message);
  }

  let channel;
  try {
    channel = await getOwnChannel(tokens.access_token);
  } catch (e) {
    return renderError(res, 'Could not read your YouTube channel', e.message);
  }
  if (!channel) return renderError(res, 'No YouTube channel found', 'Your Google account doesn\'t have a YouTube channel.');

  const expiresAt = Math.floor(Date.now() / 1000) + Number(tokens.expires_in || 3600);

  // Upsert into connected_accounts. We use the YouTube channel ID as
  // zernio_account_id (it's the unique external identifier we have for this
  // account, even though there's no Zernio profile involved for YT).
  try {
    const existing = await supabase.select('connected_accounts', {
      select: 'id',
      eq: { workspace_id: verified.workspaceId, zernio_account_id: channel.id },
    });
    const row = {
      workspace_id: verified.workspaceId,
      platform: 'youtube',
      zernio_account_id: channel.id,
      platform_username: channel.snippet?.customUrl || channel.snippet?.title || null,
      platform_user_id: channel.id,
      platform_name: channel.snippet?.title || null,
      followers: Number(channel.statistics?.subscriberCount || 0),
      verified: false,
      is_active: true,
      last_synced_at: new Date().toISOString(),
      metadata: {
        provider: 'google',
        channel_id: channel.id,
        uploads_playlist_id: channel.contentDetails?.relatedPlaylists?.uploads,
        total_views: Number(channel.statistics?.viewCount || 0),
        total_videos: Number(channel.statistics?.videoCount || 0),
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: expiresAt,
        scope: tokens.scope,
      },
    };
    if (existing?.length) {
      await supabase.update('connected_accounts', row, { eq: { id: existing[0].id } });
    } else {
      await supabase.insert('connected_accounts', row);
    }
  } catch (e) {
    return renderError(res, 'Could not save your channel', e.message);
  }

  // Fall through to success HTML below
  return null;
}

export default async function handler(req, res) {
  const appUrl = process.env.APP_URL || 'https://karvan-pulse.vercel.app';
  const code = req.query?.code;
  const state = req.query?.state;
  let platform = esc(req.query?.platform || 'account');

  // Google OAuth callback — has code+state but no platform query (we omit it
  // from redirect_uri because Google validates redirect_uri exactly).
  if (code && state) {
    const verified = verifyOAuthState(state);
    if (verified) platform = verified.provider; // 'youtube'
    const errResult = await handleGoogleCallback(req, res, code, state);
    if (errResult !== null && res.writableEnded) return; // renderError already wrote
  }

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
