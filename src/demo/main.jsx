// ═════════════════════════════════════════════════════════════════════════
// src/demo/main.jsx — Mashal Demo Page SPA entry.
//
// Concatenated 1:1 from the 4 inline <script type="text/babel">
// blocks that lived in demo.html before the Vite migration. Independent
// of the main SPA and the admin SPA — own React tree, own mount, own
// state. Theme persistence, /css/marketing.css link, and demo-specific
// <style> rules stay inline in demo.html.
//
// Provenance: scripts/extract-demo-blocks.mjs.
// ═════════════════════════════════════════════════════════════════════════

import React from 'react';
import ReactDOM from 'react-dom/client';

// Expose globally for any string-eval / console-debug call sites.
window.React = React;
window.ReactDOM = ReactDOM;

// Brings Tailwind utilities into demo's CSS bundle. demo's React tree
// uses the same brand utility set as the main SPA (bg-ink, text-paper,
// rounded-2xl, etc.) so we share app.css; tailwind.config.js's content
// scan already covers src/demo/**. /css/marketing.css stays linked from
// demo.html for the header/footer chrome — that's plain CSS, not
// Tailwind, and it doesn't conflict.
import '../styles/app.css';

// ─────────────────────────────────────────────────────────────────────────
// Extracted from demo.html lines 202-865
// ─────────────────────────────────────────────────────────────────────────
"use strict";

