// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// Orchestrates Apify scrapes for tracked competitor handles and persists
// to the generic posts + account_snapshots schema. The "competitor" concept
// is a generic comparative-tracking primitive that Content Studio can reuse
// for its own competitor benchmarks. No Mashal intelligence here.
// ═════════════════════════════════════════════════════════════════════════
//
// Run Apify actors for all active competitors in a workspace, persist posts +
// snapshots, update follower counts. Returns a per-competitor result summary.

import { supabase } from './supabase.js';
import { runActor, estimateScrapeCost, ACTORS, scrapeAdLibrary } from './apify.js';
import { scrapeChannel as scrapeYouTubeChannel } from './youtube.js';

// Min hours between scrapes of the same competitor (avoid burning Apify credit)
const MIN_HOURS_BETWEEN = 6;
// Ad Library refresh cadence — competitors' paid ad inventory shifts more
// slowly than organic posting, and a single Ad Library scrape is more
// expensive than a profile scrape. 24h between pulls is a reasonable floor.
const AD_LIBRARY_MIN_HOURS = 24;
// Ad Library is a Meta-only catalogue (FB + IG ads). Skip competitor rows
// whose platform isn't one of these.
const AD_LIBRARY_PLATFORMS = new Set(['facebook', 'instagram']);

// YouTube goes through the official Google Data API; everything else uses Apify.
function isSupported(platform) {
  return platform === 'youtube' || !!ACTORS[platform];
}

async function fetchPlatform(platform, handle) {
  if (platform === 'youtube') {
    const { profile, posts, errors } = await scrapeYouTubeChannel(handle);
    return { profile, posts, errors };
  }
  return runActor(platform, handle);
}

function hoursSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}

