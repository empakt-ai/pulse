// ═════════════════════════════════════════════════════════════════════════
// Structured cultural calendar for Mashal's signal engine.
// Each event has: name, countries[], start (MM-DD or dynamic), end (MM-DD),
// category_boost (which workspace categories benefit most),
// signal_type ('timing' | 'opportunity' | 'warning'),
// advance_days (how many days before start to surface the signal),
// and a brief description of why it matters.
//
// Dynamic events (Ramadan, Eid) are computed separately via
// getIslamicEvents(year) using a Hijri calendar approximation.
// Static events are stored as MM-DD strings.
// ═════════════════════════════════════════════════════════════════════════

// Static cultural events by country. Format: { name, countries, month, day, endMonth?, endDay?, category_boost, advance_days, note }
const STATIC_EVENTS = [
  // ── GCC / MENA ──────────────────────────────────────────────────────
  { name: 'Saudi National Day',      countries: ['SA'],             month: 9,  day: 23, category_boost: ['all'],                  advance_days: 14, note: 'Patriotic content peaks sharply. Brands in all categories should post national pride content.' },
  { name: 'UAE National Day',        countries: ['AE'],             month: 12, day: 2,  category_boost: ['all'],                  advance_days: 14, note: 'Major patriotic moment. Red and green content performs well. Fireworks/events content.' },
  { name: 'Kuwait National Day',     countries: ['KW'],             month: 2,  day: 25, category_boost: ['all'],                  advance_days: 10, note: 'National Day followed by Liberation Day on 26 Feb — two consecutive days of high reach.' },
  { name: 'Kuwait Liberation Day',   countries: ['KW'],             month: 2,  day: 26, category_boost: ['all'],                  advance_days: 7,  note: 'Back-to-back with National Day.' },
  { name: 'Qatar National Day',      countries: ['QA'],             month: 12, day: 18, category_boost: ['all'],                  advance_days: 14, note: 'National pride content. Major events and celebrations.' },
  { name: 'White Friday',            countries: ['SA','AE','KW','QA','BH','OM'], month: 11, day: 22, endMonth: 11, endDay: 29, category_boost: ['retail','fashion','electronics'], advance_days: 21, note: 'GCC equivalent of Black Friday. Highest e-commerce conversion window of the year outside Ramadan.' },

  // ── South Asia ────────────────────────────────────────────────────────
  { name: 'Pakistan Independence Day', countries: ['PK'],           month: 8,  day: 14, category_boost: ['all'],                  advance_days: 14, note: 'Patriotic content peaks. Green and white visual identity.' },
  { name: 'Pakistan Day',             countries: ['PK'],            month: 3,  day: 23, category_boost: ['all'],                  advance_days: 7,  note: 'Resolution Day. National pride content.' },
  { name: 'India Independence Day',   countries: ['IN'],            month: 8,  day: 15, category_boost: ['all'],                  advance_days: 14, note: 'Saffron, white, green content. National pride.' },
  { name: 'India Republic Day',       countries: ['IN'],            month: 1,  day: 26, category_boost: ['all'],                  advance_days: 7,  note: 'Parades and national pride content.' },
  { name: 'Diwali',                   countries: ['IN','PK'],       month: 10, day: 20, endMonth: 10, endDay: 25, category_boost: ['retail','fashion','food_beverage','jewellery'], advance_days: 21, note: 'Largest gifting and retail window in South Asia. Date shifts annually — this is approximate. Verify year.' },
  { name: 'Holi',                     countries: ['IN'],            month: 3,  day: 14, category_boost: ['fashion','food_beverage','all'], advance_days: 14, note: 'Colour and celebration. High social content engagement.' },

  // ── Southeast Asia ────────────────────────────────────────────────────
  { name: 'Indonesia Independence Day', countries: ['ID'],          month: 8,  day: 17, category_boost: ['all'],                  advance_days: 14, note: 'Patriotic content. Red and white imagery.' },
  { name: 'Harbolnas 12.12',           countries: ['ID'],           month: 12, day: 12, category_boost: ['retail','fashion','electronics'], advance_days: 21, note: 'Indonesia\'s largest online shopping day. Biggest e-commerce moment of the year.' },
  { name: '11.11 Singles Day',         countries: ['ID','IN'],      month: 11, day: 11, category_boost: ['retail','fashion','electronics'], advance_days: 14, note: 'Major shopping event. TikTok Shop and Instagram commerce peak.' },

  // ── Turkey ────────────────────────────────────────────────────────────
  { name: 'Turkey Republic Day',       countries: ['TR'],           month: 10, day: 29, category_boost: ['all'],                  advance_days: 10, note: 'National patriotic moment. Red and white flag content.' },
  { name: 'Turkey Victory Day',        countries: ['TR'],           month: 8,  day: 30, category_boost: ['all'],                  advance_days: 7,  note: 'National pride.' },

  // ── Latin America ─────────────────────────────────────────────────────
  { name: 'Brazil Carnaval',           countries: ['BR'],           month: 2,  day: 28, endMonth: 3, endDay: 5, category_boost: ['fashion','food_beverage','music','entertainment'], advance_days: 21, note: 'Highest cultural engagement window of the year. Date shifts annually. Colour, energy, and community content.' },
  { name: 'Brazil Independence Day',   countries: ['BR'],           month: 9,  day: 7,  category_boost: ['all'],                  advance_days: 7,  note: 'National pride content.' },
  { name: 'Black Friday Brazil',       countries: ['BR'],           month: 11, day: 29, endMonth: 11, endDay: 30, category_boost: ['retail','fashion','electronics'], advance_days: 21, note: 'Fully adopted in Brazil. Major retail window.' },

  // ── North America ─────────────────────────────────────────────────────
  { name: 'Canada Day',                countries: ['CA'],           month: 7,  day: 1,  category_boost: ['all'],                  advance_days: 7,  note: 'Patriotic content. Red and white.' },
  { name: 'Canadian Thanksgiving',     countries: ['CA'],           month: 10, day: 13, category_boost: ['food_beverage','retail'], advance_days: 14, note: 'Second Monday of October (approximate). Family and gratitude content.' },
  { name: 'US Independence Day',       countries: ['US'],           month: 7,  day: 4,  category_boost: ['all'],                  advance_days: 7,  note: 'Patriotic content. BBQ, summer, and outdoor categories peak.' },
  { name: 'Black Friday US',           countries: ['US','CA'],      month: 11, day: 28, endMonth: 12, endDay: 2, category_boost: ['retail','fashion','electronics'], advance_days: 21, note: 'Highest retail window of the year. Cyber Monday follows.' },
  { name: 'Halloween',                 countries: ['US','CA','GB'], month: 10, day: 31, category_boost: ['retail','food_beverage','fashion'], advance_days: 21, note: 'Costume and candy content. Retail opportunity for themed products.' },
  { name: 'Valentine\'s Day',          countries: ['US','CA','GB','AE'], month: 2, day: 14, category_boost: ['retail','food_beverage','fashion','health_wellness'], advance_days: 21, note: 'Gifting and romance. Flowers, chocolate, jewellery, fashion.' },

  // ── UK ────────────────────────────────────────────────────────────────
  { name: 'UK Black Friday',           countries: ['GB'],           month: 11, day: 29, category_boost: ['retail','fashion','electronics'], advance_days: 21, note: 'Fully adopted. Major retail window.' },

  // ── Universal ─────────────────────────────────────────────────────────
  { name: 'New Year',                  countries: ['ALL'],          month: 12, day: 28, endMonth: 1, endDay: 5, category_boost: ['all'],    advance_days: 14, note: 'New year resolution content. Fitness, goals, and fresh-start messaging. High engagement cross-category.' },
  { name: 'International Women\'s Day',countries: ['ALL'],          month: 3,  day: 8,  category_boost: ['fashion','health_wellness','saas','all'], advance_days: 10, note: 'Brand purpose and empowerment content. High engagement for women-led and women-focused brands.' },
];

