// Offline end-to-end test for the automation engine (P1 delay + P2 follow-gate).
//
// Runs the REAL engine code — ingest → runner → step handlers → jobs → worker —
// against an in-memory Supabase and a fake Zernio, so we can prove both features
// execute in the right order (and the not-following branch) WITHOUT any live
// platform events. No network, no DB. Run:  node scripts/test-automation-engine.mjs
//
// It works by overriding the METHODS on the shared `supabase` / `zernio` objects
// (the engine looks them up at call time), so every module under test runs
// unmodified. Exits non-zero on the first failed assertion.

import assert from 'node:assert';
import { supabase } from '../api/_lib/supabase.js';
import zernioDefault, { zernio } from '../api/_lib/zernio.js';
import { buildFlowDefinition, buildTrigger, deriveEngine, normalizeButtons, normalizeQuickReplies } from '../api/_lib/automation/flow-builder.js';
import { toZernioBody, buttonsForZernio } from '../api/engage/automations.js';

process.env.AUTOMATION_ENGINE = '1';   // flags.engineEnabled() reads this at call time

// ── in-memory store ─────────────────────────────────────────────────────────
const store = {
  automation_flows: [], automation_contacts: [], automation_runs: [],
  automation_jobs: [], automation_events: [],
};
let idc = 0;
const genId = (p) => `${p}_${++idc}`;
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const nowIso = () => new Date().toISOString();

const eqMatch = (r, eq) => !eq || Object.entries(eq).every(([k, v]) => r[k] === v);
const inMatch = (r, inq) => !inq || Object.entries(inq).every(([k, vals]) => vals.includes(r[k]));
const cmpMatch = (r, q) =>
  (!q.lte || Object.entries(q.lte).every(([k, v]) => r[k] != null && r[k] <= v)) &&
  (!q.gte || Object.entries(q.gte).every(([k, v]) => r[k] != null && r[k] >= v)) &&
  (!q.lt  || Object.entries(q.lt ).every(([k, v]) => r[k] != null && r[k] <  v));

