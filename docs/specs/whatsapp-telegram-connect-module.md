# WhatsApp & Telegram Connect — Spec (Phase 1)

> Status: **PLANNING** (2026-06-15). Companion to `conversations-module.md` (Conversations reads whatever these connect flows enable). Nothing built yet.

## 0. Scope & hard constraints

- Make **Telegram** and **WhatsApp (bring-your-own existing WABA only)** *connectable*, so their conversations/analytics flow into the read-only Conversations module.
- **WhatsApp = BYO via Meta Embedded Signup only.** No Zernio-provisioned/rented numbers (so **no $2/mo, no Zernio KYC**). **No outbound, no template messages, no broadcasts.** Connect = authorize an existing number we can *read*.
- Telegram = connect whatever Zernio connects (channel/account) for read.
- Tier: align with Conversations (WhatsApp = Brand/Agency; Telegram likely broader — TBD §6).

## 1. The crucial fact: these are two *different* connect paths

| | Telegram | WhatsApp (BYO) |
|---|---|---|
| Flow | **Bot + access-code** (`GET /v1/connect/telegram` → code `ZRN-…`; user adds @ZernioScheduleBot as channel admin) — **NOT OAuth** | Meta **JS SDK** (`config_id`) + register endpoint — **NOT a hosted popup** |
| Lives in | `GET /v1/accounts` → normal `/accounts` import (uniform) | `GET /v1/accounts` → normal `/accounts` import (uniform); also `/whatsapp/phone-numbers` `connected` |
| Effort | Medium — small guided connect UI (code + instructions + poll) | Medium — Meta SDK embed + register endpoint |
| Certainty | **Confirmed 2026-06-15 (§7)** | **Confirmed 2026-06-15 (§7)** |

**Design consequence (modularity):** Telegram folds into the **existing** connect module (`api/connect/platform.js`); WhatsApp gets an **isolated** connect sub-flow, but both land in the **same** `connected_accounts` shape so everything downstream (account list, Conversations) treats them uniformly. *Isolate the divergent flow; unify the resulting data.*

## 2. Telegram — guided bot + access-code flow (REVISED: not OAuth)

Confirmed (§7): it does **not** ride the generic `getConnectUrl` popup. The flow:
1. Backend: `GET /v1/connect/telegram?profileId=...` → returns access code `ZRN-XXXXXX` + instructions (wrap in our own `api/connect/telegram.js`).
2. UI: a **small connect card** shows the code + steps — *"Add **@ZernioScheduleBot** as an admin of your channel/group, then send this code to the bot (with your channel @username, or by forwarding a message)."*
3. Detect: poll `POST /api/accounts` (existing import) until the new `telegram` channel appears in `listAccounts` → uniform import, no Telegram-specific path. Add platform code `tg` to `js/core/data.jsx` + `PlatformIcons`.
- **Read-only caveat:** only channel/group/supergroup messages (where the bot is admin) are captured — **private DMs to the bot are NOT stored.** Frame Telegram in Conversations as channel/group activity, not 1:1 DMs.
- Risk: **medium** (a small guided connect UI + poll), no provisioning/cost. Still ships first — validates Conversations against a real messaging platform cheaply.

## 3. WhatsApp BYO (the harder half)

