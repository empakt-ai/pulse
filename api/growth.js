// Growth module endpoint. Reads from account_snapshots (one row per
// account-per-day) and returns:
//
//   - series.own:        per-platform follower trajectory for the workspace's
//                        own connected accounts.
//   - series.competitors: trajectory for each tracked competitor handle.
//   - velocity:          per-platform week-over-week % change + a state label
//                        ('surging' / 'climbing' / 'steady' / 'declining').
//   - current:           latest snapshot per own platform.
//
// All time windows configurable via ?days=30|90. Defaults to 30.

import { authenticate, json } from './_lib/auth.js';
import { supabase } from './_lib/supabase.js';

const PLATFORM_TO_ICON = {
  instagram: 'ig', tiktok: 'tt', youtube: 'yt',
  facebook: 'fb', linkedin: 'li', x: 'x', snapchat: 'sc',
};
const platformKey = (p) => PLATFORM_TO_ICON[p] || p;

function daysAgoIso(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function classifyVelocity(pct) {
  if (pct == null) return 'unknown';
  if (pct >= 10) return 'surging';
  if (pct >= 3)  return 'climbing';
  if (pct >= -1) return 'steady';
  return 'declining';
}

// Build a date-sorted series of { date, followers } for one (platform, handle).
function seriesFor(rows) {
  return rows
    .filter(r => r.followers != null)
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
    .map(r => ({ date: r.snapshot_date, followers: Number(r.followers) }));
}

// Week-over-week % change: compare the most recent point to the one closest
// to 7 days before it (NOT just the first point in the window, so the value
// is meaningful regardless of window length).
function wowDelta(points) {
  if (!points.length) return null;
  const latest = points[points.length - 1];
  const targetMs = new Date(latest.date).getTime() - 7 * 86400000;
  let baseline = null;
  for (let i = points.length - 1; i >= 0; i--) {
    if (new Date(points[i].date).getTime() <= targetMs) { baseline = points[i]; break; }
  }
  if (!baseline) baseline = points[0];
  if (!baseline.followers) return null;
  return Math.round(((latest.followers - baseline.followers) / baseline.followers) * 1000) / 10;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const auth = await authenticate(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const ws = auth.workspace;
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  const days = Math.min(365, Math.max(7, Number(req.query?.days) || 30));
  const sinceDate = daysAgoIso(days);

  // Pull all snapshots in window. Single query, then split in JS — faster
  // than two filtered queries against the same table.
  const snapshots = await supabase.select('account_snapshots', {
    select: '*',
    eq: { workspace_id: ws.id },
    order: 'snapshot_date.asc',
  }).catch(() => []);
  const inWindow = (snapshots || []).filter(s => s.snapshot_date >= sinceDate);

  // Group own snapshots by platform.
  const ownByPlatform = {};
  for (const s of inWindow.filter(s => s.account_type === 'own')) {
    const k = platformKey(s.platform);
    (ownByPlatform[k] ||= []).push(s);
  }

  // Group competitor snapshots by (platform, handle).
  const compByKey = {};
  for (const s of inWindow.filter(s => s.account_type === 'competitor')) {
    const k = `${platformKey(s.platform)}::${s.handle}`;
    (compByKey[k] ||= { platform: platformKey(s.platform), handle: s.handle, rows: [] }).rows.push(s);
  }

  // Build the response.
  const ownSeries = {};
  const current = {};
  const velocity = [];
  for (const [k, rows] of Object.entries(ownByPlatform)) {
    const points = seriesFor(rows);
    ownSeries[k] = points;
    const latest = points[points.length - 1];
    if (latest) current[k] = { followers: latest.followers, date: latest.date };
    const pct = wowDelta(points);
    velocity.push({
      platform: k,
      wow_pct: pct,
      state: classifyVelocity(pct),
      latest: latest?.followers ?? null,
    });
  }

  const competitors = Object.values(compByKey).map(({ platform, handle, rows }) => {
    const points = seriesFor(rows);
    return {
      platform,
      handle,
      points,
      latest: points.length ? points[points.length - 1].followers : null,
      wow_pct: wowDelta(points),
    };
  });

  // Pull display_name + delta from competitors table so the UI can show
  // a richer label (handle alone is sometimes opaque).
  const compRows = await supabase.select('competitors', {
    select: 'handle,display_name,platform,followers',
    eq: { workspace_id: ws.id },
  }).catch(() => []);
  const compMeta = new Map(
    (compRows || []).map(c => [`${platformKey(c.platform)}::${c.handle}`, c])
  );
  for (const c of competitors) {
    const meta = compMeta.get(`${c.platform}::${c.handle}`);
    if (meta) {
      c.display_name = meta.display_name || meta.handle;
      // If snapshots are missing followers but the competitors row has one,
      // fall back so the legend isn't blank.
      if (c.latest == null && meta.followers != null) c.latest = meta.followers;
    }
  }

  return json(res, 200, {
    range_days: days,
    current,                            // { ig: { followers, date }, ... }
    velocity,                           // [{ platform, wow_pct, state, latest }]
    series: { own: ownSeries, competitors },
  });
}