const PERSONAS = {

  // ───────────────────────────────────────────────────────────────────────
  // CREATOR — Sofia, fitness creator, Toronto.
  // Maps to Claude's spec persona 1.
  // ───────────────────────────────────────────────────────────────────────
  creator: {
    id: 'creator',
    name: 'Creator',
    price: '$15/mo',
    tagline: 'Solo creator finding their format',
    person: {
      handle: '@sofiamoves',
      firstName: 'Sofia',
      niche: 'Fitness & wellness',
      city: 'Toronto, Canada',
      brief_tone: 'Encouraging coach',
      ai_provider: 'Gemini',
    },
    intel: {
      score: 68,
      breakdown: [
        { label: 'Engagement quality', score: 28, max: 40, note: '5.8% avg ER — above platform avg' },
        { label: 'Content cadence',    score: 14, max: 20, note: '5–6 posts/wk, slight dip last week' },
        { label: 'Platform coverage',  score:  9, max: 15, note: '3 of 5 platforms connected' },
        { label: 'Growth velocity',    score: 13, max: 15, note: '1 viral + 2 rising posts (30d)' },
        { label: 'Follower scale',     score:  4, max: 10, note: 'Sub-200K combined' },
      ],
    },
    accounts: [
      { plat: 'ig', label: 'Instagram',  followers: 47300,  delta: 284,   er: 5.8, color: '#D62976', spark: [47016, 47082, 47134, 47155, 47210, 47256, 47300] },
      { plat: 'tt', label: 'TikTok',     followers: 128400, delta: 1840,  er: 8.4, color: '#FF2D6A', spark: [126560, 126840, 127100, 127380, 127700, 128060, 128400] },
      { plat: 'yt', label: 'YouTube',    followers: 22100,  delta: 156,   er: 3.2, color: '#FF0000', spark: [21944, 21972, 22002, 22028, 22054, 22080, 22100] },
    ],
    market: null, // Creator tier — no market context block

    briefs: [
      {
        variant: 'A',
        verdict: "Your Tuesday morning flow reel hit 9.2% ER — 1.6× your 30-day baseline. The 4-minute guided format with a visible timer is what's performing. Post the same structure again before Friday. The algorithm window is still open.",
        actions: [
          { when: 'Now',        plat: 'Instagram · TikTok', text: "Post a second 4-minute morning flow reel within 48 hours. Mirror the format exactly: warm light, no voiceover intro, visible timer from minute one. This format earned 9.2% ER vs your 5.8% average. Cross-post to TikTok the same day." },
          { when: 'Today',      plat: 'Instagram',          text: "Reply to the 23 comments on Tuesday's reel asking 'what mat is that?' — either pin a comment or a Story. These are purchase intent signals. Conversion traffic peaks within 4 hours of a reply spike." },
          { when: 'Today',      plat: 'TikTok',             text: "Your TikTok posting rate dropped to 3 posts last week vs your 6-post average. @movewithkira posted 9 times and picked up 4,200 followers in the same period. Batch-record 3 short clips today while the morning flow format is fresh." },
          { when: 'This week',  plat: 'All platforms',      text: "Saturday and Sunday posts are underperforming weekday content by 38%. Your audience peaks Tuesday–Thursday, 6–9 AM local. Shift the two planned weekend posts to Wednesday and Thursday morning." },
          { when: 'This week',  plat: 'YouTube',            text: "Your 'Morning yoga for beginners' (4 weeks old) has a 3.8% CTR — above your 2.4% channel average and getting organic search. Create a 60-second Shorts cut of it. YouTube boosts channels that publish Shorts alongside long-form in the same week." },
          { when: 'This month', plat: 'Instagram',          text: "Your IG engagement rate (5.8%) is ahead of @healthwithleah (4.1%) and @fitwithamber (3.9%). Your follower gap is the constraint — not content quality. Consider a single co-creation post with one creator in your tier. Cross-audience growth is the fastest path at this follower count." },
        ],
      },
      {
        variant: 'B',
        verdict: "Your TikTok posting rate dropped 50% this week. @movewithkira posted 9 times and grew 4,200 followers in the same period. The Tuesday morning flow format is your strongest asset — batch-record 3 clips today while the format is fresh.",
        actions: [
          { when: 'Now',        plat: 'TikTok',             text: "Batch-record 3 short clips today using the morning flow format. Same warm lighting, same visible timer, same 'no verbal intro' opener that earned 9.2% ER. Post one tonight, schedule the other two for Wednesday and Thursday 7 AM." },
          { when: 'Today',      plat: 'Instagram',          text: "Reply to the 23 'what mat is that?' comments on Tuesday's reel. Pin one comment with the mat link. These are purchase signals — conversion peaks within 4 hours of the reply." },
          { when: 'Today',      plat: 'Instagram · TikTok', text: "Repost Tuesday's morning flow reel to TikTok with no edits. The TikTok audience has not seen it. Same content, zero additional production time." },
          { when: 'This week',  plat: 'All platforms',      text: "Move your Saturday and Sunday content slots to Wednesday and Thursday 7–9 AM. Weekend posts underperform weekday by 38% for your audience." },
          { when: 'This week',  plat: 'YouTube',            text: "Cut a 60-second Shorts version of 'Morning yoga for beginners' — already at 3.8% CTR, above your 2.4% channel average. YouTube favors channels publishing Shorts alongside long-form in the same week." },
          { when: 'This month', plat: 'Instagram',          text: "Reach out to @yoga.flow.daily (54.1K, 87% of your follower count). One co-creation post would expose you to a near-equal audience that shares your aesthetic. Highest-ROI growth play at this follower band." },
        ],
      },
      {
        variant: 'C',
        verdict: "Your '30-day morning challenge' series has 4 detected posts averaging 2.3× your non-series engagement, but no conclusion post yet. A Day 30 finale would close the loop, re-amplify the earlier posts, and signal 'series complete' to viewers who want the next one.",
        actions: [
          { when: 'Now',        plat: 'Instagram · TikTok', text: "Post the Day 30 finale of your morning challenge series this week. Reference Days 1, 15, and 22 by name — the algorithm rewards series that close. Expect the earlier posts in the series to see a 15–25% reach lift." },
          { when: 'Today',      plat: 'Instagram',          text: "Pin a comment on your Day 22 reel with: 'Day 30 coming Friday — drop a 🌅 if you want the next 30.' This pre-commits an audience for the next challenge and tells the algorithm 'this content has demand.'" },
          { when: 'Today',      plat: 'TikTok',             text: "Cross-post the Day 22 reel to TikTok. The TT audience hasn't seen the series and 5.9% ER on IG suggests format strength. Batch with 2 more clips so TikTok cadence matches your IG cadence this week." },
          { when: 'This week',  plat: 'Instagram',          text: "Reply to the 23 'what mat is that?' comments on Tuesday's reel — purchase intent signals. Pin a comment with the link. Conversion peaks within 4 hours of a reply spike." },
          { when: 'This week',  plat: 'All platforms',      text: "Saturday/Sunday posts run 38% below weekday content for your audience. Shift weekend slots to Wed/Thu 7 AM. Use the spare weekend capacity to batch the next challenge." },
          { when: 'This month', plat: 'Instagram',          text: "Sketch the next 30-day arc before the finale lands. Audience momentum after a series finale lasts 5–7 days — having Day 1 of the next ready captures it. Suggested theme based on your top-performing hooks: 'morning movement for slow risers.'" },
        ],
      },
    ],

    signals: [
      { type: 'viral',     color: 'amber',   title: 'Morning flow reel at 9.2% ER',           body: "Tuesday Instagram reel is running 1.6× your 30-day engagement baseline. 84,200 views, 4,180 likes, 2,840 saves. The 4-minute guided timer format is the variable." },
      { type: 'gap',       color: 'magenta', title: 'TikTok posting rate dropped 50%',        body: "Last week: 3 posts. Your average: 6. @movewithkira posted 9 times and gained 4,200 followers in the same period. The gap is widening." },
      { type: 'series',    color: 'ultra',   title: '30-day challenge has no conclusion post', body: "Your morning challenge series (4 detected posts) averages 2.3× your non-series content. No Day 30 finale detected. A conclusion post could close the loop and re-amplify the earlier posts." },
      { type: 'timing',    color: 'lime',    title: 'Weekend posts 38% below weekday avg',    body: "Saturday and Sunday posts consistently underperform. Best posts land Tuesday–Thursday 06:00–09:00 local. Two upcoming posts are scheduled for the weekend." },
    ],

    competitors: [
      { handle: '@movewithkira',    plat: 'tt', them: 203000, you: 128400, pct: 63 },
      { handle: '@healthwithleah',  plat: 'ig', them:  89400, you:  47300, pct: 53 },
      { handle: '@fitwithamber',    plat: 'ig', them:  67200, you:  47300, pct: 70 },
      { handle: '@yoga.flow.daily', plat: 'ig', them:  54100, you:  47300, pct: 87 },
      { handle: '@strong.with.sam', plat: 'yt', them:  41000, you:  22100, pct: 54 },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // PRO CREATOR — Kai Tanaka, NYC food creator, K/J-fusion, multilingual.
  // New persona (not in Claude's spec). Designed to surface Pro-Creator-only
  // features: 7 platforms incl. X & Snapchat, market context, weekly recap,
  // multilingual brief, PDF reports.
  // ───────────────────────────────────────────────────────────────────────
  pro_creator: {
    id: 'pro_creator',
    name: 'Pro Creator',
    price: '$29/mo',
    tagline: 'Established creator going full-stack',
    person: {
      handle: '@kaicooks',
      firstName: 'Kai',
      niche: 'Asian-fusion cooking · K/J/SE-Asian',
      city: 'Brooklyn, NY',
      brief_tone: 'Strategic',
      ai_provider: 'Claude',
    },
    intel: {
      score: 76,
      breakdown: [
        { label: 'Engagement quality', score: 32, max: 40, note: 'Top quartile on 5 of 7 platforms' },
        { label: 'Content cadence',    score: 17, max: 20, note: '7+ posts/wk distributed across platforms' },
        { label: 'Platform coverage',  score: 15, max: 15, note: 'All 7 platforms connected (Pro Creator)' },
        { label: 'Growth velocity',    score: 10, max: 15, note: '1 viral, 4 rising posts (30d)' },
        { label: 'Follower scale',     score:  2, max: 10, note: '340K combined — scale is the gap' },
      ],
    },
    accounts: [
      { plat: 'ig', label: 'Instagram', followers: 92000,  delta: 640,  er: 4.4, color: '#D62976', spark: [90810, 91020, 91240, 91500, 91720, 91880, 92000] },
      { plat: 'tt', label: 'TikTok',    followers: 178000, delta: 3200, er: 7.2, color: '#FF2D6A', spark: [173400, 174200, 175100, 176000, 176900, 177500, 178000] },
      { plat: 'yt', label: 'YouTube',   followers: 31000,  delta: 420,  er: 4.1, color: '#FF0000', spark: [30420, 30540, 30660, 30780, 30880, 30950, 31000] },
      { plat: 'fb', label: 'Facebook',  followers: 18200,  delta:  80,  er: 1.6, color: '#1877F2', spark: [18068, 18094, 18116, 18138, 18160, 18180, 18200] },
      { plat: 'li', label: 'LinkedIn',  followers:  4280,  delta:  72,  er: 3.8, color: '#0A66C2', spark: [ 4136,  4172,  4198,  4220,  4242,  4262,  4280] },
      { plat: 'x',  label: 'X',         followers:  8540,  delta:  60,  er: 1.9, color: '#0A0A0B', spark: [ 8420,  8448,  8470,  8490,  8508,  8525,  8540] },
      { plat: 'sc', label: 'Snapchat',  followers: 11200,  delta: 340,  er: 3.4, color: '#FFFC00', spark: [10520, 10680, 10830, 10960, 11070, 11150, 11200] },
    ],
    market: {
      home: { country: 'United States', followers_band: '320K–360K', notes: 'Primary audience: NY/CA + secondary in Toronto.' },
      focus: [
        { country: 'South Korea',    note: 'K-food creator overlap audience — Lunar New Year window opens in 9 days. Past LNY content peaked Day 3, then dropped because dish names weren\'t seeded early.' },
        { country: 'Japan',          note: 'Bilingual caption pickup on TikTok JP averages 1.4× US engagement. Currently 12% of TikTok views.' },
      ],
      calendar: ['Lunar New Year — 9 days', 'Setsubun (Japan) — 13 days', 'Black History Month — active'],
    },

    briefs: [
      {
        variant: 'A',
        verdict: "Your kimchi pancake series is at 1.8× baseline on TikTok — 240K plays this week. The Lunar New Year window opens in 9 days. Your 2024 LNY content peaked Day 3 then dropped because you stopped seeding dish names. Pre-build a 5-post arc with bilingual captions before the window opens.",
        actions: [
          { when: 'Now',        plat: 'Instagram · TikTok', text: "Add Korean dish names to your existing kimchi pancake captions — '김치전' alongside the English. The bilingual signal lifts Korean-audience reach 22% on TikTok per your last 90 days." },
          { when: 'Today',      plat: 'Snapchat',           text: "Cross-post the kimchi pancake reel to Snapchat. Your SC audience is 11.2K and grew +340 last week — fastest of any of your platforms. Snapchat is undervalued for food content in your demographic." },
          { when: 'Today',      plat: 'LinkedIn',           text: "Post on LinkedIn: 'restaurant-quality kimchi pancakes in 12 minutes at home' with a process shot. LI is at 3.8% ER (your highest engagement platform this week). Pro-account chefs, food editors, and cookbook agents check this content on LI more than IG." },
          { when: 'This week',  plat: 'All platforms',      text: "Pre-build a 5-post Lunar New Year arc. Seed dish names early (Day 1 in caption, hashtag, and on-screen text). Your 2024 LNY content underperformed because dish names appeared Day 4. Estimated reach lift: 1.4–1.7×." },
          { when: 'This week',  plat: 'YouTube',            text: "Long-form: '5 Lunar New Year dishes I learned from my halmoni' — 10-minute format. Your last long-form (kimchi-jjigae) is still climbing 6 weeks in. LNY long-form content gets searched in the 2 weeks pre-holiday." },
          { when: 'This month', plat: 'Reports',            text: "Generate this week's recap PDF and email it to your management. The Lunar New Year prep + kimchi series performance data is the strongest case for a Korean grocery partnership you've had in 6 months. One click from the Reports screen." },
        ],
      },
      {
        variant: 'B',
        verdict: "Snapchat picked up +340 followers this week — your fastest-growing platform. Snapchat penetration in your secondary Korean audience is 39% (per Pew 2026) and your kimchi pancake content has not yet crossed over. The opportunity here is bigger than your IG and TT combined for this week's window.",
        actions: [
          { when: 'Now',        plat: 'Snapchat',           text: "Post 3 Snaps from your kimchi pancake reel — the timer-on-screen format works on Snapchat with no edits. Add Korean dish names to the on-screen text." },
          { when: 'Today',      plat: 'Snapchat',           text: "Build a Snapchat Lens-style sticker for the LNY week: a single 'kimchi pancake countdown' graphic. Stickers extend organic reach without paid spend. Free, 20-minute build." },
          { when: 'Today',      plat: 'Instagram · TikTok', text: "Update kimchi pancake captions with bilingual dish names. '김치전' in caption + on-screen. Lift on Korean-audience TikTok reach: 22% per your last 90 days." },
          { when: 'This week',  plat: 'LinkedIn',           text: "LI post: 'How I scaled an Asian-fusion content channel to 340K without a team.' LI loves the 'how I built this' format. Your follower band (4.2K) is the constraint — but ER is 3.8% (top quartile for food creators on LI)." },
          { when: 'This week',  plat: 'YouTube',            text: "Cut a YouTube Shorts of the kimchi pancake reel + your halmoni story. Shorts that lead with a personal connection outperform recipe-first Shorts 2.1× on your channel per the last 30 days." },
          { when: 'This month', plat: 'Reports',            text: "PDF recap to your manager + Korean grocery partnership outreach. LNY prep performance is the strongest case for the partnership you've had in 6 months." },
        ],
      },
      {
        variant: 'C',
        verdict: "Lunar New Year is in 9 days. Your 2024 LNY content peaked Day 3 and dropped because dish names appeared in Day 4 captions, not Day 1. This year you have time to seed the names early, build a 5-post arc, and ride the search window for the full 14-day pre-holiday period. The kimchi pancake series is the right opening post.",
        actions: [
          { when: 'Now',        plat: 'Instagram · TikTok', text: "Lock the LNY arc: 5 posts, 1 per day Day 9 → Day 5. Open with kimchi pancake (already viral). Close with a dumplings reel — your highest-saving food category historically. Each caption opens with the Korean dish name." },
          { when: 'Today',      plat: 'YouTube',            text: "Record the 10-min long-form: '5 LNY dishes I learned from my halmoni.' Publish Day 7 before the LNY peak. Long-form search traffic peaks 2–3 days before the holiday." },
          { when: 'Today',      plat: 'Snapchat',           text: "Schedule the LNY Snapchat run: 1 Snap per day, Days 9 → 1. SC engagement is at 3.4% (top half of your platforms) and audience is your fastest-growing this week." },
          { when: 'This week',  plat: 'LinkedIn',           text: "Single LNY-themed LI post: 'How food creators should think about cultural calendar windows.' LI's B2B angle reaches editors, brand managers, and cookbook agents who watch this kind of meta-content." },
          { when: 'This week',  plat: 'All platforms',      text: "Pre-write all 5 captions in English + Korean. Bilingual signal lifts Korean-audience reach 22% on TT, 14% on IG, 31% on SC. Total estimated reach lift across the arc: 1.5–1.8×." },
          { when: 'This month', plat: 'Reports',            text: "Weekly recap PDF after the LNY window closes. Send to your manager plus the Korean grocery partner you've been talking to. The LNY arc performance is the partnership case." },
        ],
      },
    ],

    signals: [
      { type: 'viral',      color: 'amber',   title: 'Kimchi pancake series at 1.8× baseline',      body: "240K TikTok plays this week, 11.4K saves. The 'recipe in 60 seconds, then halmoni story' format is the variable. Series detected — Part 2 and 3 should keep the format." },
      { type: 'cultural',   color: 'ultra',   title: 'Lunar New Year window opens in 9 days',       body: "Korean-audience search for LNY recipes peaks 2 weeks pre-holiday. Your 2024 LNY content peaked Day 3 then dropped because dish names appeared late. This year you have time to seed." },
      { type: 'multilingual', color: 'lime',  title: 'Bilingual captions lift Korean reach 22%',    body: "Posts with 김치, 빵, or 떡 in caption + on-screen text average 22% higher Korean-audience reach on TikTok. Currently 3 of your last 12 posts use bilingual captions." },
      { type: 'platform',   color: 'magenta', title: 'Snapchat +340 in one week — fastest platform', body: "Snapchat audience grew faster than any other platform this week. Your kimchi pancake content has not been cross-posted there. Opportunity for ~50K incremental reach this week." },
      { type: 'series',     color: 'ultra',   title: 'Long-form YouTube still climbing 6 weeks in',  body: "'Kimchi-jjigae from scratch' (6 weeks old) is still gaining 800–1,200 views/day. YouTube search traffic. A 60-second Shorts cut would compound the algorithmic lift." },
    ],

    competitors: [
      { handle: '@maangchi',     plat: 'yt', them: 6300000, you:  31000, pct:  0.5 },
      { handle: '@joshuaweissman',plat:'yt', them: 9800000, you:  31000, pct:  0.3 },
      { handle: '@frankie.gaw',  plat: 'ig', them:  484000, you:  92000, pct: 19 },
      { handle: '@eric.kim',     plat: 'ig', them:   72000, you:  92000, pct: 128 },
      { handle: '@asianboysco',  plat: 'tt', them:  340000, you: 178000, pct: 52 },
      { handle: '@cookingwithlynja', plat: 'tt', them: 16200000, you: 178000, pct: 1.1 },
      { handle: '@dumplingsisters', plat:'yt', them:  124000, you:  31000, pct: 25 },
      { handle: '@chefjune',     plat: 'ig', them:  152000, you:  92000, pct: 61 },
      { handle: '@hyosun.kim',   plat: 'ig', them:  280000, you:  92000, pct: 33 },
      { handle: '@kwoowk',       plat: 'tt', them:   89000, you: 178000, pct: 200 },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // BRAND — Noor Home, home fragrance. Toronto + GCC focus.
  // From Claude's spec.
  // ───────────────────────────────────────────────────────────────────────
  brand: {
    id: 'brand',
    name: 'Brand',
    price: '$99/mo',
    tagline: 'Retail brand with paid + organic',
    person: {
      handle: '@noorhome',
      firstName: 'Noor Home',
      niche: 'Home fragrance · Retail',
      city: 'Toronto + UAE / KSA focus',
      brief_tone: 'Strategic',
      ai_provider: 'Claude',
    },
    intel: {
      score: 74,
      breakdown: [
        { label: 'Engagement quality', score: 30, max: 40, note: 'Above category avg on 6 of 7 platforms' },
        { label: 'Content cadence',    score: 16, max: 20, note: 'Consistent across all 7 platforms' },
        { label: 'Platform coverage',  score: 15, max: 15, note: 'All 7 platforms connected' },
        { label: 'Growth velocity',    score: 10, max: 15, note: '2 viral + 3 rising posts (30d)' },
        { label: 'Follower scale',     score:  3, max: 10, note: 'Sub-500K combined — scale is the growth lane' },
      ],
    },
    accounts: [
      { plat: 'ig', label: 'Instagram', followers: 184200, delta: 1240, er: 3.1, color: '#D62976', spark: [181800, 182300, 182780, 183220, 183600, 183920, 184200] },
      { plat: 'tt', label: 'TikTok',    followers:  67800, delta: 2100, er: 6.8, color: '#FF2D6A', spark: [64720, 65120, 65560, 66100, 66700, 67280, 67800] },
      { plat: 'yt', label: 'YouTube',   followers:  18400, delta:  180, er: 2.4, color: '#FF0000', spark: [18154, 18190, 18224, 18256, 18306, 18356, 18400] },
      { plat: 'fb', label: 'Facebook',  followers:  41200, delta:  290, er: 1.8, color: '#1877F2', spark: [40712, 40798, 40884, 40970, 41056, 41132, 41200] },
      { plat: 'li', label: 'LinkedIn',  followers:   8900, delta:  140, er: 4.2, color: '#0A66C2', spark: [ 8580,  8642,  8710,  8770,  8820,  8862,  8900] },
      { plat: 'x',  label: 'X',         followers:  12300, delta:   80, er: 1.4, color: '#0A0A0B', spark: [12160, 12182, 12210, 12238, 12262, 12282, 12300] },
      { plat: 'sc', label: 'Snapchat',  followers:  34600, delta:  420, er: 5.2, color: '#FFFC00', spark: [33800, 33960, 34120, 34280, 34420, 34520, 34600] },
    ],
    market: {
      home: { country: 'Canada (primary)', followers_band: '350K–400K', notes: 'Toronto/Vancouver dominant. Category benchmark ER for home fragrance: 2.8%.' },
      focus: [
        { country: 'United Arab Emirates', note: 'Snapchat penetration 76% — highest globally. Peak content window Thu–Sat 20:00–22:00 GST.' },
        { country: 'Saudi Arabia',         note: 'E-commerce GMV 2026: $60.4B (34% of MENA). Social commerce index Tier 1 — highest engagement with in-app shopping.' },
      ],
      calendar: ['Eid Al-Adha — 18 days', 'Saudi National Day — 47 days', 'Ramadan prep window — 84 days'],
    },

    briefs: [
      {
        variant: 'A',
        verdict: "Your Eid gifting reel series has driven 41% above-baseline reach across Instagram and Snapchat over 5 days. Scenthaus posted similar content 3 days after you and underperformed by 34%. Push the series to TikTok this week before the window closes — you have first-mover advantage and the 18-day Eid window is open.",
        actions: [
          { when: 'Now',       plat: 'TikTok',                text: "Cross-post the Eid gifting reel series to TikTok today. The IG version is at 3.8% ER (41% above your baseline). The TT audience has not seen this content. Post 2 of the 3 reels today, schedule the third for tomorrow morning." },
          { when: 'Now',       plat: 'Ads — X → TikTok',      text: "Your X ad spend has a Spot Score of 28 — bottom quartile for home fragrance in your region. Pause X spend and reallocate to TikTok In-Feed for the Eid window. TikTok Spot Score is 84. This is where the organic momentum is strongest." },
          { when: 'Today',     plat: 'Snapchat',              text: "Snapchat ER is 5.2% this week — highest across all your platforms. Your SC audience is concentrated in UAE and KSA where Eid content has heightened relevance. Add one Snap per day for the next 4 days designed for the GCC audience." },
          { when: 'This week', plat: 'TikTok',                text: "LuxWick ran a campaign in the first week of Eid that got 2.1M views on TikTok. The format was UGC-style testimonials, not polished product shots. Your last 3 TikTok posts were polished. Test one phone-recorded UGC video this week against your current format." },
          { when: 'This week', plat: 'LinkedIn',              text: "LinkedIn is your highest ER platform this week (4.2%). The B2B opportunity: wholesale gifting for corporate clients. One LI post framing your candles as corporate Eid gifts with a bulk inquiry CTA could open a revenue channel social doesn't serve." },
          { when: 'This month',plat: 'Reports',               text: "Generate this week's performance PDF and share it with your wholesale partners. The Eid window data is the strongest case for a gifting partnership you've had in 6 months. One click from Reports." },
        ],
      },
      {
        variant: 'B',
        verdict: "Your X ad spend (Spot Score 28) is the largest single dollar inefficiency this week. Reallocating $480/mo to TikTok (Spot Score 84) at category benchmark would lift impressions ~3.4× at the same spend. Do this before the Eid window peaks in 18 days.",
        actions: [
          { when: 'Now',       plat: 'Ads',                   text: "Pause X campaigns. Your CTR is 0.6% vs 1.24% category benchmark for home fragrance. Reallocate the full $480/mo to TikTok In-Feed where your Spot Score is 84." },
          { when: 'Today',     plat: 'Ads',                   text: "Add Meta Reels as a placement on the Eid gifting campaign. Reels CPMs run 15–25% lower than Feed for awareness in your category. Currently the campaign targets Feed only." },
          { when: 'Today',     plat: 'Snapchat',              text: "Schedule 4 Snapchat snaps for the next 4 days. UAE/KSA Eid content. Your SC audience is 5.2% ER, your highest." },
          { when: 'This week', plat: 'TikTok',                text: "Cross-post the Eid gifting reels (already viral on IG) to TikTok. Zero production cost, untapped audience." },
          { when: 'This week', plat: 'Ads',                   text: "Add a conversion-objective Meta campaign for the 18-day Eid window. Awareness + conversion running together during high-intent periods improves ROAS 20–30% vs single-objective." },
          { when: 'This month',plat: 'Integrations',          text: "Connect WhatsApp Business Catalog. For UAE/KSA, WhatsApp is a primary B2C path. Enables click-to-WhatsApp ads on Meta at typically lower CPL than standard lead-gen." },
        ],
      },
      {
        variant: 'C',
        verdict: "LuxWick gained 8,400 TikTok followers last week — their fastest week this quarter. They posted 6 videos, 4 of which were UGC-style testimonials. Your last 3 TikTok posts were polished product shots. The category is voting for UGC. Test one phone-recorded UGC video this week.",
        actions: [
          { when: 'Now',       plat: 'TikTok',                text: "Film one phone-only UGC-style TikTok today: a customer or your founder, 30 seconds, single take, talking about one candle. No lighting setup, no edit. This is the format LuxWick rode to 8,400 new followers last week." },
          { when: 'Today',     plat: 'TikTok',                text: "Cross-post the Eid gifting reels from IG. Free reach. The TT audience hasn't seen this." },
          { when: 'Today',     plat: 'Snapchat',              text: "Snapchat ER is 5.2% — your highest platform this week. Schedule 4 Eid-themed snaps for UAE/KSA audience." },
          { when: 'This week', plat: 'Ads',                   text: "Pause X ads (Spot Score 28). Move spend to TikTok (Spot Score 84) for the Eid window." },
          { when: 'This week', plat: 'LinkedIn',              text: "Post: 'Why retail brands underestimate Snapchat in GCC' — your LI audience are brand operators, this kind of meta-content reaches them. ER on LI is 4.2% (your best ER this week)." },
          { when: 'This month',plat: 'Reports',               text: "Generate the weekly performance PDF and share with wholesale partners. The Eid window performance is your strongest gifting-partnership case in 6 months." },
        ],
      },
    ],

    signals: [
      { type: 'viral',     color: 'amber',   title: 'Eid gifting reel series at 41% above baseline', body: "3-reel Eid gifting series on Instagram and Snapchat — 41% above-baseline reach over 5 days. Scenthaus posted similar content 3 days later and underperformed by 34%. First-mover window open." },
      { type: 'ad',        color: 'magenta', title: 'X ad spend scoring 28/100 Spot Score',          body: "Your X CTR (0.6%) is 52% below the category benchmark (1.24%) for home fragrance in your region. $480/month is underperforming. Reallocate to TikTok where your score is 84." },
      { type: 'cultural',  color: 'ultra',   title: 'Eid Al-Adha begins in 18 days',                  body: "High-intent shopping window opens in 18 days across UAE and KSA. GCC-market brands see 2.4× average social commerce conversion in the 14 days pre-Eid. Gifting content is the primary organic driver." },
      { type: 'platform',  color: 'lime',    title: 'Eid reel series not yet posted to TikTok',       body: "The 3 IG Eid reels have not been cross-posted to TikTok where your Spot Score and organic ER are both strong. The content exists. Zero-cost reach opportunity." },
      { type: 'competitor',color: 'amber',   title: 'LuxWick gained 8,400 TT followers last week',    body: "LuxWick posted 6 TikTok videos last week, 4 UGC-style testimonials. Their account grew 8,400 followers — their fastest week this quarter. Production style noticeably different from your polished product shots." },
    ],

    competitors: [
      { handle: '@scenthaus',      plat: 'ig', them: 220000, you: 184200, pct: 84 },
      { handle: '@luxwick',        plat: 'ig', them: 168000, you: 184200, pct: 110 },
      { handle: '@boy.smells',     plat: 'ig', them: 412000, you: 184200, pct: 45 },
      { handle: '@otherland',      plat: 'ig', them: 298000, you: 184200, pct: 62 },
      { handle: '@arabian.oud.uae',plat: 'ig', them: 540000, you: 184200, pct: 34 },
      { handle: '@bath.body.works',plat: 'ig', them:8200000, you: 184200, pct:  2.2 },
      { handle: '@diptyqueparis',  plat: 'ig', them:1800000, you: 184200, pct: 10 },
      { handle: '@homesick',       plat: 'tt', them: 124000, you:  67800, pct: 55 },
      { handle: '@candlesofficial',plat: 'tt', them: 280000, you:  67800, pct: 24 },
      { handle: '@scentbird',      plat: 'sc', them:  98000, you:  34600, pct: 35 },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // AGENCY — Clover & Co, 4 client workspaces.
  // Defaults to Verde Eats. Workspace dropdown rotates active data.
  // From Claude's spec.
  // ───────────────────────────────────────────────────────────────────────
  agency: {
    id: 'agency',
    name: 'Agency',
    price: '$449/mo',
    tagline: 'Multi-client team with white-label reporting',
    person: {
      handle: 'Clover & Co · 4 active client workspaces',
      firstName: '',
      niche: 'Multi-client agency',
      city: 'Toronto · Dubai · London (team seats)',
      brief_tone: 'Mixed — per workspace',
      ai_provider: 'Claude + Gemini',
    },
    intel: { score: null, breakdown: [] }, // Agency-level intel shown per-workspace
    accounts: [],
    market: null,
    workspaces: [

      // Verde Eats — default agency workspace.
      {
        id: 'verde',
        name: 'Verde Eats',
        category: 'Food & Beverage',
        city: 'Toronto, Canada',
        platforms: 'IG · TT · FB',
        tone: 'Analytical',
        language: 'English',
        ai: 'Gemini',
        intel: {
          score: 61,
          breakdown: [
            { label: 'Engagement quality', score: 26, max: 40, note: 'TT above category, IG slightly below' },
            { label: 'Content cadence',    score: 11, max: 20, note: 'IG dropped to 2 posts last week (avg 5)' },
            { label: 'Platform coverage',  score:  9, max: 15, note: '3 platforms — YT and LI gap' },
            { label: 'Growth velocity',    score:  9, max: 15, note: '1 viral, 1 rising (30d)' },
            { label: 'Follower scale',     score:  6, max: 10, note: '51K combined' },
          ],
        },
        accounts: [
          { plat: 'ig', label: 'Instagram', followers: 28400, delta: 120, er: 4.1, color: '#D62976', spark: [28160, 28210, 28250, 28290, 28320, 28360, 28400] },
          { plat: 'tt', label: 'TikTok',    followers: 14200, delta: 480, er: 6.2, color: '#FF2D6A', spark: [13580, 13680, 13780, 13900, 14020, 14110, 14200] },
          { plat: 'fb', label: 'Facebook',  followers:  9100, delta:  40, er: 1.6, color: '#1877F2', spark: [ 9024,  9036,  9050,  9064,  9078,  9090,  9100] },
        ],

        briefs: [
          {
            variant: 'A',
            verdict: "Tuesday TikTok recipe video: 48,200 plays, 6.2% ER — 2.1× the 30-day TikTok average (2.9%). Instagram posting frequency dropped to 2 posts last week vs 5-post average. GreenBowl posted 8 times on Instagram and gained 840 followers vs Verde Eats' 120 in the same period.",
            actions: [
              { when: 'Now',        plat: 'Instagram', text: "Cross-post Tuesday's TikTok recipe video to Instagram Reels today. 48,200 TT plays, 6.2% ER. IG organic reach is currently 3.1× higher for reels cross-posted from TikTok in this category. Same content, zero production cost." },
              { when: 'Today',      plat: 'Instagram', text: "Instagram frequency must increase to 5 posts minimum this week. GreenBowl posted 8 times last week and gained 840 followers; Verde Eats posted 2 times and gained 120. The algorithm differential at this gap is estimated at 4–6× reach suppression." },
              { when: 'Today',      plat: 'TikTok',    text: "Pin a comment on Tuesday's recipe video with the full ingredient list. Save rate is at 8.4% (top decile). Pinned comments with ingredient lists convert saves into recipe-replays (replays count as views)." },
              { when: 'This week',  plat: 'All',       text: "Sat 12:00–14:00 is the top-performing window in the Verde Eats heatmap (density 9/10). 0 posts were scheduled there last week. Schedule at least 2 posts in this window across IG and TT this week." },
              { when: 'This week',  plat: 'TikTok',    text: "Test a 'sauce in a jar' format as the next series. Your last 3 highest-ER posts all had a single-ingredient hero in the first 2 seconds. Sauce-in-jar is a category match." },
              { when: 'This month', plat: 'YouTube',   text: "Open the YouTube account. Verde Eats has 3 already-recorded recipe videos sitting unpublished. Publishing them with no further production effort opens an additional discovery surface." },
            ],
          },
          {
            variant: 'B',
            verdict: "GreenBowl gained 840 IG followers last week posting 8 times; Verde Eats gained 120 posting 2 times. The cadence gap is widening. Tuesday's TikTok recipe video proves the format works — the question is whether you ship enough of it on Instagram.",
            actions: [
              { when: 'Now',        plat: 'Instagram', text: "Schedule 5 Instagram posts for the week. 2 should be reposts of Tuesday's TikTok recipe (one Reel, one carousel of the ingredient grid)." },
              { when: 'Today',      plat: 'TikTok',    text: "Pin the ingredient list on Tuesday's recipe video. Saves at 8.4% are top decile; pinned ingredients convert saves into replays." },
              { when: 'Today',      plat: 'Instagram', text: "Cross-post Tuesday's TikTok to IG Reels today. 48K plays, 6.2% ER, zero additional production cost." },
              { when: 'This week',  plat: 'All',       text: "Use the Sat 12:00–14:00 peak window for 2 posts this week — currently empty in the schedule." },
              { when: 'This week',  plat: 'TikTok',    text: "Test the 'sauce in a jar' format. Single-ingredient hero in first 2 seconds matches your top 3 ER posts." },
              { when: 'This month', plat: 'YouTube',   text: "Publish the 3 unposted Verde Eats recipe videos to YT. No further production cost; opens a discovery surface." },
            ],
          },
          {
            variant: 'C',
            verdict: "The Sat 12:00–14:00 posting window has a density score of 9/10 in the Verde Eats heatmap, but 0 posts were scheduled there last week. Filling this single slot is the highest-leverage scheduling change this month.",
            actions: [
              { when: 'Now',        plat: 'All',       text: "Schedule 2 posts in the Sat 12:00–14:00 window this week. Reuse Tuesday's TikTok content (cross-post) — no production cost." },
              { when: 'Today',      plat: 'Instagram', text: "Cross-post Tuesday's TikTok recipe to IG Reels — 48K plays, 6.2% ER." },
              { when: 'Today',      plat: 'TikTok',    text: "Pin the ingredient list on Tuesday's recipe video to convert saves into replays." },
              { when: 'This week',  plat: 'Instagram', text: "Increase IG cadence to 5 posts (currently 2). GreenBowl posted 8 last week and gained 7× your followers." },
              { when: 'This week',  plat: 'TikTok',    text: "Plan the 'sauce in a jar' series — matches your top-ER hook formula." },
              { when: 'This month', plat: 'YouTube',   text: "Publish the 3 unposted Verde Eats recipes to YT. Free discovery surface." },
            ],
          },
        ],

        signals: [
          { type: 'viral',     color: 'amber',   title: 'TT recipe video at 6.2% ER',           body: "Tuesday recipe video crossed the 6% ER threshold. 48,200 plays. Save rate 8.4% (top decile)." },
          { type: 'gap',       color: 'magenta', title: 'IG cadence dropped to 2 posts/wk',     body: "GreenBowl posted 8 times and gained 840 followers; Verde Eats posted 2 and gained 120. Cadence gap is the constraint." },
          { type: 'timing',    color: 'ultra',   title: 'Sat 12:00–14:00 window empty',         body: "Heatmap density 9/10 in the Sat 12:00–14:00 slot. 0 posts scheduled there last week. Highest-leverage scheduling change available." },
          { type: 'platform',  color: 'lime',    title: '3 unposted YT videos in account',      body: "3 recipe videos already recorded and unpublished. Zero production cost to ship. Opens YouTube discovery surface." },
        ],

        competitors: [
          { handle: '@greenbowl',     plat: 'ig', them: 41200, you: 28400, pct: 69 },
          { handle: '@sproutkitchen', plat: 'ig', them: 32100, you: 28400, pct: 89 },
          { handle: '@plantfwd',      plat: 'tt', them: 28400, you: 14200, pct: 50 },
          { handle: '@verdebowl.ca',  plat: 'ig', them: 19800, you: 28400, pct: 143 },
        ],
      },

      // Noor Home — reuses the Brand persona content. Dedicated workspace
      // here so it shows up in the agency switcher with proper labels.
      {
        id: 'noor',
        name: 'Noor Home',
        category: 'Retail / Home fragrance',
        city: 'Toronto + UAE focus',
        platforms: 'All 7',
        tone: 'Strategic',
        language: 'English',
        ai: 'Claude',
        intel: {
          score: 74,
          breakdown: [
            { label: 'Engagement quality', score: 30, max: 40, note: 'Above category avg on 6 of 7' },
            { label: 'Content cadence',    score: 16, max: 20, note: 'Consistent across all 7' },
            { label: 'Platform coverage',  score: 15, max: 15, note: 'All 7 connected' },
            { label: 'Growth velocity',    score: 10, max: 15, note: '2 viral + 3 rising (30d)' },
            { label: 'Follower scale',     score:  3, max: 10, note: 'Sub-500K combined' },
          ],
        },
        accounts: [
          { plat: 'ig', label: 'Instagram', followers: 184200, delta: 1240, er: 3.1, color: '#D62976', spark: [181800, 182300, 182780, 183220, 183600, 183920, 184200] },
          { plat: 'tt', label: 'TikTok',    followers:  67800, delta: 2100, er: 6.8, color: '#FF2D6A', spark: [64720, 65120, 65560, 66100, 66700, 67280, 67800] },
          { plat: 'sc', label: 'Snapchat',  followers:  34600, delta:  420, er: 5.2, color: '#FFFC00', spark: [33800, 33960, 34120, 34280, 34420, 34520, 34600] },
        ],

        briefs: [
          {
            variant: 'A',
            verdict: "Eid gifting reels at 41% above baseline on IG and Snapchat. Scenthaus posted similar content 3 days later and underperformed by 34%. Push the series to TikTok this week before the 18-day Eid window closes.",
            actions: [
              { when: 'Now',       plat: 'TikTok',                text: "Cross-post Eid gifting reels to TikTok today. The TT audience hasn't seen them. Same content, zero production cost." },
              { when: 'Now',       plat: 'Ads — X → TikTok',      text: "Pause X ads (Spot Score 28). Reallocate to TikTok In-Feed (Spot Score 84) for the Eid window." },
              { when: 'Today',     plat: 'Snapchat',              text: "4 Eid-themed snaps over the next 4 days for UAE/KSA audience. SC ER is 5.2% — your highest." },
              { when: 'This week', plat: 'TikTok',                text: "Test a single UGC-style TikTok against your polished product shots. LuxWick rode UGC to +8,400 followers last week." },
              { when: 'This week', plat: 'LinkedIn',              text: "Frame candle collections as corporate Eid gifts on LI with a bulk inquiry CTA. LI ER is 4.2% this week — your highest." },
              { when: 'This month',plat: 'Reports',               text: "Generate the Eid window performance PDF and share with wholesale partners." },
            ],
          },
          {
            variant: 'B',
            verdict: "Reallocate $480/mo from X (Spot Score 28) to TikTok (Spot Score 84). 3.4× impression lift at the same spend. Do this before Eid peaks in 18 days.",
            actions: [
              { when: 'Now',       plat: 'Ads',                   text: "Pause X. Move full $480 to TikTok In-Feed Eid campaign." },
              { when: 'Today',     plat: 'Ads',                   text: "Add Meta Reels placement — 15–25% lower CPM than Feed for awareness in your category." },
              { when: 'Today',     plat: 'Snapchat',              text: "Schedule 4 Eid snaps for UAE/KSA." },
              { when: 'This week', plat: 'TikTok',                text: "Cross-post the IG Eid reels (already viral) to TikTok." },
              { when: 'This week', plat: 'Ads',                   text: "Add a conversion-objective Meta campaign for the 18-day Eid window." },
              { when: 'This month',plat: 'Integrations',          text: "Connect WhatsApp Business Catalog. Primary B2C path in UAE/KSA." },
            ],
          },
          {
            variant: 'C',
            verdict: "LuxWick posted 4 UGC-style TikToks and gained 8,400 followers last week. Your last 3 TikTok posts were polished product shots. The category is voting for UGC. Test one phone-recorded UGC video this week.",
            actions: [
              { when: 'Now',       plat: 'TikTok',                text: "Film one phone-only UGC TikTok today. Founder or customer, 30 seconds, single take, single candle. No lighting, no edit." },
              { when: 'Today',     plat: 'TikTok',                text: "Cross-post the Eid gifting reels from IG. Free reach." },
              { when: 'Today',     plat: 'Snapchat',              text: "Schedule 4 Eid snaps for UAE/KSA." },
              { when: 'This week', plat: 'Ads',                   text: "Pause X (Spot Score 28). Move to TikTok (84)." },
              { when: 'This week', plat: 'LinkedIn',              text: "Post: 'Why retail brands underestimate Snapchat in GCC.' LI ER at 4.2%." },
              { when: 'This month',plat: 'Reports',               text: "Weekly PDF to wholesale partners. Eid window performance is your strongest gifting case in 6 months." },
            ],
          },
        ],

        signals: [
          { type: 'viral',     color: 'amber',   title: 'Eid gifting reels at 41% above baseline', body: "3-reel Eid series on IG and Snapchat. 41% above-baseline reach over 5 days. Scenthaus posted similar content 3 days later and underperformed by 34%." },
          { type: 'ad',        color: 'magenta', title: 'X ad spend scoring 28/100',               body: "X CTR (0.6%) is 52% below category benchmark (1.24%). $480/mo underperforming. TikTok Spot Score is 84." },
          { type: 'cultural',  color: 'ultra',   title: 'Eid Al-Adha in 18 days',                   body: "GCC brands see 2.4× social commerce conversion in the 14 days pre-Eid. Gifting content is the primary organic driver." },
          { type: 'competitor',color: 'amber',   title: 'LuxWick +8,400 TT followers in a week',    body: "6 TT videos, 4 UGC-style testimonials. Category voting for UGC over polished product shots." },
        ],

        competitors: [
          { handle: '@scenthaus',      plat: 'ig', them: 220000, you: 184200, pct: 84 },
          { handle: '@luxwick',        plat: 'ig', them: 168000, you: 184200, pct: 110 },
          { handle: '@otherland',      plat: 'ig', them: 298000, you: 184200, pct: 62 },
        ],
      },

      // Atlas Motors — Dubai automotive, Arabic brief.
      {
        id: 'atlas',
        name: 'Atlas Motors',
        category: 'Automotive',
        city: 'Dubai, UAE',
        platforms: 'IG · TT · YT · Snapchat',
        tone: 'Executive',
        language: 'Arabic (Khaleeji)',
        ai: 'Claude',
        intel: {
          score: 58,
          breakdown: [
            { label: 'Engagement quality', score: 26, max: 40, note: 'IG above category, YT below' },
            { label: 'Content cadence',    score: 10, max: 20, note: '4 posts/wk — automotive avg 7' },
            { label: 'Platform coverage',  score: 12, max: 15, note: 'No LinkedIn, no FB' },
            { label: 'Growth velocity',    score:  7, max: 15, note: '1 viral (30d)' },
            { label: 'Follower scale',     score:  3, max: 10, note: '125K combined' },
          ],
        },
        accounts: [
          { plat: 'ig', label: 'Instagram', followers: 64200, delta: 480, er: 4.8, color: '#D62976', spark: [62820, 63060, 63320, 63560, 63800, 64000, 64200] },
          { plat: 'tt', label: 'TikTok',    followers: 31000, delta: 720, er: 5.4, color: '#FF2D6A', spark: [29840, 30040, 30260, 30460, 30640, 30820, 31000] },
          { plat: 'yt', label: 'YouTube',   followers:  8400, delta:  60, er: 2.0, color: '#FF0000', spark: [ 8252,  8278,  8300,  8328,  8350,  8378,  8400] },
          { plat: 'sc', label: 'Snapchat',  followers: 22100, delta: 340, er: 4.6, color: '#FFFC00', spark: [21320, 21480, 21620, 21760, 21900, 22020, 22100] },
        ],

        briefs: [
          {
            variant: 'A',
            // Arabic verdict shown via direction:rtl. Translation in tooltip for non-Arabic readers.
            rtl: true,
            verdict: "ريلز إنستغرام الأخير عن سيارة لاند كروزر 2026 وصل لـ94,000 مشاهدة ونسبة تفاعل 4.8% — يتجاوز متوسطك بـ1.9 مرة. المنافس AutoDubai نشر محتوى مشابه بعدك بيومين وحقق نصف تفاعلك. هذا الأسبوع اضغط على نفس الفورمات قبل ما تنتهي النافذة.",
            verdictTranslation: "Your Land Cruiser 2026 IG reel hit 94,000 views and 4.8% ER — 1.9× your average. Competitor AutoDubai posted similar content 2 days later and got half your engagement. This week, push the same format before the window closes.",
            actions: [
              { when: 'Now',        plat: 'TikTok',    rtl: true, text: "حوّل ريلز اللاند كروزر إلى TikTok اليوم. 94 ألف مشاهدة على إنستغرام. محتوى السيارات على TikTok الإمارات يحقق وصولاً أعلى بـ40% من إنستغرام في الوقت الحالي." },
              { when: 'Today',      plat: 'Snapchat',  rtl: true, text: "انشر 3 سنابات اليوم تركز على المقصورة الداخلية. جمهور سناب شات في الإمارات يفضل اللقطات التفصيلية على المقصورة قبل اللقطات الخارجية." },
              { when: 'Today',      plat: 'Instagram', rtl: true, text: "ردّ على التعليقات في ريلز اللاند كروزر اللي تسأل عن السعر والتمويل. هذه إشارات نية شراء — وقت الرد المثالي خلال 4 ساعات من ظهور الموجة." },
              { when: 'This week',  plat: 'YouTube',   rtl: true, text: "سجل فيديو طويل: 'مراجعة لاند كروزر 2026 — كل شي تحتاج تعرفه قبل الشراء.' البحث على YouTube عن السيارة في الإمارات والسعودية يبلغ ذروته الأسبوعين القادمين." },
              { when: 'This week',  plat: 'TikTok',    rtl: true, text: "اختبر فورمات 'مقارنة سيارتين' — اللاند كروزر مقابل الباترول. هذا أعلى تفاعل في فئة السيارات على TikTok الخليج." },
              { when: 'This month', plat: 'Reports',   rtl: true, text: "أنشئ تقرير الأداء الشهري وأرسله للإدارة. أداء ريلز اللاند كروزر هو أقوى دليل على فعالية التسويق الرقمي هذا الربع." },
            ],
          },
          {
            variant: 'B',
            rtl: true,
            verdict: "TikTok فيها فرصة كبيرة هذا الأسبوع. ريلز اللاند كروزر اللي حقق 94 ألف مشاهدة على إنستغرام ما انتشر بعد على TikTok. الجمهور الإماراتي على TikTok يستهلك محتوى السيارات أكثر بـ40% من إنستغرام حالياً.",
            verdictTranslation: "Big opportunity on TikTok this week. The Land Cruiser reel that hit 94K on Instagram hasn't been cross-posted. UAE TikTok audience consumes automotive content 40% more than on IG right now.",
            actions: [
              { when: 'Now',        plat: 'TikTok',    rtl: true, text: "انشر ريلز اللاند كروزر على TikTok اليوم بدون تعديل." },
              { when: 'Today',      plat: 'TikTok',    rtl: true, text: "اختبر فورمات 'مقارنة سيارتين' كأعلى تفاعل في فئة السيارات بالخليج." },
              { when: 'Today',      plat: 'Snapchat',  rtl: true, text: "3 سنابات تركز على المقصورة الداخلية." },
              { when: 'This week',  plat: 'YouTube',   rtl: true, text: "فيديو طويل: 'مراجعة لاند كروزر 2026.' البحث يبلغ ذروته الأسبوعين القادمين." },
              { when: 'This week',  plat: 'Instagram', rtl: true, text: "ردّ على تعليقات السعر والتمويل خلال 4 ساعات من ظهور الموجة." },
              { when: 'This month', plat: 'Reports',   rtl: true, text: "تقرير شهري للإدارة. أداء اللاند كروزر هو أقوى دليل هذا الربع." },
            ],
          },
          {
            variant: 'C',
            rtl: true,
            verdict: "البحث على YouTube عن لاند كروزر 2026 في الإمارات والسعودية يبلغ ذروته في الأسبوعين القادمين. ما عندك فيديو طويل عن السيارة على القناة. هذي فرصة بحث عضوي تستمر شهور.",
            verdictTranslation: "YouTube search for 'Land Cruiser 2026' in UAE/KSA peaks in the next 2 weeks. You don't have a long-form video on the car on the channel. This is organic search traffic that lasts months.",
            actions: [
              { when: 'Now',        plat: 'YouTube',   rtl: true, text: "سجل فيديو طويل: 'مراجعة لاند كروزر 2026 — كل شي تحتاج تعرفه قبل الشراء.' هدف النشر خلال 5 أيام." },
              { when: 'Today',      plat: 'TikTok',    rtl: true, text: "انشر ريلز اللاند كروزر على TikTok بدون تعديل." },
              { when: 'Today',      plat: 'Snapchat',  rtl: true, text: "3 سنابات على المقصورة الداخلية." },
              { when: 'This week',  plat: 'TikTok',    rtl: true, text: "فورمات 'مقارنة سيارتين' — لاند كروزر vs باترول." },
              { when: 'This week',  plat: 'Instagram', rtl: true, text: "ردّ على تعليقات السعر والتمويل." },
              { when: 'This month', plat: 'Reports',   rtl: true, text: "تقرير شهري — أداء اللاند كروزر." },
            ],
          },
        ],

        signals: [
          { type: 'viral',     color: 'amber',   title: 'ريلز اللاند كروزر — 94K مشاهدة، 4.8% تفاعل', body: "Land Cruiser 2026 IG reel — 94K views, 4.8% ER, 1.9× account average. Competitor AutoDubai posted similar content 2 days later and got half the engagement." },
          { type: 'competitor',color: 'magenta', title: 'AutoDubai +1,200 سناب شات بين عشية وضحاها',   body: "AutoDubai gained 1,200 Snapchat followers overnight. UAE Snapchat penetration is 76% — highest globally. Snapchat is the platform to watch in this market." },
          { type: 'cultural',  color: 'ultra',   title: 'موسم السيارات الخليجي يبدأ خلال 6 أسابيع',     body: "GCC car-buying season opens in 6 weeks (UAE National Day + Saudi Founding Day windows). Search for new-car content peaks 4 weeks pre-window." },
          { type: 'platform',  color: 'lime',    title: 'ما عندك فيديو طويل عن اللاند كروزر',           body: "No long-form Land Cruiser content on YouTube. UAE/KSA search for this model peaks in 2 weeks. Multi-month organic traffic opportunity." },
        ],

        competitors: [
          { handle: '@autodubai',    plat: 'ig', them: 102000, you: 64200, pct: 63 },
          { handle: '@gulfmotors',   plat: 'ig', them:  84000, you: 64200, pct: 76 },
          { handle: '@khaleejcars',  plat: 'tt', them:  56000, you: 31000, pct: 55 },
        ],
      },

      // Mira Studio — London dance/performance, IG-led.
      {
        id: 'mira',
        name: 'Mira Studio',
        category: 'Arts / Dance / Performance',
        city: 'London, UK',
        platforms: 'IG · TT · YT',
        tone: 'Strategic',
        language: 'English',
        ai: 'Claude',
        intel: {
          score: 66,
          breakdown: [
            { label: 'Engagement quality', score: 30, max: 40, note: 'TT at 9.8% ER — top decile' },
            { label: 'Content cadence',    score: 14, max: 20, note: '5 posts/wk distributed across 3 platforms' },
            { label: 'Platform coverage',  score:  9, max: 15, note: '3 of 5 — no FB, no LI' },
            { label: 'Growth velocity',    score:  9, max: 15, note: '2 rising posts (30d)' },
            { label: 'Follower scale',     score:  4, max: 10, note: '71K combined' },
          ],
        },
        accounts: [
          { plat: 'ig', label: 'Instagram', followers: 19800, delta: 220, er: 5.2, color: '#D62976', spark: [19370, 19450, 19520, 19590, 19660, 19730, 19800] },
          { plat: 'tt', label: 'TikTok',    followers: 44300, delta: 1820, er: 9.8, color: '#FF2D6A', spark: [41760, 42180, 42620, 43090, 43560, 43940, 44300] },
          { plat: 'yt', label: 'YouTube',   followers:  7200, delta:  60, er: 3.4, color: '#FF0000', spark: [ 7064,  7088,  7112,  7136,  7158,  7180,  7200] },
        ],

        briefs: [
          {
            variant: 'A',
            verdict: "Your TikTok account is at 9.8% ER — top decile for performance/dance content. The 'studio class fragment' format is the variable. Three different fragments crossed 50K plays this week. The constraint is now Instagram: cross-posting is sporadic and IG growth is 4× slower than TT growth.",
            actions: [
              { when: 'Now',        plat: 'Instagram', text: "Cross-post the three TikTok class fragments to IG Reels today. The IG audience hasn't seen them. Same content, zero production cost." },
              { when: 'Today',      plat: 'Instagram', text: "Pin a comment on each cross-posted reel with the studio's class booking link. Class fragments drive booking intent — pin at the top of comments to capture the click." },
              { when: 'Today',      plat: 'YouTube',   text: "Cut a 60-second Shorts version of the highest-ER TikTok fragment. YT Shorts in the dance category get 3.2× the cross-platform discovery of IG Reels for your follower band." },
              { when: 'This week',  plat: 'TikTok',    text: "Pre-record 5 more class fragments this week. The format is working. The bottleneck is supply." },
              { when: 'This week',  plat: 'Instagram', text: "Increase IG posting cadence to match TT. 9.8% TT ER vs 5.2% IG ER + lower cadence = TT will keep outgrowing IG until you ship more on IG." },
              { when: 'This month', plat: 'YouTube',   text: "Plan a long-form 'class day in the life' video for the studio. The 'studio fragment' format proves the audience wants behind-the-scenes — a 12-min long-form would convert TT fans into YT subscribers." },
            ],
          },
          {
            variant: 'B',
            verdict: "Three different TikTok class fragments crossed 50K plays this week. The format is replicable and the audience is asking for more. Bottleneck this week: not enough Instagram cross-posts to capture the IG audience that hasn't seen them.",
            actions: [
              { when: 'Now',        plat: 'Instagram', text: "Cross-post all 3 class fragments to IG Reels today." },
              { when: 'Today',      plat: 'Instagram', text: "Pin class booking links in each Reel's comments." },
              { when: 'Today',      plat: 'TikTok',    text: "Block 2 hours tomorrow to record 5 more class fragments. The format is working — ship more." },
              { when: 'This week',  plat: 'YouTube',   text: "60-second Shorts of the top-ER fragment. YT Shorts in dance gets 3.2× the cross-platform discovery of IG Reels." },
              { when: 'This week',  plat: 'Instagram', text: "Raise IG cadence to match TT. Currently TT is 4× faster growth because TT is 4× the cadence." },
              { when: 'This month', plat: 'YouTube',   text: "12-min 'class day in the life' long-form — converts TT fans into YT subscribers." },
            ],
          },
          {
            variant: 'C',
            verdict: "YouTube Shorts in the dance category gets 3.2× the cross-platform discovery of IG Reels for your follower band. You haven't shipped a Shorts in 11 days. The TT fragments you have are pre-built Shorts.",
            actions: [
              { when: 'Now',        plat: 'YouTube',   text: "Cut a 60-second Shorts of this week's top TT class fragment. Publish today." },
              { when: 'Today',      plat: 'YouTube',   text: "Cut 2 more Shorts from older TT class fragments. Bank one for tomorrow." },
              { when: 'Today',      plat: 'Instagram', text: "Cross-post the 3 TT fragments to IG Reels. Free reach." },
              { when: 'This week',  plat: 'TikTok',    text: "Pre-record 5 more class fragments. The supply is the bottleneck." },
              { when: 'This week',  plat: 'Instagram', text: "Pin class booking links in cross-posted Reels comments." },
              { when: 'This month', plat: 'YouTube',   text: "12-min 'class day in the life' long-form." },
            ],
          },
        ],

        signals: [
          { type: 'viral',    color: 'amber',   title: 'TikTok ER at 9.8% — top decile',          body: "3 class fragments crossed 50K plays this week. 'Studio class fragment' format consistently outperforms scripted content for your channel." },
          { type: 'platform', color: 'magenta', title: 'IG growth 4× slower than TT growth',      body: "TT gained 1,820 followers, IG gained 220 in the same week. Cross-posting from TT to IG is sporadic — fix the bottleneck." },
          { type: 'platform', color: 'ultra',   title: 'No YT Shorts in 11 days',                  body: "YT Shorts in dance gets 3.2× cross-platform discovery of IG Reels for your follower band. You have ready-to-publish material in TT fragments." },
          { type: 'series',   color: 'lime',    title: "'Class day in the life' long-form gap",    body: "Audience asking for behind-the-scenes per comment volume. A 12-min YT long-form would convert TT fans into subscribers." },
        ],

        competitors: [
          { handle: '@thirdrailstudios', plat: 'ig', them: 32400, you: 19800, pct: 61 },
          { handle: '@steezy',           plat: 'tt', them: 1200000, you: 44300, pct: 3.7 },
          { handle: '@pineapple.dance',  plat: 'ig', them: 84000, you: 19800, pct: 24 },
          { handle: '@danceeast',        plat: 'ig', them: 12100, you: 19800, pct: 164 },
        ],
      },
    ],
  },

};

window.PERSONAS = PERSONAS;

// ─────────────────────────────────────────────────────────────────────────
// Extracted from demo.html lines 871-1082
// ─────────────────────────────────────────────────────────────────────────
"use strict";

const cls = (...a) => a.filter(Boolean).join(' ');

// Formatters — same conventions as the SPA.
const fmtN = (n) => {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1) + 'M';
  if (v >= 10_000) return Math.round(v / 1000) + 'K';
  if (v >= 1_000) return (v / 1000).toFixed(1) + 'K';
  return v.toLocaleString();
};
const fmtDelta = (n) => (n > 0 ? '+' : '') + n.toLocaleString();

// Platform icons — solid color blocks (Mashal brand-honest, no fake gradients).
const PlatIcon = ({ plat, size = 'w-5 h-5' }) => {
  const map = {
    ig: { bg: 'bg-magenta', label: 'IG' },
    tt: { bg: 'bg-ink',     label: 'TT' },
    yt: { bg: 'bg-red-600', label: 'YT' },
    fb: { bg: 'bg-blue-600',label: 'FB' },
    li: { bg: 'bg-sky-700', label: 'LI' },
    x:  { bg: 'bg-ink',     label: 'X'  },
    sc: { bg: 'bg-yellow-400 text-ink', label: 'SC' },
  };
  const m = map[plat] || { bg: 'bg-mute', label: '?' };
  return (
    <span className={cls('inline-flex items-center justify-center rounded-md font-mono text-[10px] font-bold text-white', m.bg, size)}>
      {m.label}
    </span>
  );
};

const MashalDot = ({ color = 'bg-magenta', size = 'w-2 h-2' }) => (
  <span className={cls('relative inline-block rounded-full pulse-dot', size, color)} />
);

const Pill = ({ children, color = 'ink' }) => {
  const colors = {
    ink:      'bg-ink/8 text-ink dark:bg-paper/10 dark:text-paper',
    lime:     'bg-lime text-ink',
    magenta:  'bg-magenta text-white',
    ultra:    'bg-ultra text-white',
    ultraSoft:'bg-ultraSoft text-ultra dark:bg-ultra/20 dark:text-ultra',
    amber:    'bg-amber/20 text-amber',
    paper:    'bg-paper/10 text-paper',
  };
  return <span className={cls('inline-flex items-center gap-1.5 px-2.5 h-6 rounded-full text-[11px] font-medium tracking-tight whitespace-nowrap', colors[color])}>{children}</span>;
};

// Bar sparkline — same primitive as SPA's StatCard.
const BarSpark = ({ data, color = '#6B5BFF', highlightIdx = -1, height = 28 }) => {
  const max = Math.max(...data) || 1;
  const min = Math.min(...data);
  const range = max - min || 1;
  // Normalize to floor at ~20% so flat-ish stacks still read as bars.
  return (
    <div className="flex items-end gap-0.5" style={{ height }}>
      {data.map((v, i) => (
        <div key={i}
          className="flex-1 rounded-sm transition-all"
          style={{
            height: `${20 + ((v - min) / range) * 80}%`,
            background: i === highlightIdx ? color : `${color}55`,
            minHeight: 3,
          }} />
      ))}
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────
// Demo banner — pinned to the top of every screen, with a CTA. The CTA
// goes straight to the signup route in the main SPA, not a marketing
// page, so curious visitors can convert in one click.
// ────────────────────────────────────────────────────────────────────────
const DemoBanner = () => (
  <div className="bg-ink text-paper dark:bg-coalsoft dark:border-b dark:border-lineDark">
    <div className="wrap" style={{paddingTop: 14, paddingBottom: 14}}>
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <MashalDot color="bg-lime" />
        <span className="text-[13px] sm:text-[14px] leading-snug flex-1 min-w-0">
          You're exploring a demo workspace with sample data. Switch personas above to see each plan in action.
        </span>
        <a href="/?route=signup" className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-lime text-ink text-[13px] font-medium hover:bg-limeDeep transition-colors">
          Start free trial
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </a>
      </div>
    </div>
  </div>
);

// ────────────────────────────────────────────────────────────────────────
// Persona switcher — 4 tabs across the top. Selecting a persona swaps
// every screen below. Selection is persisted in sessionStorage so a
// share-link with ?persona=brand pre-selects the right tab.
// ────────────────────────────────────────────────────────────────────────
const PERSONA_TABS = [
  { id: 'creator',     label: 'Creator',     price: '$15/mo'  },
  { id: 'pro_creator', label: 'Pro Creator', price: '$29/mo'  },
  { id: 'brand',       label: 'Brand',       price: '$99/mo'  },
  { id: 'agency',      label: 'Agency',      price: '$449/mo' },
];

const PersonaSwitcher = ({ active, onChange }) => (
  <div className="bg-chalk dark:bg-coal border-b border-line dark:border-lineDark sticky top-[64px] z-30 backdrop-blur">
    <div className="wrap" style={{paddingTop: 0, paddingBottom: 0}}>
      <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar" style={{minHeight: 56}}>
        <span className="hidden sm:inline font-mono text-[10px] uppercase tracking-[0.12em] text-mute dark:text-muteDark mr-3">Persona</span>
        {PERSONA_TABS.map(t => {
          const on = active === t.id;
          return (
            <button key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              className={cls(
                'inline-flex items-center gap-2 h-10 px-3 sm:px-4 rounded-full text-[13px] font-medium transition-all whitespace-nowrap',
                on
                  ? 'bg-ink text-paper dark:bg-paper dark:text-ink'
                  : 'bg-transparent text-mute hover:text-ink dark:text-muteDark dark:hover:text-paper border border-line dark:border-lineDark hover:border-ink/30 dark:hover:border-paper/30'
              )}>
              {t.label}
              <span className={cls('font-mono text-[10px]', on ? 'opacity-60' : 'opacity-50')}>{t.price}</span>
            </button>
          );
        })}
      </div>
    </div>
  </div>
);

// ────────────────────────────────────────────────────────────────────────
// Screen switcher — Brief / Stats / Signals. Sticky below the persona row.
// ────────────────────────────────────────────────────────────────────────
const SCREEN_TABS = [
  { id: 'brief',   label: 'Morning brief', icon: 'sparkle' },
  { id: 'stats',   label: 'Stats',         icon: 'trend'   },
  { id: 'signals', label: 'Signals',       icon: 'pulse'   },
];

const ScreenSwitcher = ({ active, onChange, rightSlot }) => (
  <div className="wrap pt-6 sm:pt-8" style={{paddingBottom: 0}}>
    <div className="flex flex-wrap items-center gap-3 mb-6 sm:mb-8">
      <div className="inline-flex items-center gap-1 p-1 rounded-full bg-chalk dark:bg-coal border border-line dark:border-lineDark">
        {SCREEN_TABS.map(t => {
          const on = active === t.id;
          return (
            <button key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              className={cls(
                'inline-flex items-center h-9 px-4 rounded-full text-[13px] font-medium transition-all',
                on ? 'bg-ink text-paper dark:bg-paper dark:text-ink' : 'text-mute hover:text-ink dark:text-muteDark dark:hover:text-paper'
              )}>
              {t.label}
            </button>
          );
        })}
      </div>
      {rightSlot}
    </div>
  </div>
);

// ────────────────────────────────────────────────────────────────────────
// Agency workspace dropdown — only renders when persona === 'agency'.
// ────────────────────────────────────────────────────────────────────────
const WorkspaceSwitcher = ({ workspaces, active, onChange }) => (
  <div className="wrap pt-6" style={{paddingBottom: 0}}>
    <div className="rounded-2xl bg-chalk dark:bg-coal border border-line dark:border-lineDark p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 mr-2">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-ultra/15 text-ultra">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
          </span>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-mute dark:text-muteDark">Workspace</div>
            <div className="font-display text-[15px] font-semibold tracking-tight">Clover & Co · 4 active clients</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
          {workspaces.map(w => {
            const on = active === w.id;
            return (
              <button key={w.id}
                type="button"
                onClick={() => onChange(w.id)}
                className={cls(
                  'inline-flex flex-col items-start h-auto py-2 px-3 rounded-xl text-[12px] font-medium transition-all border',
                  on
                    ? 'bg-ink text-paper border-ink dark:bg-paper dark:text-ink dark:border-paper'
                    : 'bg-transparent text-ink dark:text-paper border-line dark:border-lineDark hover:border-ink/40 dark:hover:border-paper/40'
                )}>
                <span className="text-[13px] font-semibold tracking-tight">{w.name}</span>
                <span className={cls('font-mono text-[10px] mt-0.5', on ? 'opacity-60' : 'opacity-50')}>{w.tone} · {w.language}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  </div>
);

window.cls = cls; window.fmtN = fmtN; window.fmtDelta = fmtDelta;
window.PlatIcon = PlatIcon; window.MashalDot = MashalDot;
window.Pill = Pill; window.BarSpark = BarSpark;
window.DemoBanner = DemoBanner; window.PersonaSwitcher = PersonaSwitcher;
window.ScreenSwitcher = ScreenSwitcher; window.WorkspaceSwitcher = WorkspaceSwitcher;

// ─────────────────────────────────────────────────────────────────────────
// Extracted from demo.html lines 1087-1438
// ─────────────────────────────────────────────────────────────────────────
"use strict";

// ────────────────────────────────────────────────────────────────────────
// BRIEF SCREEN
// ────────────────────────────────────────────────────────────────────────
const WHEN_COLORS = {
  'Now':        'bg-magenta text-white',
  'Today':      'bg-amber/25 text-amber',
  'This week':  'bg-ultra/15 text-ultra dark:bg-ultra/25',
  'This month': 'bg-mute/15 text-mute dark:bg-muteDark/25 dark:text-muteDark',
};

// Greeting — pulled from the SPA's pattern. Time-of-day aware.
const greetingFor = (hour) => {
  if (hour < 5)  return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

const BriefScreen = ({ persona, workspace }) => {
  // Source of truth: a workspace if we're in Agency mode, otherwise the persona itself.
  const D = workspace || persona;
  const [variantIdx, setVariantIdx] = React.useState(0);

  // Reset to variant A whenever the source data changes (persona or workspace swap).
  React.useEffect(() => { setVariantIdx(0); }, [D.id]);

  const brief = D.briefs[variantIdx % D.briefs.length];
  const firstName = persona.person?.firstName || D.name || 'there';
  const greeting = `${greetingFor(new Date().getHours())}${firstName ? ', ' + firstName : ''}.`;
  const aiLabel = persona.id === 'agency' ? (workspace?.ai || 'Claude') : (persona.person.ai_provider || 'Mashal');
  const toneLabel = persona.id === 'agency' ? (workspace?.tone || '—') : (persona.person.brief_tone || '—');
  const score = (workspace?.intel?.score) ?? persona.intel?.score;

  const onRegenerate = () => setVariantIdx((variantIdx + 1) % D.briefs.length);

  return (
    <div className="wrap pb-16">
      {/* Header row — eyebrow with date + tone + AI provider, big greeting */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6 sm:mb-8 fade-up">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute dark:text-muteDark mb-2">
            Morning brief · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · {toneLabel} · {aiLabel}
            {score !== null && score !== undefined && <span> · Intel Score <span className="text-ink dark:text-paper font-semibold">{score}</span></span>}
          </div>
          <h1 className="font-display text-[32px] sm:text-[44px] leading-[1.05] font-semibold tracking-tightest">
            {greeting}
          </h1>
          <p className="text-[14px] sm:text-[15px] text-mute dark:text-muteDark mt-1.5">
            {D.signals?.length ?? 0} signals from your last 30 days · {D.briefs.length} brief variants in this demo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Pill color="ultraSoft">
            <MashalDot color="bg-ultra" size="w-1.5 h-1.5" />
            Variant {brief.variant}
          </Pill>
          <button type="button"
            onClick={onRegenerate}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-full border border-line dark:border-lineDark text-[13px] font-medium text-ink dark:text-paper hover:border-ink/40 dark:hover:border-paper/40 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
            Regenerate
          </button>
        </div>
      </div>

      {/* Verdict block — the headline read */}
      <div key={brief.variant} className="rounded-2xl bg-ink text-paper dark:bg-coalsoft border border-ink dark:border-lineDark p-6 sm:p-8 mb-6 sm:mb-8 fade-up">
        <div className="flex items-center gap-2 mb-3">
          <MashalDot color="bg-lime" size="w-1.5 h-1.5" />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muteDark">Today's verdict</span>
        </div>
        <p
          dir={brief.rtl ? 'rtl' : 'ltr'}
          className={cls(
            'tracking-tighter leading-snug',
            // Latin verdict gets the display font + medium weight; Arabic
            // falls back to the system Arabic stack (Geist doesn't ship
            // Arabic glyphs) and keeps a comfortable line-height for it.
            brief.rtl
              ? 'text-[22px] sm:text-[26px] font-medium' + ' font-sans'
              : 'text-[22px] sm:text-[28px] font-medium font-display'
          )}
          style={brief.rtl ? { fontFamily: '"Geeza Pro", "Segoe UI", "Tahoma", system-ui, sans-serif', lineHeight: 1.6 } : undefined}>
          {brief.verdict}
        </p>
        {brief.verdictTranslation && (
          <p className="text-[12.5px] text-muteDark mt-4 italic leading-relaxed">
            EN: {brief.verdictTranslation}
          </p>
        )}
      </div>

      {/* Six prioritised actions */}
      <div className="grid gap-3 sm:gap-4">
        {brief.actions.map((a, i) => (
          <div key={brief.variant + '-' + i}
            className="rounded-xl bg-chalk dark:bg-coalsoft border border-line dark:border-lineDark p-4 sm:p-5 fade-up"
            style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-start gap-3 sm:gap-4">
              <span className="font-mono text-[11px] text-mute dark:text-muteDark mt-1 flex-shrink-0 hidden sm:block">{String(i + 1).padStart(2, '0')}</span>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className={cls('inline-flex items-center h-6 px-2.5 rounded-full text-[11px] font-mono uppercase tracking-[0.08em] font-medium', WHEN_COLORS[a.when] || WHEN_COLORS['Today'])}>
                    {a.when}
                  </span>
                  <span className="font-mono text-[10px] text-mute dark:text-muteDark uppercase tracking-[0.1em]">{a.plat}</span>
                </div>
                <p
                  dir={a.rtl ? 'rtl' : 'ltr'}
                  className="text-[14px] sm:text-[15px] leading-relaxed text-ink dark:text-paper"
                  style={a.rtl ? { fontFamily: '"Geeza Pro", "Segoe UI", "Tahoma", system-ui, sans-serif', lineHeight: 1.75 } : undefined}>
                  {a.text}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer note — demo-only nudge */}
      <div className="mt-8 sm:mt-10 p-4 rounded-xl bg-ultraSoft/60 dark:bg-ultra/10 border border-ultra/20 text-[13px] text-mute dark:text-muteDark leading-relaxed">
        <span className="text-ink dark:text-paper font-medium">Demo note:</span> the Regenerate button cycles through {D.briefs.length} pre-written brief variants for this persona. In the live product, Regenerate runs a fresh analysis on your connected accounts. <a href="/?route=signup" className="text-ultra font-medium hover:underline">Start your free trial</a> to wire up your own data.
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────
// STATS SCREEN
// ────────────────────────────────────────────────────────────────────────
const StatsScreen = ({ persona, workspace }) => {
  const D = workspace || persona;
  const score = workspace?.intel?.score ?? persona.intel?.score;
  const breakdown = workspace?.intel?.breakdown ?? persona.intel?.breakdown ?? [];
  const market = persona.market; // market context only on Pro Creator + Brand
  const accounts = D.accounts || [];
  const competitors = D.competitors || persona.competitors || [];

  return (
    <div className="wrap pb-16 fade-up">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6 sm:mb-8">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute dark:text-muteDark mb-2">
            Stats overview · last 7 days
          </div>
          <h1 className="font-display text-[32px] sm:text-[40px] leading-[1.05] font-semibold tracking-tightest">
            {accounts.length} platform{accounts.length === 1 ? '' : 's'} connected.
          </h1>
          <p className="text-[14px] sm:text-[15px] text-mute dark:text-muteDark mt-1.5">
            Last synced 2 hours ago. Sparklines show daily follower count over the past 7 days.
          </p>
        </div>
        {score !== null && score !== undefined && (
          <div className="rounded-2xl bg-ultra/10 border border-ultra/20 px-5 py-3 inline-flex items-center gap-3">
            <div className="font-display text-[36px] leading-none font-semibold tracking-tightest text-ultra">{score}</div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-mute dark:text-muteDark">Intel score</div>
              <div className="text-[12px] text-ink dark:text-paper">out of 100</div>
            </div>
          </div>
        )}
      </div>

      {/* Platform cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 mb-8 sm:mb-10">
        {accounts.map((a) => (
          <div key={a.plat} className="rounded-2xl bg-chalk dark:bg-coalsoft border border-line dark:border-lineDark p-5 hover:border-ink/20 dark:hover:border-paper/20 transition-all">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <PlatIcon plat={a.plat} size="w-7 h-7" />
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-mute dark:text-muteDark">{a.label}</span>
              </div>
              <span className="font-mono text-[11px] text-emerald-600 dark:text-lime">
                ↑ {fmtDelta(a.delta)}
              </span>
            </div>
            <div className="font-display text-[28px] sm:text-[32px] leading-none font-semibold tracking-tightest mb-1">
              {fmtN(a.followers)}
            </div>
            <div className="font-mono text-[10px] text-mute dark:text-muteDark mb-3">{a.er}% ER · 7d</div>
            <BarSpark data={a.spark} color={a.color} highlightIdx={a.spark.length - 1} />
          </div>
        ))}
      </div>

      {/* Intel score breakdown */}
      {breakdown.length > 0 && (
        <div className="rounded-2xl bg-chalk dark:bg-coalsoft border border-line dark:border-lineDark p-5 sm:p-6 mb-8">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-display text-[20px] sm:text-[22px] font-semibold tracking-tighter">Intel Score breakdown</h2>
            <span className="font-mono text-[11px] text-mute dark:text-muteDark">{score} / 100</span>
          </div>
          <div className="space-y-3">
            {breakdown.map((b, i) => {
              const pct = (b.score / b.max) * 100;
              return (
                <div key={i}>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className="text-[13px] font-medium text-ink dark:text-paper">{b.label}</span>
                    <span className="font-mono text-[11px] text-mute dark:text-muteDark">{b.score} / {b.max}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-ink/8 dark:bg-paper/10 overflow-hidden mb-1">
                    <div className="h-full rounded-full bg-ultra transition-all duration-[1200ms] ease-out" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[12px] text-mute dark:text-muteDark">{b.note}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Market context block — Pro Creator + Brand only */}
      {market && (
        <div className="rounded-2xl bg-ink text-paper dark:bg-coalsoft border border-ink dark:border-lineDark p-5 sm:p-6 mb-8">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-display text-[20px] sm:text-[22px] font-semibold tracking-tighter text-paper">Market context</h2>
            <Pill color="lime">{persona.name} feature</Pill>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 mb-5">
            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muteDark mb-1.5">Home market</div>
              <div className="text-[15px] font-medium text-paper mb-1">{market.home.country}</div>
              <div className="text-[12px] text-muteDark mb-2">{market.home.followers_band} followers</div>
              <p className="text-[12.5px] text-muteDark leading-relaxed">{market.home.notes}</p>
            </div>
            {market.focus.map((f, i) => (
              <div key={i} className="rounded-xl bg-white/5 border border-white/10 p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-lime mb-1.5">Focus region</div>
                <div className="text-[15px] font-medium text-paper mb-2">{f.country}</div>
                <p className="text-[12.5px] text-muteDark leading-relaxed">{f.note}</p>
              </div>
            ))}
          </div>
          <div className="pt-4 border-t border-white/10">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muteDark mb-2">Cultural calendar — next 90 days</div>
            <div className="flex flex-wrap gap-2">
              {market.calendar.map((c, i) => (
                <span key={i} className="inline-flex items-center h-7 px-3 rounded-full bg-white/8 text-[12px] text-paper">{c}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Competitor scorecard */}
      {competitors.length > 0 && (
        <div className="rounded-2xl bg-chalk dark:bg-coalsoft border border-line dark:border-lineDark p-5 sm:p-6">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-display text-[20px] sm:text-[22px] font-semibold tracking-tighter">Competitor scorecard</h2>
            <span className="font-mono text-[11px] text-mute dark:text-muteDark">{competitors.length} tracked</span>
          </div>
          <div className="space-y-2.5">
            {competitors.slice(0, 7).map((c, i) => {
              const winning = c.pct > 100;
              return (
                <div key={i} className="flex items-center gap-3 sm:gap-4">
                  <PlatIcon plat={c.plat} size="w-6 h-6" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="text-[13px] font-medium text-ink dark:text-paper truncate">{c.handle}</span>
                      <span className="font-mono text-[11px] text-mute dark:text-muteDark whitespace-nowrap">
                        {fmtN(c.them)} <span className="opacity-50">vs you {fmtN(c.you)}</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-ink/8 dark:bg-paper/10 overflow-hidden">
                      <div className={cls('h-full rounded-full transition-all duration-[1200ms] ease-out', winning ? 'bg-lime' : 'bg-ultra')}
                           style={{ width: `${Math.min(c.pct, 100)}%` }} />
                    </div>
                  </div>
                  <span className={cls('font-mono text-[11px] font-medium tabular-nums w-12 text-right', winning ? 'text-emerald-600 dark:text-lime' : 'text-mute dark:text-muteDark')}>
                    {c.pct < 10 ? c.pct.toFixed(1) : Math.round(c.pct)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────
// SIGNALS SCREEN
// ────────────────────────────────────────────────────────────────────────
const SIGNAL_TYPE = {
  viral:        { label: '⚡ Viral peak',        bg: 'bg-amber/12 dark:bg-amber/15',     border: 'border-amber/30' },
  gap:          { label: '📉 Content gap',       bg: 'bg-magenta/8 dark:bg-magenta/12', border: 'border-magenta/30' },
  series:       { label: '🔄 Series arc',        bg: 'bg-ultra/8 dark:bg-ultra/12',     border: 'border-ultra/30' },
  timing:       { label: '⏱ Timing anomaly',     bg: 'bg-lime/15 dark:bg-lime/15',      border: 'border-lime/30' },
  cultural:     { label: '🌙 Cultural window',    bg: 'bg-ultra/8 dark:bg-ultra/12',     border: 'border-ultra/30' },
  multilingual: { label: '🌐 Multilingual',       bg: 'bg-lime/15 dark:bg-lime/15',      border: 'border-lime/30' },
  platform:     { label: '🔀 Cross-platform',     bg: 'bg-magenta/8 dark:bg-magenta/12', border: 'border-magenta/30' },
  ad:           { label: '💸 Ad intelligence',    bg: 'bg-magenta/8 dark:bg-magenta/12', border: 'border-magenta/30' },
  competitor:   { label: '📊 Competitor move',    bg: 'bg-amber/12 dark:bg-amber/15',    border: 'border-amber/30' },
};

const SignalsScreen = ({ persona, workspace }) => {
  const D = workspace || persona;
  const signals = D.signals || [];

  return (
    <div className="wrap pb-16 fade-up">
      <div className="mb-6 sm:mb-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute dark:text-muteDark mb-2">
          Signal stream · live · {signals.length} active
        </div>
        <h1 className="font-display text-[32px] sm:text-[40px] leading-[1.05] font-semibold tracking-tightest">
          What changed overnight.
        </h1>
        <p className="text-[14px] sm:text-[15px] text-mute dark:text-muteDark mt-1.5 max-w-2xl">
          Mashal detects 14 distinct signal kinds — viral peaks, content gaps, series arcs, cross-platform opportunities, ad inefficiencies, cultural windows, competitor moves. Only the ones that matter today appear here.
        </p>
      </div>

      <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
        {signals.map((s, i) => {
          const meta = SIGNAL_TYPE[s.type] || SIGNAL_TYPE.viral;
          return (
            <div key={i}
              className={cls('rounded-2xl border p-5 sm:p-6 transition-all', meta.bg, meta.border)}
              style={{ animationDelay: `${i * 60}ms` }}>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink/70 dark:text-paper/70 mb-2 font-medium">
                {meta.label}
              </div>
              <h3 className="font-display text-[17px] sm:text-[19px] font-semibold tracking-tight leading-snug mb-2"
                  dir={/[؀-ۿ]/.test(s.title) ? 'rtl' : 'ltr'}>
                {s.title}
              </h3>
              <p className="text-[13.5px] text-mute dark:text-muteDark leading-relaxed">
                {s.body}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-8 sm:mt-10 p-4 rounded-xl bg-ultraSoft/60 dark:bg-ultra/10 border border-ultra/20 text-[13px] text-mute dark:text-muteDark leading-relaxed">
        <span className="text-ink dark:text-paper font-medium">Demo note:</span> these signals are pre-computed for the demo. In the live product, signals refresh overnight as Mashal re-reads your connected accounts and competitor pool. <a href="/?route=signup" className="text-ultra font-medium hover:underline">Start your free trial</a> to see signals from your own data.
      </div>
    </div>
  );
};

window.BriefScreen = BriefScreen;
window.StatsScreen = StatsScreen;
window.SignalsScreen = SignalsScreen;

// ─────────────────────────────────────────────────────────────────────────
// Extracted from demo.html lines 1443-1573
// ─────────────────────────────────────────────────────────────────────────
"use strict";

// URL params let people share /demo?persona=brand&screen=signals deep links.
const readParam = (k) => {
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get(k);
  } catch { return null; }
};

const writeParams = (params) => {
  try {
    const u = new URL(window.location.href);
    for (const [k, v] of Object.entries(params)) {
      if (v) u.searchParams.set(k, v);
      else u.searchParams.delete(k);
    }
    window.history.replaceState({}, '', u.toString());
  } catch {}
};

const DemoApp = () => {
  // Persona selection — URL first, then session, then default.
  const initialPersona =
    (readParam('persona') && PERSONAS[readParam('persona')]) ? readParam('persona')
    : (() => { try { const s = sessionStorage.getItem('mashal_demo_persona'); return (s && PERSONAS[s]) ? s : 'creator'; } catch { return 'creator'; } })();

  const initialScreen = (() => {
    const s = readParam('screen');
    return ['brief','stats','signals'].includes(s) ? s : 'brief';
  })();

  const [personaId, setPersonaId] = React.useState(initialPersona);
  const [screen, setScreen]       = React.useState(initialScreen);

  // Agency: which workspace is currently active.
  const initialWorkspace = (() => {
    const w = readParam('workspace');
    if (personaId === 'agency') {
      const exists = PERSONAS.agency.workspaces.find(x => x.id === w);
      return exists ? w : PERSONAS.agency.workspaces[0].id;
    }
    return null;
  })();
  const [workspaceId, setWorkspaceId] = React.useState(initialWorkspace);

  const persona = PERSONAS[personaId];
  const workspace = (personaId === 'agency')
    ? persona.workspaces.find(w => w.id === workspaceId) || persona.workspaces[0]
    : null;

  // Persist + URL sync on every change.
  React.useEffect(() => {
    try { sessionStorage.setItem('mashal_demo_persona', personaId); } catch {}
    writeParams({
      persona: personaId,
      screen,
      workspace: personaId === 'agency' ? (workspaceId || PERSONAS.agency.workspaces[0].id) : null,
    });
  }, [personaId, screen, workspaceId]);

  // Snap to the top of the active screen when persona, screen, or workspace
  // changes — feels weird to land mid-page after a tab swap.
  const screenRef = React.useRef(null);
  React.useEffect(() => {
    if (screenRef.current) {
      try { screenRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
    }
  }, [personaId, workspaceId, screen]);

  const onPersonaChange = (id) => {
    setPersonaId(id);
    if (id === 'agency') {
      setWorkspaceId(PERSONAS.agency.workspaces[0].id);
    } else {
      setWorkspaceId(null);
    }
  };

  return (
    <div>
      <DemoBanner />
      <PersonaSwitcher active={personaId} onChange={onPersonaChange} />

      {personaId === 'agency' && (
        <WorkspaceSwitcher
          workspaces={persona.workspaces}
          active={workspaceId}
          onChange={setWorkspaceId}
        />
      )}

      <ScreenSwitcher
        active={screen}
        onChange={setScreen}
        rightSlot={
          <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-mute dark:text-muteDark">
            {persona.name} · {persona.tagline}
          </div>
        }
      />

      <div ref={screenRef} />

      {screen === 'brief'   && <BriefScreen   persona={persona} workspace={workspace} />}
      {screen === 'stats'   && <StatsScreen   persona={persona} workspace={workspace} />}
      {screen === 'signals' && <SignalsScreen persona={persona} workspace={workspace} />}
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────
// Mount + splash hand-off.
// We wait for the next paint after the first render before flipping the
// splash off so the demo content is actually visible before the blur
// fades. Otherwise the splash dismisses while React is still painting
// and the user sees a flash of empty layout.
// ────────────────────────────────────────────────────────────────────────
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<DemoApp />);
requestAnimationFrame(() => requestAnimationFrame(() => {
  document.documentElement.setAttribute('data-demo-ready', '1');
  // Remove the splash node after the fade-out finishes so it can't intercept
  // pointer events from the demo UI underneath.
  setTimeout(() => {
    const s = document.getElementById('demo-splash');
    if (s && s.parentNode) s.parentNode.removeChild(s);
  }, 400);
}));
