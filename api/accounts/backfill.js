// ═════════════════════════════════════════════════════════════════════════
// [PULSE-SPECIFIC] One-shot historic backfill via Apify for an own account.
//
// Zernio only serves analytics from the moment an account is connected,
// which leaves brand-new workspaces with no history for the Brief, Growth,
// Content, Targets and Intelligence layers to reason about. Apify scrapers
// can pull the last ~50-100 public posts off any public profile, so we
// expose this as a deliberate opt-in: the user clicks "Backfill history"
// on a connected account in Settings, we scrape, we upsert into posts
// with source='own', and we stamp connected_accounts.historic_backfilled_at
// so the action can't run twice.
//
//   POST /api/accounts/backfill  { accountId }
//     → { ok, fetched, persisted, cost_cents, errors? }
//     → 402 if tier doesn't include backfill
//     → 409 if already backfilled
//     → 404 if account not found or not the caller's
// ═════════════════════════════════════════════════════════════════════════

import { authenticate, json, trialLockoutEnvelope } from '../_lib/auth.js';
import { supabase } from '../_lib/supabase.js';
import { runActor, estimateScrapeCost } from '../_lib/apify.js';
import { scrapeChannel as scrapeYouTubeChannel } from '../_lib/youtube.js';
import { TRIAL_LIMITS } from '../_lib/tiers.js';

// How deep we go on a backfill. Apify actors top out around 100-200 posts
// on a single sync run before timeouts bite; 100 is the practical sweet
// spot for cost + reliability across IG/TikTok/FB. During trial we drop
// to TRIAL_LIMITS.backfill_posts (10) — enough to populate a few stat
// cards but a real differentiator on upgrade.
const BACKFILL_LIMIT = 100;

// Engagement-rate helpers — match sync.js so backfilled posts get the same
// signal classification as everything else.
function engagementRate(p) {
  const views = Number(p.views || p.impressions || 0);
  if (!views) return null;
  const eng = Number(p.likes || 0) + Number(p.comments || 0) + Number(p.saves || 0) + Number(p.shares || 0);
  return Math.round((eng / views) * 10000) / 100;
}
function signalFor(rate) {
  if (rate == null) return null;
  if (rate >= 12) return 'viral';
  if (rate >= 6)  return 'rising';
  if (rate >= 2)  return 'steady';
  return 'declining';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  // Locked trials lose access to backfill; active trials get a shallower
  // pull. Both branches still upsert with source='own' — same schema.
  const locked = trialLockoutEnvelope(ws);
  if (locked) return json(res, locked.status, locked.body);
  const fetchLimit = ws.trial_active ? TRIAL_LIMITS.backfill_posts : BACKFILL_LIMIT;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const accountId = body?.accountId || body?.id;
  if (!accountId) return json(res, 400, { error: 'accountId is required' });

  // Resolve the account and verify it belongs to this workspace.
  const account = await supabase.select('connected_accounts', {
    select: '*',
    eq: { id: accountId, workspace_id: ws.id, is_active: true },
    single: true,
  }).catch(() => null);
  if (!account) return json(res, 404, { error: 'Account not found' });

  if (account.historic_backfilled_at) {
    return json(res, 409, {
      error: 'Backfill already complete for this account.',
      backfilled_at: account.historic_backfilled_at,
    });
  }

  const handle = account.platform_username;
  if (!handle) return json(res, 400, { error: 'Account has no handle to scrape' });

  // Run the platform-appropriate scrape. YouTube uses the official Data
  // API (free up to quota) and supports a maxResults knob directly. All
  // other platforms go through Apify.
  let normalisedPosts = [];
  let cost_cents = 0;
  const errors = [];

  try {
    if (account.platform === 'youtube') {
      const channelKey = account.metadata?.channel_id || account.zernio_account_id;
      if (!channelKey) {
        return json(res, 400, { error: 'Missing YouTube channel id on account' });
      }
      const yt = await scrapeYouTubeChannel(channelKey, { maxResults: fetchLimit });
      normalisedPosts = yt.posts || [];
      cost_cents = 0; // direct API — no Apify charge
    } else {
      const result = await runActor(account.platform, handle, { limit: fetchLimit });
      normalisedPosts = result.posts || [];
      if (result.errors?.length) errors.push(...result.errors);
      cost_cents = estimateScrapeCost(account.platform);
    }
  } catch (e) {
    return json(res, 502, { error: `Scrape failed: ${e.message}` });
  }

  // Map normalised posts to the canonical posts schema. We tag source='own'
  // (these are the user's posts) and compute engagement_rate + signal
  // ourselves so the rows match what sync.js writes.
  const rows = normalisedPosts
    .filter(p => p.platform_post_id)
    .map(p => {
      const rate = engagementRate(p);
      return {
        workspace_id: ws.id,
        source: 'own',
        platform: account.platform,
        platform_post_id: p.platform_post_id,
        post_type: p.post_type || null,
        caption: p.caption || null,
        posted_at: p.posted_at || null,
        views: p.views || 0,
        likes: p.likes || 0,
        comments: p.comments || 0,
        saves: p.saves || 0,
        shares: p.shares || 0,
        engagement_rate: rate,
        signal: signalFor(rate),
        raw_data: p.raw_data || {},
      };
    });

  let persisted = 0;
  if (rows.length) {
    try {
      // The upsert dedupes against anything Zernio has already written
      // for this account, so re-running a backfill across a connection
      // edge is safe (in practice we prevent that via historic_backfilled_at).
      await supabase.upsert('posts', rows, {
        onConflict: 'workspace_id,platform,platform_post_id',
      });
      persisted = rows.length;
    } catch (e) {
      return json(res, 500, { error: `DB upsert failed: ${e.message}` });
    }
  }

  // Stamp the account so the button flips to "Backfilled" and the
  // endpoint refuses to re-run. We do this AFTER the upsert succeeded
  // so a transient DB error doesn't lock out a retry.
  await supabase.update('connected_accounts',
    { historic_backfilled_at: new Date().toISOString() },
    { eq: { id: account.id } }
  ).catch(() => {});

  // Record cost in usage_log for the billing-side rollup.
  await supabase.insert('usage_log', {
    workspace_id: ws.id,
    run_type: 'backfill',
    platform: account.platform,
    records_fetched: normalisedPosts.length,
    cost_cents,
    status: 'completed',
    run_at: new Date().toISOString(),
  }).catch(e => console.warn('[backfill] usage_log insert failed:', e.message));

  return json(res, 200, {
    ok: true,
    platform: account.platform,
    handle,
    fetched: normalisedPosts.length,
    persisted,
    cost_cents,
    errors: errors.length ? errors : undefined,
  });
}
