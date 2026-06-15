# Public Demo Walkthrough — Execution Plan

> Status: **PLAN** (2026-06-15). The demo is ~90% built already (`src/spa/demo-mode.jsx`); this is the finish + re-expose. Goal: a public, read-only, walkable tour of the real UI across all four tiers, so prospects see the value **before** signing up.

## What already exists (don't rebuild)
- `/demo` loads the **real SPA** in demo mode (`vercel.json` rewrite `/demo → /index.html` still active), so **layout is exactly the live product** (req 1a ✓).
- `PERSONAS` catalogue (`demo-mode.jsx` L27–735) covers **all four tiers**, multilingual (req 1b ✓):
  - **Creator** — Sofia @sofiamoves (fitness, EN, 3 accounts)
  - **Pro Creator** — Kai @kaicooks (food, EN + multilingual signals, 7 accounts, market context)
  - **Brand** — Noor Home (retail, **EN + native Khaleeji Arabic** briefs, KSA/UAE market context)
  - **Agency** — Clover & Co (4 client workspaces: Verde Eats, Noor Home, **Atlas Motors (Arabic)**, Mira Studio)
- **Persona switcher** banner (L1074–1192): flip tier (with price), Brand EN|AR toggle, Agency workspace dropdown; URL-persisted (`?persona=&workspace=&lang=`). Tier-gated screens already render differently (audience = pro+, competitor ads = brand/agency).
- API interceptor (L1029–1065): reads → persona data; mutations (`/sync`, `/intelligence/generate`, `/team/invite`, …) → `{ok:true, demo:true}`. All 10 screens render.

## The "separate layer" is the switcher BANNER, not the layout (key clarification)
The app under `/demo` already renders the **real** components a signed-in user sees (same `BriefScreen`/`StatsScreen`/etc., fed dummy data) — so "exactly what I see when I sign in" is already true *underneath*. What makes it *feel* like a separate layer is the **persona-switcher banner** (`demo-mode.jsx:1083–1192`): a `position:fixed` dark bar, intentionally styled with vanilla inline CSS to *not* match the app's design system, that pins to the top and pushes the whole app down. **That banner is the wrapper to remove.**

**Target experience (per req):** click Demo → a clean, on-brand **chooser** asks *"Explore as: Creator / Pro Creator / Business / Agency."* Pick one → you're "signed in" as that dummy account in the **real app with no foreign bar**. Switching plans / exiting is a **subtle, native-feeling** control (or a return to the chooser), not a persistent overlay. It should read as *"I am this user,"* not *"I'm in a demo viewer."*

## What blocks re-expose (the only real work for Phase 1)
**Req 1c (read-only, no data entry) is not fully enforced.** Four Settings actions aren't demo-gated and would fire real flows or break UX:
| Action | Where | Today |
|---|---|---|
| Connect platform | `screens.jsx` `connectPlatform()` (~L4834) | opens a real OAuth popup → confusing failure |
| Billing / upgrade | `js/billing/upgrade-dialog.jsx` `startCheckout()` (L66) | **redirects to real Stripe** |
| Team invite | `js/team/panel.jsx` `submitInvite()` (~L121) | real POST `/team/invite` |
| Webhook create | `js/webhooks/panel.jsx` `submit()` (~L118) | real POST `/workspace/webhooks` |

## Requirements → status
| Req | Status |
|---|---|
| 1a layout exactly as live | ✓ done (loads real SPA) |
| 1b dummy account, all data, multilingual | ✓ done (4 personas, EN + Arabic) |
| 1c read-only, no entry/injection | ⛔ **Phase 1** (gate the 4 actions) |
| 2a use previously-shared account data | personas already rich; swap specifics if desired (open item) |
| 2b add data layers (WhatsApp/Telegram conversations) | **Phase 3** (depends on Conversations tab existing) |
| Tooltips / guided walkthrough | **Phase 2** (none exists today) |
| Navigable, all 4 tiers | ✓ switcher already does this |

---

## Phase 1 — Real signed-in feel + read-only + re-expose

