# Mashal MCP — Scoping & Pitch (exploration)

> Status: **EXPLORATION / PITCH** (2026-06-15). Not on the build roadmap yet — this is the "is it worth doing, and what would it be" doc.
> Distinct from *consuming* Zernio's MCP (see `integration-architecture` discussion). This is Mashal **exposing its own** MCP server.

## 1. The concept (one line)
**"Your daily social intelligence, inside whatever AI you already use."** Mashal exposes an MCP server so a customer can connect Claude / ChatGPT / Cursor / their own agents to *their own* Mashal data and ask it anything — without leaving their AI workflow.

## 2. Why it's strong (the pitch)
- **First-mover wedge.** No mainstream social tool (Buffer, Later, Sprout, Metricool, Hootsuite, Rival IQ) exposes an MCP. "The social-intelligence layer for your AI agents" is a clean, ownable position as everyone races to build agents.
- **Leverages assets we already have.** Mashal's value is the *intelligence* (verdict, signals, competitor read, content insights). MCP just makes that queryable by any model. We're not building new intelligence — we're distributing it.
- **Cheap + low-risk to build.** It's a thin MCP wrapper over our **existing authenticated `/api/*` endpoints**. No new data model, no change to the core. Read-only first → can't break anything.
- **Fits the "one-stop shop" thesis.** As Mashal grows (Conversations, Content Studio), each new capability becomes a new MCP tool almost for free — Mashal becomes the backend a customer's AND an agency's AI stack calls.
- **Distribution.** Listing in MCP directories (Anthropic/OpenAI ecosystems) is its own top-of-funnel — discovery we don't get from a standalone dashboard.

## 3. How it works (architecture — modular, low-risk)
- **A new self-contained module/service**: `api/mcp.js` (an MCP server speaking the protocol over HTTP/SSE), whose tools are thin mappings onto our **existing** REST endpoints (`/api/brief`, `/api/accounts`, `/api/competitors`, …). No business logic duplicated.
- **Auth = our auth, unchanged.** The user connects via OAuth ("sign in with Mashal") or a **scoped Mashal API key**. Every tool call runs through `authenticate()` → resolves the workspace → all data is scoped to *that user's* workspace(s). **No cross-tenant access** — the multi-tenant guardrail is the same one the dashboard already enforces.
- **Read-only first.** Phase 1 exposes only read tools; no mutations. Write/action tools come later, behind the same role/tier gates as the UI.
- Modular seams: one new function/route + an OAuth/API-key issuance path. Touches nothing in sync/brief/billing.

## 4. Tool surface — what we'd expose

**Phase 1 — read tools (high value, zero write risk):**
| Tool | Maps to | What the AI can ask |
|---|---|---|
| `get_daily_brief` | `/api/brief` | "What's my verdict and top 3 actions today?" |
| `get_account_overview` | `/api/accounts` + brief | "Followers + engagement by platform, with WoW change" |
| `get_top_content` | `/api/posts` | "My best/worst posts this week and why" |
| `get_content_insights` | posts + content-detection | "Which formats/series are working?" |
| `get_competitors` | `/api/competitors` | "How do I stack up against the brands I track?" |
| `get_signals` | brief signals | "Summarize this week's live signals" |
| `get_growth_targets` | `/api/growth` | "Am I on track to my goals?" |
| `get_audience` | demographics (Brand+) | "Age/gender/location/language split" |
| `get_ads_performance` | ads intel (Brand/Agency) | "Spend, CTR, top creatives" |
| `list_workspaces` | `/api/workspaces` | (Agency) "Which clients am I managing?" |
| `get_conversations_summary` | Conversations module (when shipped) | "Messaging health: response time, volume" |

**Phase 2 — light actions (gated, additive):**
- `refresh_data` / `regenerate_brief` (trigger sync/brief), `set_growth_target`, `mark_signal_read`.

**Phase 3 — Content Studio actions (when it exists):**
- `draft_post`, `suggest_best_time`, `schedule_post` — turns Mashal-MCP into an *actionable* agent surface. This is where Mashal-as-MCP + Content Studio compound: a customer's agent can read intelligence AND act, all through Mashal.

## 5. Packaging / who it's for (the business case)
- **Agencies** (your top tier) — they already run AI in their workflows; "connect your AI stack to all your clients' Mashal data" is a real upsell.
- **Developer/API add-on** — "Mashal API + MCP" as a metered or premium SKU.
- **Power creators/brands** who live in ChatGPT/Claude and want their numbers there.
- Natural gate: **Brand/Agency** (or a dedicated API/MCP add-on). Read-only MCP could even be a teaser on lower tiers to drive the "AI-native" story.

## 6. Phasing
1. **Read-only MCP** over existing endpoints, OAuth/API-key auth, workspace-scoped. (Small, safe, demoable.)
2. **Light actions** (refresh, targets).
3. **Content Studio actions** (draft/schedule) once that module exists.
4. **Directory listing** + docs for third-party agent builders.

## 7. Risks / things to design for
- **Auth scoping** is the whole ballgame — every tool must be workspace-scoped via our existing auth; an over-broad token is the only real failure mode. Mitigated by reusing `authenticate()`.
- **Rate limits / abuse** — agents can call in loops; add per-key rate limiting + usage metering (also enables a metered SKU).
- **Cost** — reads are cheap; if a tool triggers a sync/brief (Phase 2), meter it against the tier's run cap (we already have `getMonthlyUsage`).
- **Support surface** — third-party integrators need docs; start with our own users before public listing.
- **Don't over-promise actions** — Phase 1 is read-only; keep write tools behind the same gates as the UI.

## 8. Pitch summary (for the room)
> *Mashal is already the "what should I do today" intelligence layer for social. Exposing it as an MCP server makes that intelligence callable from any AI a creator, brand, or agency already uses — a first-mover position no competitor holds, built as a thin, read-only, workspace-scoped layer over the API we've already shipped. It costs little to stand up, it can't break the core, and it turns every future Mashal capability (Conversations, Content Studio) into a tool the customer's own agents can use. It's both a differentiation wedge and a distribution channel (MCP directories).*

**Effort/risk:** low for Phase 1 (read-only, reuses everything). **Upside:** category-defining positioning + an API/agency upsell. Worth a real pitch.
