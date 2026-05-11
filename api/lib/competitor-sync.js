// Run Apify actors for all active competitors in a workspace, persist posts +
// snapshots, update follower counts. Returns a per-competitor result summary.

import { supabase } from './supabase.js';
import { runActor, estimateScrapeCost, ACTORS } from './apify.js';
import { scrapeChannel as scrapeYouTubeChannel } from './youtube.js';

// Min hours between scrapes of the same competitor (avoid burning Apify credit)
const MIN_HOURS_BETWEEN = 6;

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

  return {
    competitors: active.length,
    scraped: results.filter(r => !r.error && !r.skipped).length,
    results,
  };
}
