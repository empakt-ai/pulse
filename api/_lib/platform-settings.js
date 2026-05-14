// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Admin-controlled runtime configuration. Single touch-point
// between the admin module and Mashal: admin writes, Mashal reads, nothing
// else.
//
// Cache is per-function-instance with a 60-second TTL. Warm Vercel
// instances amortise the cost; an admin toggle propagates within ~1 min
// across cold instances, instantly on the instance that wrote it (because
// setSettings calls bustCache() at the end). For finer propagation we'd
// reach for Supabase realtime or a kv store — not needed at our scale.
//
// Defaults shipped here mirror the seeded rows in migration 017 so a
// brand-new environment behaves the same as a seeded one even before the
// migration runs.
// ═════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase.js';

const TTL_MS = 60_000;
const DEFAULTS = {
  ai_provider:          'gemini',
  feature_flags:        {},
  brief_prompt_version: 'v1',
  caps:                 {},
};

let cache = null;       // { fetched_at: number, values: Record<string, any> }
let inflight = null;    // dedupe concurrent loads

async function loadFresh() {
  const rows = await supabase.select('platform_settings', {
    select: 'key,value',
    limit: 50,
  }).catch(() => []);
  const values = { ...DEFAULTS };
  for (const r of rows || []) {
    if (!r?.key) continue;
    values[r.key] = r.value;
  }
  cache = { fetched_at: Date.now(), values };
  return values;
}

export async function getPlatformSettings({ force = false } = {}) {
  if (!force && cache && (Date.now() - cache.fetched_at) < TTL_MS) {
    return cache.values;
  }
  if (inflight) return inflight;
  inflight = loadFresh().finally(() => { inflight = null; });
  return inflight;
}

export async function getSetting(key, { force = false } = {}) {
  const all = await getPlatformSettings({ force });
  return key in all ? all[key] : DEFAULTS[key];
}

// Write-through: persist then refresh. The returned object is the full
// settings map after the write so callers can echo it back to the admin
// UI in one round-trip without a second GET.
//
// Audit logging is the responsibility of the CALLER (api/admin.js), not
// this helper — that keeps the audit row's before/after capture aligned
// with the action verb (e.g., 'settings.ai_provider.update') rather than
// a generic 'settings.write'.
export async function setSettings(patch, { userId = null } = {}) {
  const rows = Object.entries(patch).map(([key, value]) => ({
    key,
    value,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  }));
  if (!rows.length) return getPlatformSettings({ force: true });
  await supabase.upsert('platform_settings', rows, { onConflict: 'key' });
  return getPlatformSettings({ force: true });
}

export function bustCache() {
  cache = null;
}
