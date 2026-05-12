// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Platform infrastructure — moves to the shared platform service.
// Documented best-practice rules per platform. Structured data only — the
// AI prompt references these when explaining why a piece of content
// performed differently on platform A vs platform B, and what specifically
// to change when repurposing.
//
// Source: distilled from each platform's published creator guidance plus
// widely-validated 2024–2026 industry research. Update fields here when
// platform algorithms shift — the prompt picks up changes automatically.
// ═════════════════════════════════════════════════════════════════════════

export const PLATFORM_RULES = {
  instagram: {
    label: 'Instagram',
    formats: ['reel', 'carousel', 'photo', 'story'],
    optimal_video_length_seconds: { reel: [7, 30], story: [5, 15] },
    hook: {
      window_seconds: 1.5,
      style: 'Open with motion or face on screen within 1.5s. Text overlay must read in under 2 seconds. First frame is the entire hook on Reels.',
    },
    caption: {
      optimal_length_chars: [125, 220],
      structure: 'Hook line on its own. Body in short paragraphs. CTA last. Captions read past line 1 only when the hook earns it.',
    },
    hashtags: {
      sweet_spot: [3, 7],
      strategy: 'Mix niche (under 100K) + medium (500K–2M). Avoid top-million tags — they dilute reach on Reels.',
    },
    audio: 'Trending audio drives Reel reach. Use original audio only when the audio IS the content (talking-head, voiceover).',
    cross_post_adaptation: 'For TikTok→IG: re-export 9:16 with safe zones, strip TikTok watermark, re-record audio if it was a TikTok-trending track.',
  },

  tiktok: {
    label: 'TikTok',
    formats: ['video'],
    optimal_video_length_seconds: { video: [15, 60] },
    hook: {
      window_seconds: 2,
      style: 'Verbal or visual pattern interrupt in first 2 seconds. Ask a question, state a contrarian claim, or open mid-action. No logo intros, no slow zooms.',
    },
    caption: {
      optimal_length_chars: [80, 150],
      structure: 'Caption is secondary — set context, add searchable keywords. Avoid CTAs that send users off-platform.',
    },
    hashtags: {
      sweet_spot: [3, 5],
      strategy: '1–2 broad (#fyp is overused but expected), 1–2 niche, 1 trend. Keyword tags matter more than hashtags for the algorithm.',
    },
    audio: 'Trending sound is the #1 lever. Save sounds when they hit "Trending" badge and use within 48 hours. Original sound only when your voice/audio is the differentiator.',
    cross_post_adaptation: 'For IG→TT: cut to 15s if possible, swap audio to a TikTok-trending sound, add captions on every line.',
  },

  youtube: {
    label: 'YouTube',
    formats: ['short', 'video', 'live'],
    optimal_video_length_seconds: { short: [15, 60], video: [480, 900] }, // 8–15 min for long-form
    hook: {
      window_seconds: 8,
      style: 'For Shorts: 0–2s pattern interrupt. For long-form: state the value proposition in first 15s and tease the payoff at minute 3 or 5. Faces on thumbnail outperform 4:1.',
    },
    caption: {
      optimal_length_chars: [150, 400],
      structure: 'First two lines visible above the fold matter. Chapters in description boost retention. Pinned comment with key question doubles comment volume.',
    },
    hashtags: {
      sweet_spot: [2, 3],
      strategy: 'Hashtags are weak signal on YouTube. Spend the effort on title keyword + thumbnail testing instead.',
    },
    audio: 'For Shorts: trending audio matters less than on TikTok but still helps. For long-form: voiceover clarity over music. Background music must duck under narration.',
    cross_post_adaptation: 'For IG/TT→YT Shorts: trim to under 60s, re-export 9:16, write a clean title (max 60 chars) that works without thumbnail context.',
  },

  facebook: {
    label: 'Facebook',
    formats: ['reel', 'video', 'photo', 'post'],
    optimal_video_length_seconds: { reel: [15, 60], video: [60, 180] },
    hook: {
      window_seconds: 3,
      style: 'Slower than IG/TT. Audiences skew older — clarity over edginess. State what the video is about in first 3 seconds.',
    },
    caption: {
      optimal_length_chars: [100, 200],
      structure: 'Friendlier, more direct tone than IG. Questions in captions drive higher comment rates on Pages.',
    },
    hashtags: {
      sweet_spot: [0, 2],
      strategy: 'Hashtags do almost nothing on Facebook. Don\'t bother unless cross-posting from IG.',
    },
    audio: 'Most users watch with sound off. Captions/subtitles are mandatory.',
    cross_post_adaptation: 'For IG→FB: same asset usually fine but extend hook by 1–2s to account for slower scroll behavior.',
  },

  linkedin: {
    label: 'LinkedIn',
    formats: ['post', 'article', 'video', 'document'],
    optimal_video_length_seconds: { video: [30, 90] },
    hook: {
      window_seconds: 4,
      style: 'First two lines visible before the "see more" cutoff are the entire hook. Specific number or contrarian claim performs best. No emojis as openers.',
    },
    caption: {
      optimal_length_chars: [900, 1300],
      structure: 'Long-form works on LI. Whitespace between every 1–2 sentences. Story → insight → CTA. Carousels and document posts get 2–3× the dwell time of single images.',
    },
    hashtags: {
      sweet_spot: [3, 5],
      strategy: 'Mix industry-broad (#leadership) with specific (#saascontent). Avoid generic #motivation — they\'re seen as low-quality signal.',
    },
    audio: 'Sound-off default. Captions essential for any video.',
    cross_post_adaptation: 'For IG/TT→LI: rewrite caption entirely — LI audience expects long-form reflection, not just the line that worked on IG.',
  },

  x: {
    label: 'X / Twitter',
    formats: ['post', 'thread', 'video', 'image'],
    optimal_video_length_seconds: { video: [15, 45] },
    hook: {
      window_seconds: 1,
      style: 'First post of a thread = the entire hook. Specific, numeric, or controversial within 280 chars. Threads outperform single posts for reach but underperform for replies.',
    },
    caption: {
      optimal_length_chars: [80, 240],
      structure: 'Hard cap 280. White space and line breaks matter. Quote tweets get higher engagement than retweets — use them to amplify your own posts.',
    },
    hashtags: {
      sweet_spot: [0, 2],
      strategy: 'Hashtags reduce reach on X. Use only when participating in a specific trend.',
    },
    audio: 'Native video gets more reach than linked video. Always upload directly.',
    cross_post_adaptation: 'For long-form→X: shred the core insight into a thread of single-line claims. The video and image both attach to post 1.',
  },

  snapchat: {
    label: 'Snapchat',
    formats: ['spotlight', 'story'],
    optimal_video_length_seconds: { spotlight: [10, 60], story: [3, 10] },
    hook: {
      window_seconds: 1,
      style: 'Audience is younger and impatient. First frame is the hook — no titles, no logos.',
    },
    caption: {
      optimal_length_chars: [40, 100],
      structure: 'On-screen text drives most engagement. Bold, large, contrasting against the video.',
    },
    hashtags: { sweet_spot: [0, 0], strategy: 'Not used on Snapchat.' },
    audio: 'Trending sound matters less than other short-video platforms. Custom voiceover or music drop fits the audience.',
    cross_post_adaptation: 'For TT→Snap Spotlight: identical export usually works. Strip any TikTok-native effects.',
  },
};