**0. Replace the foreign banner with an entry chooser + native chrome (the "no separate layer" fix).**
- On `/demo` (no persona chosen yet), render a clean, **on-brand** chooser screen in the app's own design system: *"Explore Mashal as: Creator · Pro Creator · Business · Agency"* (short blurb per tier). Selecting one sets the persona and drops into the real app.
- **Remove the `position:fixed` switcher banner** (and its `body.paddingTop` offset) so the app renders full-bleed exactly like the signed-in product — no foreign bar, no push-down.
- Replace switching with a **subtle native control**: e.g. a small, app-styled pill/menu (or a "Switch plan" item near the existing workspace/account area) that re-opens the chooser; keep one discreet "Start free trial" CTA. The agency workspace + Brand EN/AR toggles move into the *real* in-app controls (the SPA already has a workspace switcher + the Brand brief EN|AR toggle) rather than the banner.
- Net: the demo *is* the real layout; the only demo-specific surface is the entry chooser and one quiet exit/convert affordance.

**1. One demo-guard helper, applied at 4 call sites.** Add `demoGuard(message)` (returns true + shows a friendly nudge when `window.__MASHAL_DEMO_MODE`). At the top of each of the 4 handlers:
```
if (demoGuard('Connect your accounts after you sign up — this is a live demo.')) return;
```
Tailored copy per action (Connect / Upgrade / Invite / Webhook). This converts every destructive control into a **"sign up to do this"** nudge — read-only enforced in the UI, not just the interceptor. Modular: one helper in `demo-mode.jsx`, four one-line guards.

**2. Re-expose the `/demo` links** (revert the hiding from commit `d8db08ca`) — only after step 1:
- `src/spa/utilities.jsx`: LandingNav desktop (L966) + mobile (L1004) + HeroGradient "Try the demo" (L1077) + Footer Product
- 9 marketing pages (nav + footer Product `<li>`): about, contact, features, integrations, pricing, privacy, stack, terms, updates
- `sitemap.xml`: restore the `/demo` `<url>`

**3. A subtle "DEMO" affordance** — a small persistent badge + a "Start free trial" CTA in the demo chrome, so visitors always know it's a demo and have a one-click path to convert.

## Phase 2 — Light, native tooltips ("match the actual layout")
Per the brief: the walkthrough should **mirror the real layout, not sit on top of it**. So keep it subtle and native — no heavy tour overlay:
- **One small dismissible intro** on first entry after the chooser ("Read-only demo — click any tab to explore. Switch plan anytime.").
- **Subtle, on-brand tooltips/coach-marks** on first visit to each tab, styled in the app's design system (not a foreign overlay): "your 6 AM verdict", "Brand unlocks Arabic briefs + ad intel", "agencies manage every client here". Triggered via the existing `demo:rehydrate` + `window.__demoGetState()`.
- **Dismissible + replayable**; "seen" stored in demo-scoped `localStorage`. No "next → next" forced tour unless we later decide we want one.
- Module: `js/demo-tour/`, mounts only when `__MASHAL_DEMO_MODE`; publishes nothing into the real app.

## Phase 3 — Conversations layer (WhatsApp/Telegram) — depends on the Conversations tab
Once the read-only Conversations module ships (see `conversations-module.md`), add **demo conversation data** to each persona (sample DMs/comments + messaging analytics, incl. WhatsApp + Telegram threads in Arabic/English) so the demo showcases it. This is purely additive persona data + the demo interceptor returning it for `/conversations`. **Do not block Phase 1/2 on this** — re-expose the demo now; light up Conversations in the demo when the tab exists.

## Modularity & risk
- Every change is **demo-scoped** behind `window.__MASHAL_DEMO_MODE` (the guards) or in demo-only modules. The real logged-in app is untouched → **cannot break production** (matches the going-live stance).
- Phase 1 is tiny (1 helper + 4 guards + revert the link-hiding). Reversible.
- The persona data + switcher + screen rendering are already proven (the demo was "functionally complete" per the hide commit).

## Open items to confirm
1. **Specific account data**: personas are already realistic — do you want specific real accounts/handles you shared earlier swapped into a persona, or keep the current fictional set? (Fictional avoids "is this real data?" confusion.)
2. **Tour depth**: minimal (intro card + hover tooltips) for launch, or a full step-through "next/next" tour?
3. **Conversations in demo**: ship after the Conversations tab (Phase 3), agreed?

## Sequencing
**Phase 1 now** (gate + re-expose — gets a public demo live fast), **Phase 2 next** (tooltips), **Phase 3 later** (Conversations demo data once that module exists).