function applyQuery(table, q) {
  let rows = store[table].filter((r) => eqMatch(r, q.eq) && inMatch(r, q.in) && cmpMatch(r, q));
  if (q.order) {
    const [field, dir] = q.order.split('.');
    rows = [...rows].sort((a, b) =>
      (String(a[field]) < String(b[field]) ? -1 : String(a[field]) > String(b[field]) ? 1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  if (q.limit) rows = rows.slice(0, q.limit);
  return rows;
}

supabase.select = async (table, q = {}) => {
  const rows = applyQuery(table, q);
  if (q.single) return rows.length ? clone(rows[0]) : null;
  return clone(rows);
};

supabase.insert = async (table, rows) => {
  const arr = Array.isArray(rows) ? rows : [rows];
  const out = [];
  for (const r of arr) {
    const row = { ...r };
    if (!row.id) row.id = genId(table);
    if (!row.created_at) row.created_at = nowIso();
    // Emulate the partial unique index: one active/waiting run per (flow, contact).
    if (table === 'automation_runs' && ['active', 'waiting'].includes(row.status)) {
      const dup = store.automation_runs.find((x) =>
        x.flow_id === row.flow_id && x.contact_id === row.contact_id && ['active', 'waiting'].includes(x.status));
      if (dup) { const e = new Error('duplicate key value violates unique constraint'); throw e; }
    }
    store[table].push(row);
    out.push(clone(row));
  }
  return out;
};

supabase.upsert = async (table, rows, { onConflict } = {}) => {
  const cols = String(onConflict || '').split(',').map((s) => s.trim()).filter(Boolean);
  const arr = Array.isArray(rows) ? rows : [rows];
  const out = [];
  for (const r of arr) {
    const existing = cols.length
      ? store[table].find((x) => cols.every((c) => x[c] === r[c]))
      : null;
    if (existing) { Object.assign(existing, r); out.push(clone(existing)); }
    else {
      const row = { ...r, id: r.id || genId(table), created_at: nowIso() };
      store[table].push(row); out.push(clone(row));
    }
  }
  return out;
};

supabase.update = async (table, patch, q = {}) => {
  const rows = store[table].filter((r) => eqMatch(r, q.eq) && inMatch(r, q.in));
  rows.forEach((r) => Object.assign(r, patch));
  return clone(rows);
};

supabase.delete = async (table, q = {}) => {
  store[table] = store[table].filter((r) => !eqMatch(r, q.eq));
  return [];
};

// ── fake Zernio (record every outbound) ─────────────────────────────────────
const calls = [];
const patchZernio = (z) => {
  z.sendPrivateReply = async (a) => { calls.push({ op: 'private_reply', ...a }); return { status: 'ok', messageId: genId('msg'), commentId: a.commentId, platform: 'instagram' }; };
  z.sendDirectMessage = async (a) => { calls.push({ op: 'dm', ...a }); return { messageId: genId('msg') }; };
  z.replyToComment = async (a) => { calls.push({ op: 'comment_reply', ...a }); return { id: genId('cr') }; };
};
patchZernio(zernio);
patchZernio(zernioDefault);

// Import the engine AFTER the fakes are in place (methods are looked up at call
// time regardless, but this keeps intent clear).
const { ingestFromWebhook, tick } = await import('../api/_lib/automation/index.js');

// ── helpers ─────────────────────────────────────────────────────────────────
const WS = 'ws1', ZACC = 'zacc1', ACC = 'acc1';

function seedFlow(cfg) {
  const flow = {
    id: genId('flow'), workspace_id: WS, account_id: ACC, zernio_account_id: ZACC,
    platform: 'instagram', name: cfg.name, is_active: true,
    trigger: buildTrigger({ keywords: cfg.keywords, matchMode: 'contains', triggerType: cfg.triggerType }),
    definition: buildFlowDefinition(cfg), source: 'comment_automation',
    stat_triggered: 0, stat_dms_sent: 0, stat_dms_failed: 0, stat_completed: 0,
    created_at: nowIso(),
  };
  store.automation_flows.push(flow);
  return flow;
}

const commentEvent = (over = {}) => ({
  kind: 'comment.received', workspaceId: WS, accountId: ACC, zernioAccountId: ZACC,
  platform: 'instagram', platformPostId: over.postId || 'post1', postId: null,
  payload: { comment: { id: over.commentId || 'c1', text: over.text || 'please send the link', author: { id: over.userId || 'user1', username: over.handle || 'alice' } } },
});

const messageEvent = (over = {}) => ({
  kind: 'message.received', workspaceId: WS, accountId: ACC, zernioAccountId: ZACC,
  platform: 'instagram',
  payload: {
    message: { conversationId: over.conversationId || 'conv1', direction: over.direction || 'incoming', text: over.text != null ? over.text : (over.metadata ? '' : 'done'), sender: { id: over.userId || 'user1', username: over.handle || 'alice', instagramProfile: { isFollower: !!over.isFollower } } },
    ...(over.metadata ? { metadata: over.metadata } : {}),   // interactive tap (postback/quick-reply)
  },
});

// Fast-forward: make every pending job due now, then drain the worker.
async function runDueJobs() {
  for (const j of store.automation_jobs) if (j.status === 'pending') j.run_at = new Date(Date.now() - 1000).toISOString();
  return tick({ limit: 50 });
}

const pendingJobs = () => store.automation_jobs.filter((j) => j.status === 'pending');
const lastCall = () => calls[calls.length - 1];
let passed = 0;
const ok = (label) => { console.log(`  ✓ ${label}`); passed++; };

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1 — P1: 2–5 min delay on a plain comment→DM
// ─────────────────────────────────────────────────────────────────────────────
async function testDelay() {
  console.log('\nP1 — randomized delay');
  const flow = seedFlow({ name: 'Delay rule', keywords: ['link'], dmMessage: 'Here is your link!', delay: { min_seconds: 120, max_seconds: 300 } });
  assert.deepEqual(flow.definition.map((s) => s.type), ['delay', 'send_dm'], 'definition is [delay, send_dm]');
  ok('flow compiles to [delay, send_dm]');

  const t0 = Date.now();
  await ingestFromWebhook(commentEvent({ text: 'can you send me the link?' }));

  assert.equal(calls.length, 0, 'nothing sent yet (still delaying)');
  ok('no DM sent immediately — the send is deferred');

  const jobs = pendingJobs();
  assert.equal(jobs.length, 1, 'exactly one job scheduled');
  assert.equal(jobs[0].kind, 'resume', 'it is a resume job');
  const dueInMs = new Date(jobs[0].run_at).getTime() - t0;
  assert.ok(dueInMs >= 120_000 - 2000 && dueInMs <= 300_000 + 2000, `delay is 2–5 min (got ${Math.round(dueInMs / 1000)}s)`);
  ok(`delay scheduled ${Math.round(dueInMs / 1000)}s out — inside the 2–5 min window`);

  await runDueJobs();
  assert.equal(calls.length, 1, 'one send after the delay');
  assert.equal(lastCall().op, 'private_reply', 'first-touch DM uses the private-reply opener');
  assert.equal(lastCall().message, 'Here is your link!', 'correct DM text');
  ok('after the delay elapses, the DM goes out via private-reply');

  const run = store.automation_runs.find((r) => r.flow_id === flow.id);
  assert.equal(run.status, 'done', 'run completed');
  ok('run completed');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2 — P2: verified follow-gate (not-following → re-prompt → follows → deliver)
// ─────────────────────────────────────────────────────────────────────────────
async function testFollowGate() {
  console.log('\nP2 — verified follow-gate (+ delay on delivery)');
  const flow = seedFlow({
    name: 'Gate rule', keywords: ['guide'], dmMessage: 'Here is your free guide! 🎁',
    delay: { min_seconds: 120, max_seconds: 300 }, requireFollow: true,
    followPrompt: 'Follow me first, then reply here!', rePrompt: "You're not following yet — follow & reply!",
  });
  const types = flow.definition.map((s) => s.type);
  assert.deepEqual(types, ['send_dm', 'wait_for_reply', 'condition', 'delay', 'send_dm', 'end', 'send_dm', 'wait_for_reply', 'condition', 'goto'], 'gate definition shape');
  ok('flow compiles to the two-step gate (opener → wait → verify → delay → deliver, with re-prompt)');

  // 1) keyword comment → opener DM asking to follow, then waits for a reply.
  await ingestFromWebhook(commentEvent({ userId: 'bob', handle: 'bob', commentId: 'c2', text: 'send me the guide' }));
  assert.equal(lastCall().op, 'private_reply', 'opener is a private reply');
  assert.equal(lastCall().message, 'Follow me first, then reply here!', 'opener asks them to follow');
  let run = store.automation_runs.find((r) => r.flow_id === flow.id);
  assert.equal(run.status, 'waiting', 'run is waiting for their reply');
  assert.equal(run.wait_kind, 'reply', 'waiting on a reply');
  ok('keyword comment → follow-prompt DM sent, run waits for reply');

  const sendsBefore = calls.length;

  // 2) they reply but are NOT following → re-prompt, wait again. No content yet.
  await ingestFromWebhook(messageEvent({ userId: 'bob', handle: 'bob', conversationId: 'conv_bob', isFollower: false, text: 'ok done' }));
  assert.equal(calls.length, sendsBefore + 1, 'one message sent (the re-prompt), not the content');
  assert.equal(lastCall().op, 'dm', 're-prompt goes into the open thread');
  assert.equal(lastCall().message, "You're not following yet — follow & reply!", 're-prompt text');
  assert.ok(!calls.some((c) => c.message && c.message.includes('free guide')), 'the gated content was NOT delivered to a non-follower');
  run = store.automation_runs.find((r) => r.flow_id === flow.id);
  assert.equal(run.status, 'waiting', 'still waiting after the re-prompt');
  ok('non-follower reply → re-prompt only; gated content withheld');

  // 3) they follow and reply again → verified, delay scheduled (content still not sent yet).
  await ingestFromWebhook(messageEvent({ userId: 'bob', handle: 'bob', conversationId: 'conv_bob', isFollower: true, text: 'followed!' }));
  assert.ok(!calls.some((c) => c.message && c.message.includes('free guide')), 'still not delivered — the delivery is delayed');
  const jobs = pendingJobs();
  assert.equal(jobs.length, 1, 'a delivery delay is scheduled');
  assert.equal(jobs[0].kind, 'resume', 'resume job for the delayed delivery');
  ok('verified follower → delivery scheduled behind the 2–5 min delay');

  // 4) delay elapses → the actual content is delivered into the thread.
  await runDueJobs();
  assert.equal(lastCall().op, 'dm', 'content delivered as a DM in-thread');
  assert.equal(lastCall().message, 'Here is your free guide! 🎁', 'the requested content is delivered');
  assert.equal(lastCall().conversationId, 'conv_bob', 'delivered into their conversation');
  run = store.automation_runs.find((r) => r.flow_id === flow.id);
  assert.equal(run.status, 'done', 'gate run completed');
  ok('after follow + delay, the requested content is delivered — run complete');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3 — idempotency: a repeat comment while a run is in flight does not double-fire
// ─────────────────────────────────────────────────────────────────────────────
async function testIdempotency() {
  console.log('\nIdempotency — repeat comment mid-run');
  const flow = seedFlow({ name: 'Idem rule', keywords: ['promo'], dmMessage: 'Deal!', delay: { min_seconds: 120, max_seconds: 300 } });
  await ingestFromWebhook(commentEvent({ userId: 'cara', handle: 'cara', commentId: 'c3', text: 'promo please' }));
  await ingestFromWebhook(commentEvent({ userId: 'cara', handle: 'cara', commentId: 'c3b', text: 'promo again' }));
  const runs = store.automation_runs.filter((r) => r.flow_id === flow.id);
  assert.equal(runs.length, 1, 'only one run for the same contact while active');
  ok('repeat comment from the same person does not start a second run');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4 — URL buttons flow through to the private-reply send
// ─────────────────────────────────────────────────────────────────────────────
async function testButtons() {
  console.log('\nButtons — URL buttons on the DM');
  const flow = seedFlow({
    name: 'Btn rule', keywords: ['kit'], dmMessage: 'Here you go!',
    buttons: [{ type: 'url', title: 'Follow @me', url: 'https://instagram.com/me' },
              { type: 'url', title: 'Get the kit', url: 'https://example.com/kit' }],
  });
  const send = flow.definition.find(s => s.type === 'send_dm');
  assert.ok(Array.isArray(send.buttons) && send.buttons.length === 2, 'buttons compiled onto the send_dm step');
  ok('buttons compile onto the DM step');

  await ingestFromWebhook(commentEvent({ userId: 'dan', handle: 'dan', commentId: 'c4', text: 'send the kit please' }));
  const pr = [...calls].reverse().find(c => c.op === 'private_reply');
  assert.ok(pr?.buttons?.length === 2, 'both buttons passed to sendPrivateReply');
  assert.equal(pr.buttons[0].title, 'Follow @me', 'button label preserved');
  assert.equal(pr.buttons[0].url, 'https://instagram.com/me', 'button URL preserved');
  assert.equal(pr.buttons[0].type, 'url', 'button type is url');
  ok('URL buttons flow through to the private-reply send with correct shape');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5 — Zernio hosted body: spec-correct button semantics.
// Zernio (per its OpenAPI): create "omit or [] = plain-text DM"; update "[] =
// clear all buttons". So a plain rule with no buttons must OMIT (keep its
// payload identical to a pre-buttons rule), and [] is sent only to clear real
// buttons — with the comment reply always preserved.
// ─────────────────────────────────────────────────────────────────────────────
async function testZernioBodyButtons() {
  console.log('\nZernio hosted body — spec-correct button semantics + comment reply');
  const oneBtn = [{ type: 'url', title: 'x', url: 'https://x.com' }];

  // buttonsForZernio — the set/clear/omit decision (Zernio docs: create omit/[]
  // = plain text; update [] = clear). The safety-critical case is a plain rule
  // (no buttons, none before): it must OMIT, never send [], so the payload is
  // identical to a rule from before buttons existed.
  assert.equal(buttonsForZernio([], undefined), undefined, 'no buttons + none before → omit (plain rule untouched)');
  assert.equal(buttonsForZernio([], []), undefined, 'no buttons + none before → omit');
  assert.deepEqual(buttonsForZernio([], oneBtn), [], 'removing buttons that existed → [] to clear (Zernio-documented)');
  assert.deepEqual(buttonsForZernio(oneBtn, []), oneBtn, 'buttons present → set them');
  ok('buttonsForZernio: omit for plain rules, [] only to clear real buttons, set when present');

  // toZernioBody faithfully forwards what buttonsForZernio decided.
  // Plain rule (omit) → no buttons key at all → the exact pre-buttons payload.
  const plain = toZernioBody({
    zernio_account_id: ZACC, name: 'Plain', keywords: ['link'], match_mode: 'contains',
    dm_message: 'Here you go', comment_reply: 'Check your DMs 📩', is_active: true,
    buttons: buttonsForZernio([], undefined),
  });
  assert.equal(plain.commentReply, 'Check your DMs 📩', 'comment reply included');
  assert.ok(!('buttons' in plain), 'no buttons key for a plain rule (payload unchanged, comment reply safe)');
  ok('plain rule → comment reply preserved, no buttons field sent');

  // Clearing a rule that had buttons → [] forwarded, comment reply still sent.
  const cleared = toZernioBody({ zernio_account_id: ZACC, comment_reply: 'hi', buttons: buttonsForZernio([], oneBtn) });
  assert.deepEqual(cleared.buttons, [], 'explicit [] forwarded to clear buttons on update');
  assert.equal(cleared.commentReply, 'hi', 'comment reply sent alongside a clear');
  ok('[] forwarded only to clear real buttons — with the comment reply intact');

  // Real buttons → sent with the comment reply.
  const withBtns = toZernioBody({
    zernio_account_id: ZACC, dm_message: 'Here you go', comment_reply: 'Check your DMs 📩',
    buttons: buttonsForZernio([{ type: 'url', title: 'Get it', url: 'https://example.com' }], null),
  });
  assert.equal(withBtns.buttons.length, 1, 'real buttons are sent');
  assert.equal(withBtns.commentReply, 'Check your DMs 📩', 'comment reply sent alongside buttons');
  ok('non-empty buttons → sent through with the comment reply');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6 — P3: in-DM keyword trigger (keyword in a DM → in-thread auto-reply)
// ─────────────────────────────────────────────────────────────────────────────
async function testMessageTrigger() {
  console.log('\nP3 — in-DM keyword trigger');

  // Message triggers are native-only: Zernio hosts comment-automations only.
  assert.equal(deriveEngine({ triggerType: 'message' }), 'native', 'message trigger → native regardless of delay/gate');
  assert.equal(deriveEngine({ triggerType: 'comment' }), 'zernio', 'plain comment trigger stays on Zernio');
  ok('a DM-keyword trigger always routes to the native engine');

  const flow = seedFlow({
    name: 'DM kw', keywords: ['price'], dmMessage: 'It’s $49 — here you go!', triggerType: 'message',
    buttons: [{ type: 'url', title: 'Buy now', url: 'https://example.com/buy' }],
  });
  assert.equal(flow.trigger.type, 'message', 'trigger compiles to type "message"');
  assert.ok(!('post_scope' in flow.trigger), 'no post scope on a DM trigger (there is no post)');
  assert.deepEqual(flow.definition.map(s => s.type), ['send_dm'], 'plain message flow is a single in-thread DM');
  assert.equal(flow.definition[0].via, 'conversation', 'the reply goes into the open thread, not a private-reply opener');
  ok('flow compiles to a single in-thread send_dm (no comment reply, no opener)');

  // An inbound DM containing the keyword → auto-reply into the same thread.
  const before = calls.length;
  await ingestFromWebhook(messageEvent({ userId: 'erin', handle: 'erin', conversationId: 'conv_erin', text: 'hey whats the price?' }));
  assert.equal(calls.length, before + 1, 'exactly one reply sent');
  assert.equal(lastCall().op, 'dm', 'reply is an in-thread DM (sendDirectMessage)');
  assert.equal(lastCall().conversationId, 'conv_erin', 'reply lands in their conversation');
  assert.equal(lastCall().message, 'It’s $49 — here you go!', 'the configured reply is sent');
  assert.ok(lastCall().buttons?.length === 1 && lastCall().buttons[0].title === 'Buy now', 'buttons flow through to the in-thread DM');
  ok('inbound DM keyword → in-thread auto-reply, with buttons attached');

  // A DM that does NOT contain the keyword → nothing fires.
  const before2 = calls.length;
  await ingestFromWebhook(messageEvent({ userId: 'fred', handle: 'fred', conversationId: 'conv_fred', text: 'just saying hi' }));
  assert.equal(calls.length, before2, 'a non-matching DM does not trigger a reply');
  ok('a DM without the keyword does not fire');

  // An outgoing (echoed) message with the keyword must NOT fire — the engine
  // sends DMs, so a self-reply loop would be catastrophic. Guarded on direction.
  const beforeOut = calls.length;
  await ingestFromWebhook(messageEvent({ userId: 'zoe', handle: 'zoe', conversationId: 'conv_zoe', text: 'whats the price?', direction: 'outgoing' }));
  assert.equal(calls.length, beforeOut, 'an outgoing/echoed message does not trigger a flow');
  ok('outgoing messages are ignored (no echo-triggered sends)');

  // Delay composes with a message trigger.
  const dflow = seedFlow({ name: 'DM kw delay', keywords: ['demo'], dmMessage: 'Booking link 👉', triggerType: 'message', delay: { min_seconds: 120, max_seconds: 300 } });
  assert.deepEqual(dflow.definition.map(s => s.type), ['delay', 'send_dm'], 'delayed message flow is [delay, send_dm]');
  ok('delay composes with a DM-keyword trigger');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 7 — P3: interactive replies (postback buttons, quick-reply chips, tap routing)
// ─────────────────────────────────────────────────────────────────────────────
async function testInteractiveReplies() {
  console.log('\nP3 — interactive replies (postback buttons, quick-reply chips, tap routing)');

  // normalizeButtons is type-aware: url needs a url, postback needs a payload.
  const nb = normalizeButtons([
    { type: 'url', title: 'Site', url: 'https://x.com' },
    { type: 'postback', title: 'Pricing', payload: 'pricing' },
    { type: 'postback', title: 'NoPayload' },          // dropped — postback needs a payload
    { type: 'url', title: 'Bad', url: 'ftp://x' },      // dropped — not http(s)
  ]);
  assert.deepEqual(nb, [
    { type: 'url', title: 'Site', url: 'https://x.com' },
    { type: 'postback', title: 'Pricing', payload: 'pricing' },
  ], 'keeps valid url+postback, drops malformed');
  ok('normalizeButtons validates per type (url/postback)');

  // Quick replies default their payload to the label.
  assert.deepEqual(
    normalizeQuickReplies([{ title: 'Yes' }, { title: 'No', payload: 'no_thanks' }]),
    [{ title: 'Yes', payload: 'Yes' }, { title: 'No', payload: 'no_thanks' }],
    'chip payload defaults to the label');
  ok('normalizeQuickReplies defaults the payload to the label');

  // Chips attach to a DM-keyword reply (in-thread); buttons win when both set.
  const chipFlow = buildFlowDefinition({ triggerType: 'message', dmMessage: 'Pick one', quickReplies: [{ title: 'A' }, { title: 'B' }] });
  assert.equal(chipFlow[0].quick_replies?.length, 2, 'chips attach to the in-thread reply');
  assert.ok(!chipFlow[0].buttons, 'no buttons when only chips set');
  const bothFlow = buildFlowDefinition({ triggerType: 'message', dmMessage: 'Hi', buttons: [{ type: 'postback', title: 'Go', payload: 'go' }], quickReplies: [{ title: 'A' }] });
  assert.ok(bothFlow[0].buttons && !bothFlow[0].quick_replies, 'buttons take precedence (Meta mutual exclusivity)');
  ok('chips ride the DM-keyword reply; buttons win when both are set');

  // The cold private-reply opener never carries chips (Requests folder eats them).
  const openerFlow = buildFlowDefinition({ dmMessage: 'DM', quickReplies: [{ title: 'A' }] });
  assert.ok(!openerFlow[openerFlow.length - 1].quick_replies, 'no chips on the cold opener');
  ok('cold opener never carries chips');

  // Chips are native-only — never sent to Zernio's hosted automation; postback
  // buttons DO pass through.
  const zb = toZernioBody({ zernio_account_id: ZACC, dm_message: 'Hi', buttons: [{ type: 'postback', title: 'Go', payload: 'go' }] });
  assert.ok(!('quickReplies' in zb) && !('quick_replies' in zb), 'chips are never sent to Zernio');
  assert.equal(zb.buttons?.[0]?.type, 'postback', 'postback buttons pass through to the hosted automation');
  ok('toZernioBody forwards postback buttons, never chips');

  // Tap routing: a postback tap carries NO message text — its payload/title must
  // still route to a DM-keyword flow, and be recorded in run context.
  seedFlow({ name: 'Refund kw', keywords: ['refund'], dmMessage: 'Refunds within 30 days 👍', triggerType: 'message' });
  const before = calls.length;
  await ingestFromWebhook(messageEvent({ userId: 'gwen', handle: 'gwen', conversationId: 'conv_gwen', metadata: { postbackPayload: 'refund', postbackTitle: 'Refund' } }));
  assert.equal(calls.length, before + 1, 'the textless postback tap fired exactly one keyword flow');
  assert.equal(lastCall().message, 'Refunds within 30 days 👍', 'the tapped payload routed to the refund automation');
  ok('a textless postback tap routes to a DM-keyword flow by its payload');

  const gwen = store.automation_contacts.find(c => c.platform_user_id === 'gwen');
  const gwenRun = store.automation_runs.find(r => r.contact_id === gwen.id);
  assert.equal(gwenRun.context?.last_tap?.payload, 'refund', 'the tap is captured in run context (last_tap)');
  assert.equal(gwenRun.context?.last_tap?.kind, 'postback', 'the tap kind is recorded');
  ok('the tap is captured in run context for downstream steps');
}

// ─────────────────────────────────────────────────────────────────────────────
try {
  await testDelay();
  await testFollowGate();
  await testIdempotency();
  await testButtons();
  await testZernioBodyButtons();
  await testMessageTrigger();
  await testInteractiveReplies();
  console.log(`\n✅ All ${passed} assertions passed — P1 delay + P2 follow-gate execute correctly end-to-end.\n`);
  process.exit(0);
} catch (e) {
  console.error('\n❌ TEST FAILED:', e.message);
  console.error(e.stack);
  console.error('\nOutbound calls so far:', JSON.stringify(calls, null, 2));
  process.exit(1);
}
