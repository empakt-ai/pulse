// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Static country context — TAM and platform usage signals per
// market. Updated periodically from DataReportal / We Are Social digital
// snapshots. Used by /api/brief to render a "your market" reference card
// on the Brief screen, and (later) fed into the AI prompt so verdicts
// reason about regional norms.
//
// Source notes:
//   • Population + platform user counts from DataReportal 2025–26 reports
//   • "ad reach %" = platform ad reach as % of adult population
//   • Times = average monthly minutes per active user (per platform)
//   • Hot topic = short editorial — what content travels in that market
//
// Country code keys use ISO-3166-1 alpha-2 to match workspaces.country.
// ═════════════════════════════════════════════════════════════════════════

export const MARKET_CONTEXT = {
  SA: {
    name: 'Saudi Arabia',
    flag: '🇸🇦',
    population_m: 36.4,
    platforms: {
      tiktok:    { users_m: 38.6, ad_reach_pct: 154, monthly_minutes: 2088, note: 'TikTok ad reach exceeds adult population — multi-account use. Primary discovery platform.' },
      instagram: { users_m: 18.8, ad_reach_pct: 73,  monthly_minutes: 858,  note: 'Strong female lean. Social commerce active since 2017. Arabic > English on engagement.' },
      youtube:   { users_m: 28.2, ad_reach_pct: 79,  monthly_minutes: null, note: 'Long-form Arabic content + family viewing. Shorts growing fast.' },
      snapchat:  { users_m: 24.1, ad_reach_pct: 70,  monthly_minutes: null, note: 'Distinctly strong here. Stories format outperforms feed.' },
    },
    hot_topic: 'Arabic-first captions outperform bilingual. Cultural cues (Saudi National Day, Ramadan, Eid) carry 3–5× normal reach when posted within the week of the event.',
  },
  AE: {
    name: 'United Arab Emirates',
    flag: '🇦🇪',
    population_m: 9.9,
    platforms: {
      instagram: { users_m: 5.9, ad_reach_pct: 96, monthly_minutes: 780, note: 'Highest IG ad reach in the region. Luxury, F&B, travel categories dominate.' },
      tiktok:    { users_m: 6.5, ad_reach_pct: 105, monthly_minutes: 1740, note: 'High purchasing power per viewer. English content viable alongside Arabic.' },
      youtube:   { users_m: 8.4, ad_reach_pct: 94, monthly_minutes: null, note: 'Top tier for premium creator content; expat-friendly English channels thrive.' },
      linkedin:  { users_m: 6.4, ad_reach_pct: 73, monthly_minutes: null, note: 'B2B and professional content has unusual reach for the region.' },
    },
    hot_topic: 'Bilingual (Arabic + English) captions perform better than single-language. Premium / aspirational angle outperforms discount-led copy.',
  },
  KW: {
    name: 'Kuwait',
    flag: '🇰🇼',
    population_m: 4.3,
    platforms: {
      instagram: { users_m: 3.3, ad_reach_pct: 96, monthly_minutes: null, note: 'Highest per-capita IG penetration globally. Influencer marketing is the channel.' },
      snapchat:  { users_m: 2.9, ad_reach_pct: 85, monthly_minutes: null, note: 'Dominant for under-25. Stories + spotlight win over feed posts.' },
      tiktok:    { users_m: 2.5, ad_reach_pct: 76, monthly_minutes: null, note: 'Younger demographic skew. Humour + family content travels.' },
    },
    hot_topic: 'Influencer endorsements weigh heavier than brand posts. Arabic-first; cultural humour and family scenarios outperform product-only content.',
  },
  US: {
    name: 'United States',
    flag: '🇺🇸',
    population_m: 335,
    platforms: {
      instagram: { users_m: 169, ad_reach_pct: 65, monthly_minutes: 720, note: 'Reels reach has plateaued; carousels driving outsized engagement for creators.' },
      tiktok:    { users_m: 152, ad_reach_pct: 56, monthly_minutes: 2520, note: 'Highest watch-time of any market. Shop integration changing discovery → buy paths.' },
      youtube:   { users_m: 244, ad_reach_pct: 90, monthly_minutes: null, note: 'Shorts now competing with TikTok for short-form spend.' },
      x:         { users_m: 95,  ad_reach_pct: 37, monthly_minutes: null, note: 'Real-time + news angle. Audience increasingly male-skewed.' },
      linkedin:  { users_m: 224, ad_reach_pct: 76, monthly_minutes: null, note: 'Personal-brand creator content has overtaken company-page posts.' },
    },
    hot_topic: 'Native vertical video (no logo bug, no over-edited intro) wins over polished brand content. Specificity beats aspiration.',
  },
  GB: {
    name: 'United Kingdom',
    flag: '🇬🇧',
    population_m: 68,
    platforms: {
      instagram: { users_m: 39, ad_reach_pct: 70, monthly_minutes: 615, note: 'High mid-tier influencer activity. Reels comfortably outpacing feed posts.' },
      tiktok:    { users_m: 24, ad_reach_pct: 38, monthly_minutes: 2200, note: 'Strong shopping conversion. Beauty + lifestyle dominate.' },
      youtube:   { users_m: 56, ad_reach_pct: 87, monthly_minutes: null, note: 'Long-form remains strong; gaming + creator vlogs top categories.' },
      linkedin:  { users_m: 38, ad_reach_pct: 67, monthly_minutes: null, note: 'B2B + recruiting hub for Europe. Thought-leadership posts top performers.' },
    },
    hot_topic: 'Dry / observational humour travels far. Avoid US-style hyperbole — UK audiences read it as inauthentic.',
  },
  IN: {
    name: 'India',
    flag: '🇮🇳',
    population_m: 1430,
    platforms: {
      instagram: { users_m: 363, ad_reach_pct: 31, monthly_minutes: 750, note: 'Largest IG market by users. Regional-language Reels reach 5× English equivalent.' },
      youtube:   { users_m: 467, ad_reach_pct: 47, monthly_minutes: null, note: 'Largest YouTube market globally. Hindi + regional dominate; Shorts growing rapidly.' },
      facebook:  { users_m: 369, ad_reach_pct: 35, monthly_minutes: null, note: 'Still significant for older + tier-2 cities. Hindi reels work here too.' },
    },
    hot_topic: 'Regional languages (Hindi, Tamil, Telugu, Marathi, Bengali) carry 3–8× the reach of English. Local festival timing (Diwali, Holi, Eid) drives spikes.',
  },
  EG: {
    name: 'Egypt',
    flag: '🇪🇬',
    population_m: 113,
    platforms: {
      tiktok:    { users_m: 39,  ad_reach_pct: 47, monthly_minutes: 1900, note: 'High youth penetration; comedy + music covers travel widely.' },
      instagram: { users_m: 22,  ad_reach_pct: 25, monthly_minutes: null, note: 'Female lean. Beauty + fashion + food top categories.' },
      facebook:  { users_m: 49,  ad_reach_pct: 56, monthly_minutes: null, note: 'Still primary social network for adults 30+.' },
    },
    hot_topic: 'Arabic dialect (Egyptian) outperforms Modern Standard Arabic in conversion. Affordable / value angle resonates strongly.',
  },
  PK: {
    name: 'Pakistan',
    flag: '🇵🇰',
    population_m: 247,
    platforms: {
      tiktok:    { users_m: 54,  ad_reach_pct: 30, monthly_minutes: null, note: 'Largest social platform by daily active. Comedy + lifestyle dominate.' },
      facebook:  { users_m: 51,  ad_reach_pct: 27, monthly_minutes: null, note: 'Primary platform for adults 25+; Urdu-language reels here outperform IG.' },
      youtube:   { users_m: 71,  ad_reach_pct: 38, monthly_minutes: null, note: 'Urdu-language news + entertainment channels dominate.' },
      instagram: { users_m: 17,  ad_reach_pct: 9,  monthly_minutes: null, note: 'Urban skew; English + Urdu both viable.' },
    },
    hot_topic: 'Urdu content travels much further than English. Cricket, food, and family-occasion content are reliable spike drivers.',
  },
  ID: {
    name: 'Indonesia',
    flag: '🇮🇩',
    population_m: 282,
    platforms: {
      tiktok:    { users_m: 126, ad_reach_pct: 55, monthly_minutes: 2300, note: 'Highest TikTok user count outside the US. TikTok Shop is a major channel here.' },
      instagram: { users_m: 102, ad_reach_pct: 47, monthly_minutes: null, note: 'Reels + Stories both strong. Local-language captions essential.' },
      facebook:  { users_m: 122, ad_reach_pct: 53, monthly_minutes: null, note: 'Still dominant across all ages. Bahasa Indonesia non-negotiable.' },
    },
    hot_topic: 'TikTok Shop is the dominant social commerce path. Live shopping during Maghrib (sunset) hits peak conversion windows.',
  },
};

// Return the context block for a workspace's country, or null if unsupported.
// Front-end can render the card; backend can stitch it into the AI prompt.
export function getMarketContext(country) {
  if (!country) return null;
  return MARKET_CONTEXT[String(country).toUpperCase()] || null;
}
