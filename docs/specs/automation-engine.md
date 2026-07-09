# Engage Automation Engine — Spec

> Status: **PLANNING** (2026-07-09). Nothing built yet — this is the methodology + phased build order.
> A **separate module** ("engine") that runs Mashal's own comment/DM automations, replacing Zernio's
> instant hosted comment-automations. Built on Zernio (inbox + send) + Supabase + Vercel cron.
> Owner-facing summary at the bottom.

## 0. Why this exists (and why an engine, not a feature)

The two asks that started this — **randomized 2–5 min delay** and a **verified follow-gate** — both turned
out to be impossible on Zernio's hosted comment-automation (it fires in 1–3 s, and its create endpoint has
no delay or follow field; verified in the docs). Both require **Mashal to execute the automation itself**.

Rather than bolt those two onto the existing rule, we build a small **general engine** — the same shape
ManyChat uses: **Trigger → Condition → Action**, over a first-class **Contact**, with a **delay/wait**
primitive. Every future ManyChat-parity feature (buttons, sequences, tags, branching, broadcasts) then
becomes **a new step type**, not an engine rewrite. That is the whole point: build the runtime once, ship
capabilities one at a time.

**Non-goals for v1** (explicitly deferred, tracked in §6 roadmap): visual flow builder UI, WhatsApp/SMS/
email channels, e-commerce/CRM integrations, AI steps, broadcasts. We ship the *runtime* + the two asks
first, then add node types.

## 1. Ground truth — what our stack actually allows (verified)

Everything below is confirmed against Zernio's docs / our own code; the engine is designed to these limits.

| Capability | Reality | Source |
|---|---|---|
| Follow status | `instagramProfile.isFollower` = "whether the participant follows your business account". **IG only.** On `GET /inbox/conversations[/{id}]` and on the **`message.received` webhook** (`message.sender.instagramProfile.isFollower`). | docs.zernio.com/platforms/instagram |
| Follow check timing | **Not available at comment time** — "only exposed on received conversations or when participants engage first." So a real gate is inherently **two-step** (open DM → verify on their reply). | docs.zernio.com/platforms/instagram |
| Hosted automation | Create fields: `profileId, accountId, trigger, platformPostId, postId, name, keywords, matchMode, dmMessage, buttons, commentReply, linkTracking, clickTag`. **No delay, no follow field.** Sends in 1–3 s. | docs.zernio.com/comment-automations |
| Send DM | `POST /inbox/conversations/{conversationId}/messages` `{accountId, message}`. 24 h window; `HUMAN_AGENT` tag extends it but **needs FB App Review (we don't have it)** → sends are 24 h-window only. | api/_lib/zernio.js |
| Comment reply | `POST /inbox/comments/{postId}` `{accountId, commentId, message}`. On IG you **can only reply to an existing comment**, not post a new top-level one. | zernio.js / IG platform doc |
| Comment trigger | `comment.received` webhook already lands in `inbox_events` (Meta real-time for IG/FB; FB delivery has been flaky — see §9). | api/webhooks/zernio.js |
| Buttons / link tracking | Zernio supports `buttons` + `linkTracking`/`clickTag` on messages. | comment-automations doc |
| Async / delay | No platform primitive. We provide it with a **jobs table + a frequent cron worker** (§4). Needs a sub-hourly cron (≈2 min) — see §9 open item. | Vercel cron |

## 2. Architecture — a step interpreter over a flow definition

```
 inbound event (webhook)                    time (cron, ~2 min)
        │                                          │
        ▼                                          ▼
  ┌───────────┐   match    ┌──────────┐  resume  ┌───────────┐
  │  Ingest   │──trigger──▶│  Runner  │◀─due job─│  Worker   │
  │ (triggers)│            │ (steps)  │          │  (jobs)   │
  └───────────┘            └────┬─────┘          └───────────┘
        │                       │ executes steps until it must WAIT
        ▼                       ▼ (delay → job; wait_for_reply → parked run)
   upsert Contact          send DM / reply / set tag / condition / …
   (+ isFollower)          via the Zernio client (channel-agnostic action layer)
```

Four moving parts, each independently testable:

1. **Ingest** — the only hook into the existing webhook. Maps an inbound event (comment, message, later:
   follow) to zero-or-more **triggers** on active flows; starts a **run** per match. Non-blocking and
   best-effort so it never breaks the webhook ACK.
2. **Runner** — executes a flow's **steps** for one contact until it hits a *wait* (a `delay`, or a
   `wait_for_reply`). Pure interpreter: it looks up a **step handler** by `type` and calls it. Adding a
   feature = registering a new handler.