// Islamic events shift ~11 days earlier each Gregorian year.
// These approximations are for 2026 — update the base dates annually.
// For production accuracy, consider integrating a Hijri conversion library.
const ISLAMIC_EVENTS_2026 = [
  { name: 'Ramadan begins',     month: 2,  day: 18, countries: ['SA','AE','KW','QA','BH','OM','EG','PK','IN','TR','ID','MY','ALL_MUSLIM'], advance_days: 21, note: 'Most important content window for Muslim-majority markets. Posting windows shift — post-iftar (sunset) is peak engagement. Consumption-focused content peaks in last 10 days.' },
  { name: 'Laylat al-Qadr',     month: 3,  day: 14, countries: ['SA','AE','KW','QA','BH','OM','EG','PK','IN','TR','ID'], advance_days: 3,  note: 'Night of Power — 27th of Ramadan. Single highest-engagement night of the year in GCC. Spiritual and reflective content.' },
  { name: 'Eid Al-Fitr',        month: 3,  day: 20, endMonth: 3, endDay: 22, countries: ['SA','AE','KW','QA','BH','OM','EG','PK','IN','TR','ID'], advance_days: 14, note: 'End of Ramadan. Gifting, fashion, food, and family content. 3-day celebration.' },
  { name: 'Eid Al-Adha',        month: 6,  day: 27, endMonth: 6, endDay: 30, countries: ['SA','AE','KW','QA','BH','OM','EG','PK','IN','TR','ID'], advance_days: 14, note: 'Sacrifice festival. Fashion, food, and gifting peak. 4-day celebration.' },
];