- **Flow (partial, per docs):** Meta **Embedded Signup** → business authorizes their existing WABA → Zernio registers the number in the `connected` array of `GET /v1/whatsapp/phone-numbers` → number is readable in the inbox.
- **Diverges from generic connect:** WABA namespace, connects per *phone number* (not a generic "account" OAuth), and emits lifecycle webhooks.
- **Lifecycle webhooks to handle (BYO subset, per §7):** `whatsapp.number.activated`, `suspended`, `reactivated`, `released`. → add an **additive branch** in the existing `api/webhooks/zernio.js` mapping them to `connected_accounts.status` (mirrors `account.disconnected`). No new webhook endpoint. (`declined`/`action_required`/`verification_required` are provisioned-only — won't fire for BYO.)
- **Data mapping (unify):** a connected WhatsApp number → one `connected_accounts` row (`platform='whatsapp'`, `zernio_account_id` = WABA number id, `platform_username` = number/display name). So Conversations + the accounts list treat it like any platform. **No schema change.**
- **Out:** provisioning/renting numbers (the `$2`/KYC purchase flow), outbound, templates.

## 4. Modularity contract

**New / isolated units:**
1. `api/connect/whatsapp.js` — *if* Zernio requires a dedicated initiate/complete endpoint for Embedded Signup (e.g. return a hosted signup URL, or register a number id after Meta SDK completes). +1 Vercel function (18→19, safe). *If* Zernio instead exposes WhatsApp through the generic `getConnectUrl`, this collapses into `platform.js` and no new file is needed — **confirm in §8**.
2. WhatsApp Embedded-Signup front-end piece — either reuse the existing popup pattern (if Zernio gives a hosted URL) **or** load Meta's JS SDK (`FB.login` with a `config_id`). The latter adds a script dependency; keep it isolated in `js/connect-whatsapp/` if needed.

**Seams (edits to existing files, minimal):**
| Seam | File | Change |
|---|---|---|
| C1 | `api/connect/telegram.js` + `api/connect/whatsapp.js` | dedicated connect initiators (Telegram code flow; WhatsApp sdk-config + embedded-signup / credentials). +2 functions. Both import via existing `/api/accounts`. |
| C2 | `api/webhooks/zernio.js` | additive `whatsapp.number.*` branch → `connected_accounts.status` |
| C3 | `js/core/data.jsx` + `PlatformIcons` | add `tg`, `wa` codes/labels/icons |
| C4 | `api/_lib/tiers.js` | platform availability per tier (WhatsApp/Telegram) |

**Rules:** reuse `ensureProfile`, `connected_accounts`, the handle registry, and the existing webhook handler. No changes to sync/brief/billing. WhatsApp-specific logic stays in its own file(s); the generic connect path is not complicated by it.

## 5. Tier-gating

- **WhatsApp:** Brand/Agency (matches Conversations). **Telegram:** decide — likely available wherever the platform cap allows (it's a normal social platform), but if we want it as a "conversations" platform, gate with Conversations. Use the existing X/Snapchat creator-gate pattern in `platform.js` (returns `402` + `upgrade_tier`).
- Server-authoritative in `platform.js`; UI mirrors.

## 6. Out of scope now → forward seams

| Later | Where | Isolation |
|---|---|---|
| Provisioned/rented WhatsApp numbers ($2/KYC) | extend `api/connect/whatsapp.js` with a purchase flow | separate code path; never auto-triggered |
| Outbound / templates / broadcasts | separate `js/broadcasts/` + `api/broadcasts.js` | metered Meta cost stays isolated |
| Reply | Conversations Phase 2 | additive POST |

## 7. CONFIRMED by Zernio (2026-06-15) — build-ready

**WhatsApp (BYO, read-only).** Connect = embed Meta's JS SDK with Zernio's `config_id`, then register with Zernio (no Zernio-hosted popup):
- `GET /v1/connect/whatsapp/sdk-config` → `{ appId, configId }` to init Meta Embedded Signup.
- After the Meta popup returns an OAuth `code`: `POST /v1/connect/whatsapp/embedded-signup` `{ code, profileId, wabaId?, phoneNumberId? }`.
- **Server-to-server alternative** (no front-end SDK): `POST /v1/connect/whatsapp/credentials` `{ profileId, accessToken, wabaId, phoneNumberId }` (the business's Meta System User token).
- **Listing:** a connected number appears in `GET /v1/accounts` as a normal `whatsapp` account → **our existing `listAccounts` import picks it up, no WhatsApp-specific import path.** (Also in `/v1/whatsapp/phone-numbers` `connected` array; we only care about `connected`.)
- **Webhooks (BYO subset):** only `whatsapp.number.activated`, `suspended` (+reason), `reactivated`, `released` (+reason, terminal) fire for BYO; `declined`/`action_required`/`verification_required` are provisioned-only (won't see them). Envelope: `{ id, event, timestamp, number:{ id, phoneNumber, country, profileId } }`. Headers: `X-Zernio-Event`, `X-Zernio-Event-Id` (idempotency), `X-Zernio-Signature` (HMAC-SHA256) — same verification as the existing webhook handler.
- Docs: platforms/whatsapp, /whatsapp/connection, /connect/connect-whatsapp-credentials.

**Telegram (NOT OAuth — bot + access code).** `GET /v1/connect/telegram?profileId=...` → returns an access code `ZRN-XXXXXX` + instructions. The user adds **@ZernioScheduleBot** as an admin of their channel/group, then sends the code to the bot (with the channel `@username`, or by forwarding a message). What connects = a **channel/group/supergroup**, and it shows in `GET /v1/accounts` like any platform. **Read-only caveat:** messages in channels/groups where the bot is admin are captured; **private DMs straight to the bot are NOT stored.**

**Inbox/analytics:** on our **usage-based plan, Inbox is included** — the read endpoints + `/v1/analytics/inbox/*` work for WhatsApp **and** Telegram with **no add-on**.

**Referral/partner:** Zernio's Refer & Earn is link-based (`zernio.com/signup?ref=CODE`) with no server-side attribution, so it **won't** capture clients who connect through Mashal. Zernio frames our setup as **reseller/white-label** — so referral revenue isn't a lever here; pricing/markup is ours to set.

## 8. Risk & sequencing (mechanisms now CONFIRMED — build-ready)

- **Telegram first** — a small guided connect UI (`api/connect/telegram.js` → code + instructions card + poll). Medium effort, no cost; validates Conversations against a real messaging platform.
- **WhatsApp second** — `api/connect/whatsapp.js` (sdk-config + embedded-signup; or the server-to-server `credentials` path) + the Meta JS SDK embed. Behind the Conversations tier-gate + a feature flag; reversible.
- **Both import uniformly** via the existing `POST /api/accounts` / `listAccounts` path (Zernio confirmed connected WhatsApp + Telegram appear in `GET /v1/accounts`) — so no platform-specific import code. Inbox + analytics already included (no add-on).

---

### Owner summary
Two connect additions feeding the read-only Conversations tab, **mechanisms now confirmed by Zernio (§7)**. **Telegram** is a guided **bot + access-code** flow (not OAuth): we fetch a `ZRN-…` code, the user adds @ZernioScheduleBot as a channel admin and sends the code; channel/group messages are captured (not private bot DMs). **WhatsApp** is bring-your-own-number only via **Meta Embedded Signup** (JS SDK + `config_id`, or server-to-server credentials) → free, no $2/KYC, no outbound. Both land in the normal `connected_accounts` shape (they show in `GET /v1/accounts`), so everything downstream is uniform. Sequencing: **Telegram first, WhatsApp next** — no longer blocked on questions.