// Lookup helper that tolerates the icon-style keys we use elsewhere
// ('ig' / 'tt' / 'yt') as well as full platform names.
const ICON_TO_PLATFORM = {
  ig: 'instagram', tt: 'tiktok', yt: 'youtube',
  fb: 'facebook', li: 'linkedin', x: 'x', sc: 'snapchat',
};
export function rulesFor(platform) {
  const key = ICON_TO_PLATFORM[platform] || platform;
  return PLATFORM_RULES[key] || null;
}

// Compact text representation of one platform's rules, suitable for
// inlining into an LLM prompt without blowing the budget.
export function rulesAsPromptText(platform) {
  const r = rulesFor(platform);
  if (!r) return '';
  const h = r.hook;
  const c = r.caption;
  const tags = r.hashtags;
  return [
    `${r.label}:`,
    `  hook (first ${h.window_seconds}s): ${h.style}`,
    `  caption: ${c.optimal_length_chars[0]}–${c.optimal_length_chars[1]} chars — ${c.structure}`,
    `  hashtags: ${tags.sweet_spot[0]}–${tags.sweet_spot[1]} — ${tags.strategy}`,
    `  audio: ${r.audio}`,
    `  cross-post: ${r.cross_post_adaptation}`,
  ].join('\n');
}

// All rules condensed for the prompt — used when explaining cross-platform
// gaps. ~2k tokens; fits comfortably with the cached system prompt.
export function allRulesAsPromptText() {
  return Object.keys(PLATFORM_RULES).map(rulesAsPromptText).join('\n\n');
}