export async function syncCompetitorsForWorkspace(workspace, { force = false } = {}) {
  const rows = await supabase.select('competitors', {
    select: '*',
    eq: { workspace_id: workspace.id },
  }).catch(() => []);

  const active = (rows || []).filter(c => c.is_active !== false && isSupported(c.platform));
  if (!active.length) return { competitors: 0, scraped: 0, results: [] };

  const today = new Date().toISOString().slice(0, 10);

  async function syncOne(comp) {
    if (!force && hoursSince(comp.last_synced_at) < MIN_HOURS_BETWEEN) {
      return { handle: comp.handle, platform: comp.platform, skipped: 'recently_synced' };
    }

    let logRow = null;
    try {
      const inserted = await supabase.insert('usage_log', {
        workspace_id: workspace.id,
        run_type: 'competitor_scrape',
        platform: comp.platform,
        status: 'running',
        run_at: new Date().toISOString(),
      });
      logRow = inserted?.[0];
    } catch {}

    try {
      const { profile, posts, errors } = await fetchPlatform(comp.platform, comp.handle);

      const postRows = (posts || [])
        .filter(p => p.platform_post_id)
        .map(p => ({
          workspace_id: workspace.id,
          source: 'competitor',
          competitor_id: comp.id,
          platform: comp.platform,
          ...p,
        }));

      if (postRows.length) {
        await supabase.delete('posts', { eq: { competitor_id: comp.id } }).catch(() => {});
        await supabase.insert('posts', postRows);
      }

      const updates = {
        followers: profile.followers ?? comp.followers,
        display_name: profile.display_name || comp.display_name || comp.handle,
        last_synced_at: new Date().toISOString(),
      };
      await supabase.update('competitors', updates, { eq: { id: comp.id } });

      if (profile.followers != null) {
        await supabase.upsert('account_snapshots', [{
          workspace_id: workspace.id,
          platform: comp.platform,
          account_type: 'competitor',
          handle: comp.handle,
          snapshot_date: today,
          followers: profile.followers,
        }], { onConflict: 'workspace_id,platform,handle,snapshot_date' }).catch(() => {});
      }

      if (logRow) {
        // YouTube uses the free Google API; everything else estimates Apify cost.
        const cost = comp.platform === 'youtube' ? 0 : estimateScrapeCost(comp.platform);
        await supabase.update('usage_log',
          { status: 'completed', records_fetched: postRows.length, cost_cents: cost },
          { eq: { id: logRow.id } }
        ).catch(() => {});
      }

      return {
        handle: comp.handle, platform: comp.platform,
        posts: postRows.length, followers: profile.followers,
        actor_errors: errors?.length ? errors : undefined,
      };
    } catch (e) {
      if (logRow) {
        await supabase.update('usage_log',
          { status: 'failed' }, { eq: { id: logRow.id } }
        ).catch(() => {});
      }
      return { handle: comp.handle, platform: comp.platform, error: e.message };
    }
  }

  // Parallel across competitors — Apify handles each actor run independently
  // on their side, so we don't need to throttle here. Vercel's 60s budget
  // is the real constraint, and parallelism is what makes it fit.
  const results = await Promise.all(active.map(syncOne));

  // ── Meta Ad Library scrape (Brand+ only) ────────────────────────────────
  // Pulls every currently-running Meta ad for each FB/IG competitor. One
  // actor run per competitor so the matching back to competitor_id is
  // unambiguous. Tolerates failures the same way profile/posts do.
  let adLibrary = null;
  const tier = String(workspace?.tier || 'creator').toLowerCase();
  const adLibAllowed = tier === 'brand' || tier === 'agency';
  if (adLibAllowed && !workspace?.trial_active) {
    const metaTargets = active.filter(c => AD_LIBRARY_PLATFORMS.has(c.platform));
    // De-duplicate by (display_name || handle) — if a brand is tracked on
    // both FB and IG we don't want to scrape the same Page twice. Keep one
    // competitor row per brand identity for the upsert key.
    const seen = new Set();
    const queries = metaTargets.filter(c => {
      const key = ((c.display_name || c.handle) || '').toLowerCase().trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return !c.last_ad_library_scrape_at
        || hoursSince(c.last_ad_library_scrape_at) >= AD_LIBRARY_MIN_HOURS
        || force;
    });

    if (queries.length) {
      const adResults = await Promise.all(queries.map(async (comp) => {
        const pageName = comp.display_name || comp.handle;
        try {
          const { ads, error } = await scrapeAdLibrary([pageName], { limit: 25 });
          if (error) return { competitor_id: comp.id, handle: comp.handle, ads: 0, error };
          if (!ads.length) {
            await supabase.update('competitors',
              { last_ad_library_scrape_at: new Date().toISOString() },
              { eq: { id: comp.id } }).catch(() => {});
            return { competitor_id: comp.id, handle: comp.handle, ads: 0 };
          }

          const rows = ads.map(a => ({
            workspace_id: workspace.id,
            competitor_handle: comp.handle,
            platform: a.platform,
            ad_id: a.ad_id,
            creative_type: a.creative_type,
            headline: a.headline,
            cta: a.cta,
            start_date: a.start_date,
            end_date: a.end_date,
            impression_range: a.impression_range,
            spend_range: a.spend_range,
            region: a.region,
            raw_json: a.raw_json,
          }));

          await supabase.upsert('competitor_ads', rows, { onConflict: 'platform,ad_id' }).catch(() => {});
          await supabase.update('competitors',
            { last_ad_library_scrape_at: new Date().toISOString() },
            { eq: { id: comp.id } }).catch(() => {});

          return { competitor_id: comp.id, handle: comp.handle, ads: rows.length };
        } catch (e) {
          return { competitor_id: comp.id, handle: comp.handle, ads: 0, error: e.message };
        }
      }));

      adLibrary = {
        scraped: adResults.filter(r => !r.error).length,
        skipped: metaTargets.length - queries.length,
        ads: adResults.reduce((s, r) => s + (r.ads || 0), 0),
        results: adResults,
      };
    } else {
      adLibrary = { scraped: 0, skipped: metaTargets.length, ads: 0, note: 'cooldown' };
    }
  } else {
    adLibrary = { skipped: 'tier_or_trial' };
  }

  return {
    competitors: active.length,
    scraped: results.filter(r => !r.error && !r.skipped).length,
    results,
    ad_library: adLibrary,
  };
}
