# Conversations Module — Spec (Phase 1: read-only)

> Status: **PLANNING** (2026-06-15). Nothing built yet. This is the execution structure.
> Owner-facing summary at bottom. Built on Zernio's inbox + the June-2026 inbox-analytics endpoints.

## 0. Scope & hard constraints (this phase)

- **READ-ONLY.** No outbound messaging, **no reply**, **no template messages**, no broadcasts, no comment→DM automations. We *display* conversations + analytics; we do not send anything.
- Surfaces three streams, scoped to the workspace's connected accounts:
  - **DMs / threads** — Instagram, Facebook Messenger, Telegram, WhatsApp, Google Business
  - **Comments** — Instagram, Facebook, Telegram, YouTube
  - **Reviews** — Facebook, Google Business
- **Not supported (Zernio has no inbox for them):** Snapchat, LinkedIn, X, Reddit, Threads. They stay content/posting platforms; the Conversations tab must not imply otherwise.
- **Tier:** Brand + Agency (a service/CRM surface). Creator/trial sees a locked teaser.

## 1. Modularity contract (the most important section)

The feature is a **vertical slice**. Everything new lives in three new units; everything existing is touched only at a tiny, enumerated set of **seams**. If you can't point a change at one of these, it doesn't belong in this module.

**New, self-contained units (own the whole feature):**
1. `js/conversations/panel.jsx` — the entire front-end (tab screen + sub-components + analytics block). Window-bridge module, same pattern as `js/ads-intel/`, `js/support/`, `js/team/`.
2. `api/conversations.js` — the entire back-end (one Vercel function; read-only proxy/aggregator over Zernio's inbox + analytics endpoints, tier-gated).
3. Additive Zernio client methods in `api/_lib/zernio.js` (thin pass-throughs; shared infra, not a new function).

**Seams — the ONLY edits to existing files (each is one line / one entry):**
| Seam | File | Change |
|---|---|---|
| S1 | `src/spa/main.jsx` | `import '../../js/conversations/panel.jsx';` (after the other feature modules, before screens) |
| S2 | `src/spa/screens.jsx` | add `'Conversations'` to the `tabs` array (gated like `Ads`, line ~745) |
| S3 | `src/spa/screens.jsx` | add to the `screens` map (line ~6618), mounted as `window.Conversations?.Panel` (see §5) |
| S4 | `api/_lib/tiers.js` | add a `conversations: true/false` capability per tier (additive) |
| S5 | marketing HTML + `js/core/data.jsx` constants | platform-list copy + platform code maps (see §8) |

**Hard rules:**
- **No changes** to brief generation, sync, billing, the webhook write path, or any other module. Conversations only **reads**.
- Conversations **fetches its own data** via `api('/conversations?...')`. It does **not** ride the `/api/brief` → `D` payload (keeps it decoupled; brief can't break Conversations and vice-versa).
- Mount via `window.Conversations?.Panel && <window.Conversations.Panel .../>` — the same null-safe `window.<Module>?.X` pattern AdsIntel uses. This deliberately avoids adding it to the `const {...} = window` destructure block (that's the pattern that produced the `safeHref`/`ReactDOM` dead-binding bugs).
- **Additive-only DB.** Phase 1 needs **no schema change** (see §2). If we later add unread-state, it's a new column/table, never a mutation of existing ones.

## 2. Data model

**Reuse, don't duplicate.**

- `inbox_events` (already populated by `api/webhooks/zernio.js`) stays **exactly as is** and keeps feeding the live-signals cron. Phase 1 does **not** write to it and does **not** change its consumers.
  - Live schema: `id, workspace_id, account_id, zernio_account_id, platform, kind, post_id, platform_post_id, author_handle, body, payload (jsonb), delivery_id, received_at, status`.
- **Phase 1 source of truth for the tab = live reads from Zernio** (full threaded history + analytics), proxied by `api/conversations.js`. `inbox_events` is the webhook "what's new" stream we already keep; we may later use it for unread badges, but **not in Phase 1** (keeps it read-only with zero schema change).
- No new tables in Phase 1.

## 3. Back-end — `api/conversations.js` (one function)

`GET /api/conversations?view=<threads|thread|comments|reviews|analytics>&platform=<id>&id=<conversationId>&cursor=<c>`

- `authenticate(req)` → resolve workspace; **tier-gate**: Creator/trial → `402` with `{ upgrade_tier, current_tier }` (mirror the `/api/connect/platform` X/Snapchat gate). Brand/Agency → proceed.
- `assertRole(auth, 'member')` (viewing is fine for members; reply later will require admin).
- Dispatch by `view`, proxying Zernio (read-only):
  - `threads` → `zernio.listConversations(profileId, { platform, cursor })` → `GET /inbox/conversations`
  - `thread` → `zernio.getConversationMessages(id)` → `GET /inbox/messages/{id}`
  - `comments` → `zernio.listComments({ platform, cursor })` → `GET /inbox/comments`
  - `reviews` → `zernio.listReviews()` → `GET /inbox/reviews` (Facebook + Google Business)
  - `analytics` → the **June-5 inbox-analytics endpoints** (volume, response-time, heatmap, conversation KPIs). *Exact paths TBD — pull specs from Zernio at build time (open item §10).*
- **No POST handlers.** Read-only is enforced by the absence of write routes, not just the UI.
- Vercel budget: 17 → **18** top-level functions. Safe (no hard limit on current plan). Top-level file = auto-routed; **no `vercel.json` rewrite needed**.

## 4. Zernio client additions — `api/_lib/zernio.js`

Thin, additive pass-throughs (no change to existing methods):
```
listConversations(profileId, opts)      GET /inbox/conversations
getConversationMessages(conversationId) GET /inbox/messages/{id}
listComments(opts)                      GET /inbox/comments
listReviews(opts)                       GET /inbox/reviews
getInboxAnalytics(metric, opts)         GET /analytics/inbox/... (TBD)
```
(Send/reply/review-reply methods are intentionally **not** added in Phase 1.)

## 5. Front-end — `js/conversations/panel.jsx` (self-contained)

- Snapshot shared symbols off `window` (same header as ads-intel/support).
- Components: `ConversationsScreen` (the tab) → `[ MessagingAnalytics ] [ StreamSwitcher: Threads | Comments | Reviews ] [ ConversationList ] [ ConversationThread (read-only) ]`.
- Fetches via `api('/conversations?view=...')`. No reply composer (read-only). A subtle "viewing only" affordance is fine; no disabled send box.
- Tier-gate: if `D.tier.key` is creator/trial → render `TrialLockedCard` (`featureLabel="Conversations"`, `tier="brand"`, `onUpgrade → pulse:openUpgrade`), matching the Ads/Audience gate.
- Publish: `Object.assign(window, { Conversations: { Panel: ConversationsScreen } })`.

## 6. Tier-gating

- Authoritative server-side in `api/conversations.js` (402 for Creator/trial). UI mirrors with the locked card. Capability flag in `tiers.js` (`conversations`) so gating is data-driven, not hard-coded in the screen.

## 7. Platform identifiers (new)

- SPA short codes to add to `js/core/data.jsx` (`platformLabel`/`platformBrand`) + `PlatformIcons`: `wa` (WhatsApp), `tg` (Telegram), `gbp` (Google Business). Confirm Zernio's backend ids (`whatsapp`, `telegram`, and GBP likely `google_business`/`gmb`) when wiring.

## 8. Marketing / homepage updates (cohesive upgrade) — checklist

Add **WhatsApp, Telegram, Google Business Profile** to platform enumerations — **but framed correctly**: these are **Conversations** channels, not content-analytics platforms. Do **not** claim WhatsApp/Telegram content analytics. Suggested framing: *"content intelligence across 7 platforms — plus Conversations for WhatsApp, Telegram, Instagram, Facebook & Google Business."* Update the "seven platforms" counts accordingly (don't silently inflate to "10 analytics platforms").

Locations (from architecture sweep):
- `index.html`: meta description (L21), keywords (L22), JSON-LD description (L262)
- `features.html`: meta description (L10), OG description (L12) + a Conversations feature block
- `pricing.html`: JSON-LD (L66) + the Brand/Agency feature comparison rows (add "Conversations inbox")
- `integrations.html`: meta description (L10); **new integration sections** for WhatsApp / Telegram / Google Business (~L199–290 pattern); ad-note (L272)
- `manifest.webmanifest`: description (L4) — reword "seven platforms"
- `sitemap.xml`: add a `/conversations` or feature page if one is created
- `compare/*.html`: any platform-list mentions (Sprout/Hootsuite comparisons are the likely spots to claim the inbox advantage)
- SPA constants: `js/core/data.jsx` platform maps + `PlatformIcons` (S5)

## 9. Out of scope now → forward seams (so later phases bolt on, not rebuild)

| Later phase | Where it lands | Why it won't break Phase 1 |
|---|---|---|
| **Reply** (in-window, free) | `api/conversations.js` gains POST actions; `ConversationThread` gains a composer | GET layer is stable; POST is purely additive; admin-gated |
| **Broadcasts / templates** (Meta-metered) | a **separate** `js/broadcasts/` module + `api/broadcasts.js` | isolated so the metered/Meta-cost surface never entangles read-only Conversations |
| **WhatsApp BYO connect** (Meta Embedded Signup) | `api/connect/platform.js` (add `whatsapp`/`telegram` to `ZERNIO_SUPPORTED`) | connect is its own module; Conversations just reads whatever is connected |
| **Content Studio** (one-stop-shop) | its own vertical-slice module(s) | modular boundary = one feature per module; no shared mutable state with Conversations |

## 10. Open items to confirm before build

1. Exact specs/paths for the 7 June-5 **inbox-analytics** endpoints (pull from Zernio docs/API).
2. Zernio platform id for Google Business (`google_business` vs `gmb`).
3. Prerequisite: to show WhatsApp/Telegram *conversations*, those platforms must be **connectable** (added to `ZERNIO_SUPPORTED` in `connect`). Decide: ship Conversations for already-connectable platforms (IG/FB/YT) first, light up WhatsApp/Telegram as their connect is enabled — or enable connect + Conversations together.
4. WhatsApp BYO pricing already confirmed free (Meta-only per-template cost; N/A here since no templates).

## 11. Rollout & risk

- **Additive-only**: 3 new units + 5 small seams; no edits to sync/brief/billing/webhook-write → cannot break the working core (honors the "don't break going-live" stance).
- Optionally gate the tab behind a feature flag/env for staged rollout.
- Reversible: remove the import (S1) + tab entry (S2/S3).

---

### Owner summary
A new **Conversations** tab (Brand/Agency) that shows incoming **DMs, comments, and reviews** plus **messaging analytics** (response time, volume, busy hours) — **read-only**, no sending of any kind. Built as a single self-contained module (`js/conversations/` + `api/conversations.js` + thin Zernio client methods) touching the existing app at only ~5 tiny seams, reusing data we already collect, and structured so **Reply**, **Broadcasts**, **WhatsApp connect**, and **Content Studio** later attach as their own modules without reopening this one. Marketing/homepage gets WhatsApp + Telegram + Google Business added as *Conversations* channels (carefully framed, not as new analytics platforms).
