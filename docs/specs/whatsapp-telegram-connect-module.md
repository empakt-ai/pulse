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
| Flow | **Likely** the generic Zernio OAuth (`GET /api/connect/telegram`) — same as IG/TikTok | **Not** generic OAuth. Meta **Embedded Signup** → WABA namespace |
| Lives in | `connected_accounts` via the normal `/accounts` import | `/v1/whatsapp/phone-numbers` (`connected` array) + lifecycle webhooks |
| Effort | Low (≈ one-line `ZERNIO_SUPPORTED` add + test) | Medium — dedicated connect sub-flow |
| Certainty | Mechanism undocumented — **confirm** | Mechanism undocumented — **confirm before building** |

**Design consequence (modularity):** Telegram folds into the **existing** connect module (`api/connect/platform.js`); WhatsApp gets an **isolated** connect sub-flow, but both land in the **same** `connected_accounts` shape so everything downstream (account list, Conversations) treats them uniformly. *Isolate the divergent flow; unify the resulting data.*

## 2. Telegram (the easy half)

- Add `'telegram'` to `ZERNIO_SUPPORTED` in `api/connect/platform.js`. The existing generic path then handles it: `GET /api/connect/telegram` → `ensureProfile` → `zernio.getConnectUrl('telegram', ...)` → popup → callback → `POST /api/accounts` import.
- Add platform code `tg` to `js/core/data.jsx` (`platformLabel`/`platformBrand`) + `PlatformIcons`.
- **Confirm with Zernio (§8):** is it generic OAuth, a **bot token**, or phone login? What gets connected (channel vs DMs)? Does it appear in `listAccounts`? If it needs a **bot token**, the UX differs (collect a token, not a popup) — that's a different, slightly larger front-end change, so confirm first.
- Risk: **low** if generic OAuth; **medium** if bot-token. Validate by connecting one Telegram account end-to-end.

## 3. WhatsApp BYO (the harder half)

- **Flow (partial, per docs):** Meta **Embedded Signup** → business authorizes their existing WABA → Zernio registers the number in the `connected` array of `GET /v1/whatsapp/phone-numbers` → number is readable in the inbox.
- **Diverges from generic connect:** WABA namespace, connects per *phone number* (not a generic "account" OAuth), and emits lifecycle webhooks.
- **Lifecycle webhooks to handle:** `whatsapp.number.activated`, `declined`, `action_required`, `verification_required`, `suspended`, `reactivated`, `released`. → add an **additive branch** in the existing `api/webhooks/zernio.js` that maps these to `connected_accounts.status` (mirrors how `account.disconnected` is handled today). No new webhook endpoint.
- **Data mapping (unify):** a connected WhatsApp number → one `connected_accounts` row (`platform='whatsapp'`, `zernio_account_id` = WABA number id, `platform_username` = number/display name). So Conversations + the accounts list treat it like any platform. **No schema change.**
- **Out:** provisioning/renting numbers (the `$2`/KYC purchase flow), outbound, templates.

## 4. Modularity contract

**New / isolated units:**
1. `api/connect/whatsapp.js` — *if* Zernio requires a dedicated initiate/complete endpoint for Embedded Signup (e.g. return a hosted signup URL, or register a number id after Meta SDK completes). +1 Vercel function (18→19, safe). *If* Zernio instead exposes WhatsApp through the generic `getConnectUrl`, this collapses into `platform.js` and no new file is needed — **confirm in §8**.
2. WhatsApp Embedded-Signup front-end piece — either reuse the existing popup pattern (if Zernio gives a hosted URL) **or** load Meta's JS SDK (`FB.login` with a `config_id`). The latter adds a script dependency; keep it isolated in `js/connect-whatsapp/` if needed.

**Seams (edits to existing files, minimal):**
| Seam | File | Change |
|---|---|---|
| C1 | `api/connect/platform.js` | add `'telegram'` (and `'whatsapp'` *only if* it rides the generic path) to `ZERNIO_SUPPORTED` |
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

## 7. Open items — **confirm with Zernio before building WhatsApp** (doc gaps)

1. **WhatsApp BYO connect mechanism:** does Zernio return a **hosted Embedded-Signup/connect URL** we open in a popup (like `getConnectUrl`), **or** must we embed Meta's JS SDK (`config_id`) and then call a Zernio **register** endpoint? Exact **initiate** + **complete** endpoint paths + params.
2. After a BYO number connects, does it appear in `GET /v1/accounts` (`listAccounts`) like other platforms, or **only** in `GET /v1/whatsapp/phone-numbers`? (Determines whether our existing `POST /api/accounts` import picks it up, or we need a WhatsApp-specific import.)
3. **Telegram connect:** generic `GET /v1/connect/telegram` OAuth, or **bot token** / phone? What entity connects (channel / DMs)? Does it show in `listAccounts`?
4. `whatsapp.number.*` webhook **payload shapes** (to map cleanly to `connected_accounts`).
5. Any **add-on** gating for WhatsApp/Telegram inbox + analytics on Zernio's side.

## 8. Risk & sequencing

- **Telegram first** — low risk, likely a one-line `ZERNIO_SUPPORTED` add + a connect test; it also validates the Conversations module against a real messaging platform with no provisioning/cost.
- **WhatsApp second** — only after Zernio confirms the Embedded-Signup mechanism (Q1/Q2). **Do not build blind.** Behind the Conversations tier-gate + a feature flag; fully reversible.

---

### Owner summary
Two connect additions feeding the read-only Conversations tab. **Telegram** is a near-trivial add to the existing connect module (confirm it's standard OAuth and not a bot-token). **WhatsApp** is bring-your-own-number only (Meta Embedded Signup → free, no $2/KYC, no outbound), built as an **isolated** connect sub-flow that still lands in the normal `connected_accounts` shape so everything downstream is uniform. The connect mechanisms aren't fully documented, so the spec's real gate is **five confirmation questions to Zernio** (you're already in contact) — Telegram can likely ship immediately after a quick test; WhatsApp waits on Zernio's answer to Q1/Q2.