3. **Worker (cron)** — claims **due jobs** (delayed sends, sequence steps, re-prompts) and resumes their
   runs. The universal async primitive; delays/sequences/retries/broadcasts all ride it.
4. **Contact store** — first-class subscriber per (workspace, account, platform user). Holds `isFollower`,
   tags, custom fields. Minimal in v1, but it's what makes conditions / segments / sequences possible later.

**Scalability contract:** the engine core (ingest, runner, worker) never changes to add a capability. A new
capability = **(a)** a new trigger matcher, **(b)** a new condition evaluator, or **(c)** a new action/step
handler — all registered in a table-driven registry. This is the ManyChat model (Triggers/Conditions/
Actions) reduced to its runtime essence.

## 3. Data model (new tables — additive, own the module)

Designed as a **superset** of what v1 needs so later phases don't migrate, just fill in.

- **`automation_flows`** — one row per rule/flow.
  `id, workspace_id, account_id, zernio_account_id, platform, name, is_active,
   trigger jsonb (type + params: e.g. {type:'comment', keywords, match_mode, post_scope}),
   definition jsonb (ordered list/graph of steps), version int,
   stat_* (cached counters), created_by, created_at, updated_at`.
  *v1 supersedes `comment_automations`* — that table's rows migrate in as flows (see §9).
- **`automation_contacts`** — the subscriber.
  `id, workspace_id, account_id, platform, platform_user_id, handle, conversation_id,
   is_follower bool, follower_checked_at, tags text[], fields jsonb, last_seen_at, created_at`.
  Unique on (workspace_id, account_id, platform_user_id).
- **`automation_runs`** — one active execution of a flow for a contact.
  `id, flow_id, contact_id, status ('active'|'waiting'|'done'|'failed'|'expired'),
   current_step int, wait_kind ('reply'|'delay'|null), context jsonb (run variables),
   started_at, updated_at, expires_at`.
  Idempotency: at most one non-terminal run per (flow_id, contact_id) unless the flow opts into re-entry.
- **`automation_jobs`** — the scheduler.
  `id, workspace_id, run_id, run_at timestamptz, kind ('resume'|'send'|'sweep'),
   payload jsonb, status ('pending'|'done'|'failed'), attempts int, locked_at, last_error`.
  Worker claims with `UPDATE … SET status,locked_at … WHERE id IN (SELECT … WHERE run_at<=now()
  AND status='pending' ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT n) RETURNING *` — atomic, no double-fire.
- **`automation_events`** — append-only audit / analytics feed.
  `id, workspace_id, flow_id, run_id, contact_id, kind ('triggered'|'dm_sent'|'reply'|'follow_verified'|
   'gate_prompt'|'failed'|…), meta jsonb, at`.  Powers stats without hammering Zernio (mirrors how
  `inbox_events` already backs the feed).

Step `definition` shape (v1 step types — the registry grows per phase):
`send_dm` · `comment_reply` · `delay {min_s,max_s}` · `condition {isFollower|tag|field}` ·
`wait_for_reply {timeout_s}` · `set_tag` (P4) · `set_field` (P4) · `fire_webhook` (reuses existing outbound
webhooks) · `goto` / `branch`.

## 4. Execution model (the runtime loop)

1. **Webhook** (`api/webhooks/zernio.js`) writes `inbox_events` as today, then calls `engine.ingest(event)`
   (wrapped in try/catch; failure logs, never blocks the 200).
2. **ingest**: upsert the `automation_contact` (stamp `is_follower` when the event carries `instagramProfile`).
   For each active flow whose trigger matches (keyword/scope for `comment.received`; reply for a `waiting`
   run on `message.received`): resume the waiting run, or start a new run.
