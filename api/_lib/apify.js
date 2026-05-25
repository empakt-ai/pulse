// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// Per-platform Apify actor configs + a generic runner. No Mashal-specific
// scoring or signal logic — actors return normalised profile/posts objects
// that downstream callers can interpret however they like.
// ═════════════════════════════════════════════════════════════════════════
//
// Apify wrapper — per-platform actor configs. Each platform can have a
// "profile" actor (returns followers/bio/verification) and a "posts" actor
// (returns recent posts). competitor-sync calls both when present and merges.
//
// All actors use the sync-get-dataset-items endpoint so results return in one
// request. Hard-capped resultsLimit + actor timeout to bound cost/time.

const BASE = 'https://api.apify.com/v2';
const KEY = process.env.APIFY_API_KEY;

if (!KEY) console.warn('[apify] APIFY_API_KEY missing — competitor scraping disabled');

// Helper: defensive number extraction (handles null/undefined/strings like "1.2M")
const num = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const s = v.replace(/,/g, '');
    if (/^\d+(\.\d+)?[KMB]$/i.test(s)) {
      const mult = { K: 1e3, M: 1e6, B: 1e9 }[s.slice(-1).toUpperCase()];
      return Math.round(parseFloat(s) * mult);
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

export const ACTORS = {
  instagram: {
    profile: {
      id: 'apify~instagram-profile-scraper',
      timeout: 30,
      input: (handle) => ({
        usernames: [handle.replace(/^@/, '')],
        resultsLimit: 1,
      }),
      normalise: (items) => {
        const p = items?.[0];
        if (!p) return null;
        return {
          followers: num(p.followersCount || p.followers),
          following: num(p.followsCount || p.following),
          verified: !!(p.verified || p.isVerified),
          display_name: p.fullName || p.name || null,
          bio: p.biography || p.bio || null,
          posts_count: num(p.postsCount),
        };
      },
    },
    posts: {
      id: 'apify~instagram-scraper',
      timeout: 60,
      input: (handle, opts = {}) => ({
        directUrls: [`https://www.instagram.com/${handle.replace(/^@/, '')}/`],
        resultsType: 'posts',
        resultsLimit: opts.limit || 12,
        addParentData: false,
      }),
      normalisePosts: (items) => (items || [])
        .filter(it => !it.error && it.id)
        .map(it => ({
          platform_post_id: String(it.id || it.shortCode || it.url || ''),
          post_type: it.type || it.productType || 'post',
          caption: it.caption || it.text || null,
          posted_at: it.timestamp || it.takenAtTimestamp || null,
          views: num(it.videoViewCount || it.videoPlayCount || it.viewCount) || 0,
          likes: num(it.likesCount || it.likeCount) || 0,
          comments: num(it.commentsCount || it.commentCount) || 0,
          saves: 0, shares: 0,
          raw_data: it,
        })),
    },
  },

  tiktok: {
    // TikTok scraper returns profile + posts in one shot via the same actor.
    posts: {
      id: 'clockworks~tiktok-scraper',
      timeout: 60,
      input: (handle, opts = {}) => ({
        profiles: [handle.replace(/^@/, '')],
        resultsPerPage: opts.limit || 12,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
      }),
      normaliseProfile: (items) => {
        const first = items?.[0];
        const author = first?.authorMeta || first?.author || {};
        return {
          followers: num(author.fans || author.followerCount),
          verified: !!author.verified,
          display_name: author.nickName || author.name || null,
        };
      },
      normalisePosts: (items) => (items || [])
        .filter(it => it.id || it.videoId)
        .map(it => ({
          platform_post_id: String(it.id || it.videoId || ''),
          post_type: 'video',
          caption: it.text || it.desc || null,
          posted_at: it.createTime ? new Date(it.createTime * 1000).toISOString() : (it.createTimeISO || null),
          views: num(it.playCount || it.viewCount) || 0,
          likes: num(it.diggCount || it.likeCount) || 0,
          comments: num(it.commentCount) || 0,
          saves: num(it.collectCount) || 0,
          shares: num(it.shareCount) || 0,
          raw_data: it,
        })),
    },
  },

  // YouTube: handled via direct Google Data API v3 in api/lib/youtube.js (Phase 5).
  // The streamers/youtube-scraper Apify actor reliably times out for any
  // channel above tiny size — even at maxResults=3 with 55s timeout. The
  // official API is faster, free up to quota, and gives richer data.
  // youtube: { ... },

  linkedin: {
    // harvestapi's LinkedIn profile scraper is one of the most reliable for
    // public profiles. Handles linkedin.com/in/USERNAME URLs.
    profile: {
      id: 'harvestapi~linkedin-profile-scraper',
      timeout: 45,
      input: (handle) => {
        const h = handle.replace(/^@/, '');
        const url = h.startsWith('http') ? h : `https://www.linkedin.com/in/${h}/`;
        return { profileUrls: [url] };
      },
      normalise: (items) => {
        const p = items?.[0];
        if (!p) return null;
        return {
          followers: num(p.followers || p.followersCount || p.connections || p.connectionsCount),
          verified: false,
          display_name: p.fullName || p.name || (p.firstName ? `${p.firstName} ${p.lastName || ''}`.trim() : null),
          bio: p.headline || p.about || p.summary || null,
        };
      },
    },
  },

  // Snapchat: no reliable public Apify actor with the names we tried. Tell us
  // the actor slug you've enabled and we'll wire it. Until then, snapchat
  // competitors are added to the DB but not scraped.
  // snapchat: { ... },

  facebook: {
    profile: {
      id: 'apify~facebook-pages-scraper',
      timeout: 45,
      input: (handle) => ({
        startUrls: [{ url: `https://www.facebook.com/${handle.replace(/^@/, '')}` }],
        resultsLimit: 1,
      }),
      normalise: (items) => {
        const p = items?.[0];
        if (!p) return null;
        return {
          followers: num(p.followers || p.likes),
          verified: !!p.verified,
          display_name: p.title || p.name || null,
        };
      },
    },
  },

  x: {
    profile: {
      id: 'apidojo~twitter-user-scraper',
      timeout: 30,
      input: (handle) => ({
        usernames: [handle.replace(/^@/, '')],
      }),
      normalise: (items) => {
        const p = items?.[0];
        if (!p) return null;
        return {
          followers: num(p.followers_count || p.followers),
          verified: !!(p.verified || p.is_blue_verified),
          display_name: p.name || null,
          bio: p.description || null,
        };
      },
    },
  },
};

// Internal: run a single actor and return its parsed dataset items.
async function callActor(actorId, input, timeout = 45, signal) {
  const url = `${BASE}/acts/${actorId}/run-sync-get-dataset-items?token=${KEY}&timeout=${timeout}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Apify ${actorId} ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    err.actor = actorId;
    throw err;
  }
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

// Public: run all configured actors for the platform/handle in PARALLEL and
// return merged { profile, posts, items }. Parallel matters here — Vercel
// functions have a 60s cap and sequential profile+posts calls per competitor,
// across 3-5 competitors, blows that budget.
export async function runActor(platform, handle, opts = {}) {
  const cfg = ACTORS[platform];
  if (!cfg) throw new Error(`No Apify actor configured for platform: ${platform}`);

  const tasks = [];
  if (cfg.profile) {
    tasks.push(
      callActor(cfg.profile.id, cfg.profile.input(handle, opts), cfg.profile.timeout, opts.signal)
        .then(items => ({ kind: 'profile', items }))
        .catch(e => ({ kind: 'profile', error: e.message, actor: cfg.profile.id }))
    );
  }
  if (cfg.posts) {
    tasks.push(
      callActor(cfg.posts.id, cfg.posts.input(handle, opts), cfg.posts.timeout, opts.signal)
        .then(items => ({ kind: 'posts', items }))
        .catch(e => ({ kind: 'posts', error: e.message, actor: cfg.posts.id }))
    );
  }

  const results = await Promise.all(tasks);

  let profile = null;
  let posts = [];
  let postsActorItems = [];
  const errors = [];

  for (const r of results) {
    if (r.error) { errors.push({ actor: r.actor, error: r.error }); continue; }
    if (r.kind === 'profile' && cfg.profile?.normalise) {
      profile = cfg.profile.normalise(r.items);
    }
    if (r.kind === 'posts' && cfg.posts) {
      postsActorItems = r.items;
      if (cfg.posts.normalisePosts) posts = cfg.posts.normalisePosts(r.items);
      if ((!profile || profile.followers == null) && cfg.posts.normaliseProfile) {
        const fromPosts = cfg.posts.normaliseProfile(r.items);
        profile = { ...(profile || {}), ...(fromPosts || {}) };
      }
    }
  }

  return { profile: profile || {}, posts: posts || [], items: postsActorItems, errors };
}

// Rough cost estimate (cents) — sum of actors that ran for this platform.
export function estimateScrapeCost(platform) {
  const base = { instagram: 6, tiktok: 4, youtube: 3, linkedin: 8, snapchat: 4, facebook: 4, x: 3 };
  return base[platform] || 5;
}

// ─── Meta Ad Library scrape ──────────────────────────────────────────────
// Public Meta Ad Library is browsable without auth, so an Apify actor
// can pull every currently-running paid ad for a Facebook Page name. The
// Page name is the brand identity that runs the ad — typically the same
// as the IG / FB handle the user tracks as a competitor, but it's the
// Page itself that owns the ad, not the IG account.
//
// Actor ID is env-overridable. The Apify ecosystem has several actors
// for the Ad Library and they go in and out of maintenance; swapping is
// a config change rather than a code change. Default is the
// curious_coder Ad Library scraper which has been the most reliable in
// our testing window — change via APIFY_AD_LIBRARY_ACTOR_ID if needed.
const AD_LIBRARY_ACTOR_ID =
  process.env.APIFY_AD_LIBRARY_ACTOR_ID || 'curious_coder~facebook-ads-library-scraper';
const AD_LIBRARY_TIMEOUT = 90; // seconds — bigger pages can return 50+ ads

// Normalise a single dataset item from curious_coder/facebook-ads-library-scraper.
// Field names come from the actor's documented output: ad_archive_id,
// page_id, page_name, start_date, end_date, currency, impressions, spend,
// publisher_platform, categories, archive_types. The snapshot/creative
// payload isn't named in the actor's input-schema docs, so we walk the
// usual Meta Ad Library shapes (snapshot.{title,body.text,link_description,
// cta_text, cta_type, videos, images, cards}). Anything unrecognised is
// preserved in raw_json for the UI to surface as-is.
function normaliseAdLibraryItem(it, fallbackCountry = null) {
  if (!it || typeof it !== 'object') return null;

  const adId = String(
    it.ad_archive_id || it.adArchiveID || it.ad_id || it.adid || it.id || ''
  );
  if (!adId) return null;

  // Dates: actor's docs list start_date / end_date as named fields. They
  // typically arrive as ISO strings or unix seconds. coerce defensively.
  const coerceDate = (v) => {
    if (!v) return null;
    if (typeof v === 'number') {
      return new Date(v * (v < 1e12 ? 1000 : 1)).toISOString().slice(0, 10);
    }
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  };

  // Snapshot is where the creative + copy live in Meta Ad Library's
  // own response shape, which curious_coder typically passes through.
  const snap = it.snapshot || it.creative_snapshot || it.adSnapshot || {};

  // Creative type — preferred derivation is presence of media arrays
  // inside the snapshot; fall back to explicit fields that some shapes
  // carry at the top level.
  let creative_type = 'unknown';
  const videos = snap.videos || snap.video_assets || [];
  const images = snap.images || snap.image_assets || [];
  const cards  = snap.cards  || snap.carousel_cards || [];
  if (Array.isArray(videos) && videos.length) creative_type = 'video';
  else if (Array.isArray(cards) && cards.length > 1) creative_type = 'carousel';
  else if (Array.isArray(images) && images.length) creative_type = 'image';
  else if (it.display_format || it.creative_type) {
    const raw = String(it.display_format || it.creative_type || '').toLowerCase();
    if (/video/.test(raw)) creative_type = 'video';
    else if (/carousel|dco/.test(raw)) creative_type = raw.includes('dco') ? 'dco' : 'carousel';
    else if (/image|photo|static/.test(raw)) creative_type = 'image';
  }

  // Headline / primary copy. snapshot.title is the link title; body.text is
  // the primary text above the creative; link_description is the smaller
  // line under the headline. Pick the most informative one we have.
  const bodyText =
    (typeof snap.body === 'object' ? snap.body?.text : snap.body) ||
    snap.bodyText || snap.text || null;
  const headline = snap.title || bodyText || snap.link_description ||
    it.title || it.body || null;

  // CTA — cta_text is the visible button label, cta_type is Meta's enum
  // (LEARN_MORE, SHOP_NOW, etc). Prefer the human-readable text.
  const cta = snap.cta_text || snap.cta_type || it.cta_text || it.cta_type || null;

  // Permalink to the ad in the Ad Library UI. The archive id forms the
  // canonical URL; we also accept whatever the actor surfaces.
  const permalink = it.url || it.ad_library_url || snap.ad_snapshot_url ||
    `https://www.facebook.com/ads/library/?id=${adId}`;

  // Publisher platform list (Facebook, Instagram, Messenger, Audience Network).
  // Stored on the row so the UI can mention "running on IG + FB" rather than
  // assuming Meta-broad.
  const publisher_platform = Array.isArray(it.publisher_platform)
    ? it.publisher_platform : (it.publisher_platforms || []);

  // Impressions + spend — both are { lower_bound, upper_bound } objects on
  // political / social-issue ads; null on commercial. Format as a readable
  // range so the UI doesn't need to know Meta's bound shape.
  const fmtRange = (obj, currency) => {
    if (!obj || typeof obj !== 'object') return obj ? String(obj).slice(0, 100) : null;
    const lo = obj.lower_bound ?? obj.lowerBound ?? obj.min;
    const hi = obj.upper_bound ?? obj.upperBound ?? obj.max;
    if (lo == null && hi == null) return null;
    const cur = currency ? ` ${currency}` : '';
    if (lo != null && hi != null) return `${lo}–${hi}${cur}`;
    return `${lo ?? hi}${cur}`;
  };

  // Region: the actor's input filters by country, so when the per-item
  // region is missing we attribute the row to the country we asked for.
  const region = (Array.isArray(it.reached_countries) && it.reached_countries[0])
    || it.country || it.region || fallbackCountry || null;

  return {
    ad_id: adId,
    platform: 'meta',
    page_id: it.page_id || it.pageId || null,
    page_name: it.page_name || it.pageName || null,
    creative_type,
    headline: typeof headline === 'string' ? headline.slice(0, 1000) : null,
    cta: typeof cta === 'string' ? cta.slice(0, 200) : (cta ? String(cta) : null),
    start_date: coerceDate(it.start_date || it.start_date_string),
    end_date:   coerceDate(it.end_date   || it.end_date_string),
    impression_range: fmtRange(it.impressions, it.currency),
    spend_range:      fmtRange(it.spend, it.currency),
    region: region ? String(region).slice(0, 100) : null,
    publisher_platform,
    permalink,
    raw_json: it,
  };
}

// Public: scrape Meta Ad Library for one or more Page names. Returns
// { ads, items, error }. Input shape matches the actor's documented
// schema: a urls array plus the scrapePageAds.* dotted keys.
//
// The search-URL form (`/ads/library/?...&q=NAME`) is more forgiving than
// the per-Page URL form because it doesn't require a numeric page_id —
// fuzzy matching on the brand name picks up the right Page in practice.
export async function scrapeAdLibrary(pageNames, opts = {}) {
  if (!KEY) return { ads: [], items: [], error: 'APIFY_API_KEY missing' };
  const names = (Array.isArray(pageNames) ? pageNames : [pageNames])
    .filter(Boolean)
    .map(n => String(n).replace(/^@/, '').trim())
    .filter(Boolean);
  if (!names.length) return { ads: [], items: [], error: 'no page names provided' };

  const country = (opts.country || 'ALL').toUpperCase();
  // Per-page cap. The actor charges $0.75 / 1000 ads, so 25 × 5 competitors
  // is about $0.10 per sync — well inside the per-workspace Apify budget.
  const limit = Math.min(50, Math.max(5, Number(opts.limit) || 25));

  const input = {
    urls: names.map(n =>
      `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${country}&q=${encodeURIComponent(n)}`
    ),
    limitPerSource: limit,
    scrapeAdDetails: false,
    // Dotted keys are literal property names on this actor, not nested.
    'scrapePageAds.period':       opts.period       || 'last30d',
    'scrapePageAds.activeStatus': opts.activeStatus || 'all',
    'scrapePageAds.sortBy':       opts.sortBy       || 'impressions_desc',
    'scrapePageAds.countryCode':  country,
  };

  try {
    const items = await callActor(AD_LIBRARY_ACTOR_ID, input, AD_LIBRARY_TIMEOUT, opts.signal);
    const ads = items.map(it => normaliseAdLibraryItem(it, country === 'ALL' ? null : country)).filter(Boolean);
    return { ads, items, error: null };
  } catch (e) {
    return { ads: [], items: [], error: e.message };
  }
}

// Profile-only scrape — skips the posts actor when we just need follower
// counts (e.g. own-account follower refresh while Zernio's analytics add-on
// isn't active). About half the cost and latency of a full runActor call.
export async function scrapeProfile(platform, handle, opts = {}) {
  const cfg = ACTORS[platform];
  if (!cfg) throw new Error(`No Apify actor configured for platform: ${platform}`);

  // Prefer a dedicated profile actor when one exists; otherwise fall back to
  // the posts actor's profile-from-posts extractor (used for TikTok, where
  // a single actor returns both).
  if (cfg.profile) {
    const items = await callActor(cfg.profile.id, cfg.profile.input(handle), cfg.profile.timeout, opts.signal);
    return cfg.profile.normalise(items) || {};
  }
  if (cfg.posts?.normaliseProfile) {
    const items = await callActor(cfg.posts.id, cfg.posts.input(handle), cfg.posts.timeout, opts.signal);
    return cfg.posts.normaliseProfile(items) || {};
  }
  throw new Error(`No profile extractor available for: ${platform}`);
}