/**
 * getUpcomingCulturalMoments(country, focusRegions, daysAhead = 45)
 *
 * Returns upcoming cultural events relevant to this workspace, sorted by
 * how soon they arrive. Each event includes how many days away it is.
 *
 * Used by:
 *   1. intelligence.js — injected into buildPayload() so the AI sees upcoming moments
 *   2. (Future Phase 5) — signal engine to auto-emit timing signals
 */
export function getUpcomingCulturalMoments(country, focusRegions = [], daysAhead = 45) {
  const today = new Date();
  const todayMs = today.getTime();
  const countryUpper = (country || 'GLOBAL').toUpperCase();
  const regions = (focusRegions || []).map(r => String(r).toUpperCase());

  // Combine static + Islamic events
  const allEvents = [
    ...STATIC_EVENTS,
    ...ISLAMIC_EVENTS_2026,
  ];

  const upcoming = [];

  for (const event of allEvents) {
    const eventCountries = (event.countries || []).map(c => c.toUpperCase());

    // Check if this event applies to the workspace's country or focus regions
    const isRelevant =
      eventCountries.includes('ALL') ||
      eventCountries.includes('ALL_MUSLIM') ||    // Approximate — refine with workspace religion field later
      eventCountries.includes(countryUpper) ||
      regions.some(r => eventCountries.includes(r));

    if (!isRelevant) continue;

    // Build the event date for this year and next year
    for (const yearOffset of [0, 1]) {
      const year = today.getFullYear() + yearOffset;
      const eventDate = new Date(year, (event.month - 1), event.day);
      const daysUntil = Math.round((eventDate.getTime() - todayMs) / 86400000);

      if (daysUntil >= -3 && daysUntil <= daysAhead) {  // -3 allows surfacing events that just started
        upcoming.push({
          name: event.name,
          days_until: daysUntil,
          date: eventDate.toISOString().split('T')[0],
          advance_days: event.advance_days,
          category_boost: event.category_boost || ['all'],
          note: event.note,
          urgency: daysUntil <= 3 ? 'immediate' : daysUntil <= 7 ? 'this_week' : 'upcoming',
        });
        break; // Found the relevant year, don't double-add
      }
    }
  }

  return upcoming.sort((a, b) => a.days_until - b.days_until);
}

export { STATIC_EVENTS, ISLAMIC_EVENTS_2026 };