3. **runner(run)**: loop steps from `current_step`:
   - `send_dm` / `comment_reply` → call Zernio; log an `automation_event`.
   - `condition` → evaluate against the contact (e.g. `isFollower`), pick the branch.
   - `delay {2m,5m}` → compute `run_at = now + rand`, insert an `automation_jobs` row (`kind:'resume'`),
     set run `waiting/delay`, **return** (worker resumes later).
   - `wait_for_reply {timeout}` → set run `waiting/reply`, insert a `sweep`/timeout job at `now+timeout`,
     **return** (ingest resumes it on the contact's next inbound message).
   - end of steps → run `done`.
4. **worker cron** (`api/cron/automation.js`, every ~2 min): claim due jobs → `resume` runs (re-enter the
   runner at `current_step`) / `send` / `sweep` expired waits. Retries with backoff; `attempts` cap → `failed`.

**Randomized delay** = the `delay` step with `min_s=120, max_s=300` and `run_at = now + rand(min,max)`.
Every automated DM/comment thus lands 2–5 min later, naturally jittered.

## 5. Modularity contract (seams — the only edits to existing files)

**New, self-contained units:** `api/_lib/automation/` (engine: `ingest.js`, `runner.js`, `steps/*`,
`jobs.js`), `api/cron/automation.js` (worker), `api/engage/flows.js` (CRUD, supersedes `automations.js`),
`migrations/03x_automation_engine.sql`, and the flow builder UI later.

| Seam | File | Change |
|---|---|---|
| S1 | `api/webhooks/zernio.js` | after the `inbox_events` insert, `await engine.ingest(evt).catch(log)` — one guarded call |
| S2 | `vercel.json` | add `{ path:'/api/cron/automation', schedule:'*/2 * * * *' }` to `crons` |
| S3 | `api/engage/automations.js` | keep as thin shim over `flows.js` (or migrate the UI to it) so the current form keeps working |
| S4 | `migrations/` | new tables (§3) + one-time backfill of `comment_automations` → `automation_flows` |
| S5 | Zernio hosted rules | on cutover, disable/delete the hosted twin per migrated flow (avoid double-send, §9) |

Hard rules: engine failures **never** block the webhook; the engine only **reads** `inbox_events` semantics
(it doesn't change that write path or the live-signals cron); all sends go through the existing `zernio`
client (one provider seam).

## 6. ManyChat feature map → our build → phase

| ManyChat feature | How ManyChat does it | How we build it | Phase |
|---|---|---|---|
| Comment→DM (keyword) | Graph comment webhook + keyword | `comment.received` → trigger → `send_dm` | **P0** (parity + migrate) |
| Post scope (this/any/next) | per-automation post filter | `trigger.post_scope` (`platform_post_id`\|`all`\|`next`) | P1 |
| Public comment reply | reply to the comment | `comment_reply` step (IG: reply-only) | P1 |
| **Smart Delay (2–5 min)** | Delay node (min/hr/day) | `delay` step → `automation_jobs` + worker | **P1** ← ask #1 |
| **Follow-gate ("Ask to follow")** | Condition "only followers" + prompt | 2-step: open DM → verify `isFollower` on reply | **P2** ← ask #2 |
| Buttons / quick replies | interactive message buttons | `send_dm` with Zernio `buttons` | P3 |
| In-DM keyword trigger | keyword in a DM | `message.received` keyword → trigger | P3 |
| Tags & custom fields | subscriber data model | `automation_contacts.tags/fields` + `set_tag`/`set_field` | P4 |
| Conditions / branching | Condition node | `condition` step over contact tags/fields/follow | P4 |
| New-follower ("Follow-to-DM") | new-follower trigger | follow webhook (if Zernio emits) → trigger | P4 (dep) |
| Sequences / drips | timed message series | flow of `delay`+`send_dm`, or a sequence table on jobs | P5 |
| Broadcasts | mass send to a segment | segment query → bulk jobs (24 h-window aware) | P6 |
| Live-chat handoff | human takeover in Inbox | our Conversations inbox + `pause_automation` flag on contact | P6 |
| Analytics / click tracking | per-node metrics + link clicks | aggregate `automation_events`; `linkTracking`/`clickTag` | P7 |
| AI step | LLM intentions/replies | `ai_reply` step → our intelligence layer / Claude | Future |
| WhatsApp / SMS / Email | native channels | channel-agnostic action layer + Zernio/provider | Future |
| Integrations (Shopify/Zapier) | native + Zapier | `fire_webhook` step (reuses existing outbound webhooks) | Future |

## 7. Phased build order (one feature at a time)

- **P0 — Runtime + parity.** Tables, ingest, runner, worker cron, contact upsert. Migrate the existing
  keyword→DM rule onto the engine at **instant** send (feature-parity), disable its Zernio-hosted twin,
  verify parity behind a flag. *Nothing user-visible changes yet — this is the foundation.*
- **P1 — Randomized delay** (ask #1) + public comment reply + post scoping. First visible behavior change.
- **P2 — Verified follow-gate (IG)** (ask #2): open-DM → `wait_for_reply` → check `isFollower` → deliver
  after the delay, or re-prompt. FB has no follow field, so FB flows get the delay only.
- **P3 — Buttons/quick replies + in-DM keyword trigger.**
- **P4 — Contact maturity:** tags, custom fields, conditions/branching, new-follower trigger.
- **P5 — Sequences/drips. P6 — Broadcasts + live-chat handoff. P7 — Analytics + click tracking.**
- **Future — AI step, multi-channel, deep integrations.**

Each phase is shippable on its own and only *adds* step/trigger types — no core rewrite.

## 8. The two asks, concretely (P1 + P2)

**Delay (P1).** Any flow that sends a DM/comment inserts a `delay {120,300}` step before the send. Worker
fires it at `run_at`. Result: every automated message goes out 2–5 min later, jittered.

**Follow-gate (P2), IG, real verification:**
```
comment(keyword) ─▶ open DM: "Follow @you & reply here to grab [X] 🎁"  (+ optional public reply "Check your DMs 📩")
                 └▶ wait_for_reply (timeout e.g. 24h)
their reply ─▶ read message.sender.instagramProfile.isFollower
   ├─ true  ─▶ delay(2–5m) ─▶ send [X]         (verified — not a self-report)
   └─ false ─▶ "Not following yet — follow @you and reply again" ─▶ wait_for_reply (cap N re-prompts)
```
Genuine check (fresh `isFollower` on their reply), just necessarily after the DM opens — which is exactly
how ManyChat's gate behaves.

## 9. Open items / dependencies / risks

1. **Cron frequency.** Need a sub-hourly worker (~2 min). Confirm the Vercel plan allows `*/2 * * * *`
   (Hobby is limited; Pro allows frequent crons). Fallback: Vercel Queues (beta) or a 1-min cron.
2. **`isFollower` freshness.** `instagramProfile` has a `fetchedAt`; confirm the value on `message.received`
   reflects the follow *at reply time* (inspect one real payload before shipping P2).
3. **Comment-webhook reliability vs hosted.** Zernio-hosted was 1–3 s reliable; our webhook adds hops, and
   FB comment delivery has been flaky. Mitigation: a periodic **`sweep`** that pulls recent comments
   (`GET /inbox/comments/{postId}`) and back-fills missed triggers — a backstop, not the primary path.
4. **Cutover / no double-send.** Disabling the Zernio-hosted twin per migrated flow must be atomic with the
   engine taking over, or a comment fires twice / not at all. Do it flow-by-flow behind a flag.
5. **24 h messaging window.** The 2–5 min delay is safely inside it; re-prompts and sequences must respect
   it (no `HUMAN_AGENT` — we lack FB review). Expire waits accordingly.
6. **Send rate limits.** Fine for comment→DM volume; matters for P6 broadcasts (throttle via jobs).

## 10. Decisions to lock before P0

- **Flow storage:** JSON `definition` on the flow (recommended — fast to evolve, one row) vs a normalized
  `flow_steps` table (queryable, heavier). Recommend JSON + a `version` int.
- **Build shape:** generic engine first (P0), *then* the two asks — vs. hard-code delay+gate now and refactor
  later. The stated goal is scalability, so **generic-first**; the extra P0 cost buys every later phase.
- **Scope of "contact":** per connected account (recommended) vs per workspace — affects tag/segment reuse.

---

### Owner-facing summary

We're building a small **automation engine** — the same Trigger → Condition → Action shape ManyChat uses —
because the delay and the follow-gate can't run on Zernio's instant automation. Build the runtime **once**
(a rules table, a contact record, and a timed-job worker), then add ManyChat features **one at a time** as
plug-in "steps": first the **2–5 min randomized delay**, then the **verified Instagram follow-gate** (real
`isFollower` check on their reply), then buttons, tags, branching, sequences, broadcasts. Each phase ships on
its own; none requires rebuilding the engine. First we lock three small decisions (§10), then build P0.
