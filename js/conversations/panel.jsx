import React from 'react';

// ─────────────────────────────────────────────────────────────────────────
// Mashal — Conversations (read-only, Phase 1). Shows incoming DMs / comments /
// reviews from inbox_events + lightweight messaging analytics. No replies yet.
// Self-contained window-bridge module: published as window.Conversations.Panel,
// mounted by screens.jsx via window.Conversations?.Panel. Fetches its own data
// from /api/conversations (does not ride the /api/brief payload).
// ─────────────────────────────────────────────────────────────────────────

const { cls, Card, Btn, Icon, Eyebrow, api, formatNum } = window;

const GROUPS = [
  { id: 'all', label: 'All' },
  { id: 'dm', label: 'DMs' },
  { id: 'comment', label: 'Comments' },
  { id: 'review', label: 'Reviews' },
];

function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

const StatTile = ({ label, value }) => (
  <div className="rounded-xl border border-line dark:border-lineDark px-4 py-3">
    <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-mute dark:text-muteDark">{label}</div>
    <div className="font-display text-[22px] font-semibold mt-1">{value}</div>
  </div>
);

// Media a follower attached to a DM/comment (shared reel, story mention, image).
// Image-ish types render an inline thumbnail (with a graceful fall-back to a
// labelled link if the — often expiring — CDN url won't load); everything else
// renders as a clickable chip.
const MEDIA_LABELS = {
  ig_reel: 'Shared reel', video: 'Shared video', share: 'Shared post',
  story_mention: 'Story mention', image: 'Photo', photo: 'Photo',
  audio: 'Voice message', file: 'Attachment',
};

const MediaAtt = ({ m }) => {
  const [broken, setBroken] = React.useState(false);
  const label = m.title || MEDIA_LABELS[m.type] || 'Attachment';
  const isImg = /image|photo|story/.test(m.type) && !broken;
  if (isImg) {
    return (
      <a href={m.url} target="_blank" rel="noreferrer" className="block">
        <img src={m.url} onError={() => setBroken(true)} alt={label}
          className="max-h-40 max-w-full rounded-lg border border-line dark:border-lineDark object-cover" />
      </a>
    );
  }
  return (
    <a href={m.url} target="_blank" rel="noreferrer" title={label}
      className="inline-flex items-center gap-1.5 max-w-[240px] text-[12px] text-ultra hover:underline px-2 py-1 rounded-lg bg-ultra/5 border border-ultra/20">
      <span aria-hidden>📎</span><span className="truncate">{label}</span>
    </a>
  );
};

const MediaRow = ({ media }) => (!media || !media.length) ? null : (
  <div className="flex flex-wrap gap-1.5 mt-1.5">
    {media.map((m, i) => <MediaAtt key={i} m={m} />)}
  </div>
);

// Mashal's global top-bar account selector uses short platform keys; map them
// to the inbox item's full platform name so Conversations scopes to the same
// account the rest of the app is showing (one account per platform).
const PLAT_KEY = {
  ig: 'instagram', tt: 'tiktok', yt: 'youtube', li: 'linkedin',
  fb: 'facebook', x: 'x', sc: 'snapchat', gb: 'google_business',
};

// Inline reply composer for a comment card. Comments can be replied to via
// Zernio (POST /api/engage/reply); DMs stay read-only for now. Our own sent
// replies come back as kind 'comment_reply_sent' and render as a quiet label
// rather than another reply box.
const ReplyBox = ({ item }) => {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [err, setErr] = React.useState(null);

  if (item.group !== 'comment') return null;
  if (item.kind === 'comment_reply_sent') {
    return <div className="mt-1.5 text-[11px] text-mute dark:text-muteDark">↩ Sent from Mashal</div>;
  }
  if (sent) {
    return <div className="mt-2 text-[12px] font-medium text-limeDeep">✓ Reply sent</div>;
  }

  const send = async () => {
    const msg = text.trim();
    if (!msg || sending) return;
    setSending(true); setErr(null);
    try {
      const target = item.external ? { comment: item.reply_ctx } : { inbox_event_id: item.id };
      await api('/engage/reply', { method: 'POST', body: JSON.stringify({ ...target, message: msg }) });
      setSent(true); setText('');
    } catch (e) {
      setErr(e?.message || 'Reply failed');
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="mt-2 text-[12px] font-medium text-ultra hover:underline">Reply</button>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
        placeholder={`Reply to ${item.author || 'this comment'}…`}
        className="w-full rounded-lg border border-line dark:border-lineDark bg-transparent px-3 py-2 text-[13px] resize-y focus:outline-none focus:ring-1 focus:ring-ultra" />
      {err && <div className="text-[12px] text-magenta">{err}</div>}
      <div className="flex items-center gap-2">
        <Btn variant="ink" onClick={send} disabled={sending || !text.trim()}>
          {sending ? 'Sending…' : 'Send reply'}
        </Btn>
        <button onClick={() => { setOpen(false); setErr(null); }}
          className="text-[12px] text-mute dark:text-muteDark hover:text-ink dark:hover:text-paper">Cancel</button>
      </div>
    </div>
  );
};

// ─── Comment→DM automations (Step 2b) ─────────────────────────────────────
// Mashal owns the rule; Zernio executes it. When someone comments a keyword on
// an IG/FB post, Zernio auto-sends the DM (+ optional public reply). CRUD via
// /api/engage/automations; the GET also returns eligible IG/FB accounts.
const MATCH_LABEL = { contains: 'contains', exact: 'exact match' };
const FIELD_CLS = 'w-full rounded-lg border border-line dark:border-lineDark bg-transparent px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-ultra';

const AutomationForm = ({ accounts, initial, onSave, onCancel, saving, error }) => {
  const editing = !!(initial && initial.id);
  const [name, setName] = React.useState(initial?.name || '');
  const [accountId, setAccountId] = React.useState(initial?.account_id || accounts[0]?.id || '');
  const [keywords, setKeywords] = React.useState((initial?.keywords || []).join(', '));
  const [matchMode, setMatchMode] = React.useState(initial?.match_mode || 'contains');
  const [dmMessage, setDmMessage] = React.useState(initial?.dm_message || '');
  const [commentReply, setCommentReply] = React.useState(initial?.comment_reply || '');

  const kwList = keywords.split(',').map(s => s.trim()).filter(Boolean);
  const valid = name.trim() && dmMessage.trim() && kwList.length && (editing || accountId);

  const submit = () => {
    if (!valid) return;
    const payload = {
      name: name.trim(),
      keywords: kwList,
      match_mode: matchMode,
      dm_message: dmMessage.trim(),
      comment_reply: commentReply.trim() || null,
    };
    if (!editing) payload.account_id = accountId;
    onSave(payload, editing ? initial.id : null);
  };

  return (
    <Card className="!p-4 space-y-3">
      <div className="text-[13px] font-semibold">{editing ? 'Edit automation' : 'New comment→DM automation'}</div>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (e.g. Link in bio)" className={FIELD_CLS} />
      {!editing && (
        <select value={accountId} onChange={e => setAccountId(e.target.value)} className={FIELD_CLS}>
          {accounts.map(ac => <option key={ac.id} value={ac.id}>{ac.platform} · @{ac.username}</option>)}
        </select>
      )}
      <div>
        <input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="Keywords, comma-separated (e.g. link, price, guide)" className={FIELD_CLS} />
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-mute dark:text-muteDark">
          <span>Trigger when the comment</span>
          {['contains', 'exact'].map(m => (
            <button key={m} onClick={() => setMatchMode(m)}
              className={cls('px-2 py-0.5 rounded', matchMode === m ? 'bg-ultra/15 text-ultra font-medium' : 'hover:text-ink dark:hover:text-paper')}>
              {MATCH_LABEL[m]}
            </button>
          ))}
          <span>a keyword</span>
        </div>
      </div>
      <textarea value={dmMessage} onChange={e => setDmMessage(e.target.value)} rows={3}
        placeholder="DM to auto-send (e.g. Here's the link you asked for 👉 …)" className={FIELD_CLS + ' resize-y'} />
      <textarea value={commentReply} onChange={e => setCommentReply(e.target.value)} rows={2}
        placeholder="Optional public reply to the comment (leave blank for none)" className={FIELD_CLS + ' resize-y'} />
      {error && <div className="text-[12px] text-magenta">{error}</div>}
      <div className="flex items-center gap-2">
        <Btn variant="ink" onClick={submit} disabled={saving || !valid}>
          {saving ? 'Saving…' : (editing ? 'Save changes' : 'Create automation')}
        </Btn>
        <button onClick={onCancel} className="text-[12px] text-mute dark:text-muteDark hover:text-ink dark:hover:text-paper">Cancel</button>
      </div>
    </Card>
  );
};

const AutomationCard = ({ a, busy, onToggle, onEdit, onDelete }) => (
  <Card className="!py-3.5">
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-[13px] font-medium truncate">{a.name}</span>
          <span className="text-[11px] text-mute dark:text-muteDark capitalize">{a.platform}</span>
          {!a.is_active && <span className="text-[10px] font-mono uppercase tracking-wide text-mute dark:text-muteDark px-1.5 py-0.5 rounded bg-ink/[0.06] dark:bg-paper/[0.08]">paused</span>}
          {a.last_sync_error && <span className="text-[10px] text-magenta" title={a.last_sync_error}>⚠ sync error</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1 mb-1.5">
          {(a.keywords || []).map((k, i) => <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-ultra/10 text-ultra">{k}</span>)}
          <span className="text-[11px] text-mute dark:text-muteDark">· {MATCH_LABEL[a.match_mode] || a.match_mode}</span>
        </div>
        <p className="text-[12.5px] text-mute dark:text-muteDark line-clamp-2"><span className="opacity-70">DM:</span> {a.dm_message}</p>
        <div className="mt-2 flex items-center gap-4 text-[11px] text-mute dark:text-muteDark">
          <span>Triggered {formatNum(a.stats?.triggered ?? 0)}</span>
          <span>DMs sent {formatNum(a.stats?.dms_sent ?? 0)}</span>
          <span>Contacts {formatNum(a.stats?.unique_contacts ?? 0)}</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
        <button onClick={() => onToggle(a)} disabled={busy} className="text-[11px] font-medium text-ultra hover:underline disabled:opacity-50">{a.is_active ? 'Pause' : 'Resume'}</button>
        <button onClick={() => onEdit(a)} className="text-[11px] text-mute dark:text-muteDark hover:text-ink dark:hover:text-paper">Edit</button>
        <button onClick={() => onDelete(a)} disabled={busy} className="text-[11px] text-magenta hover:underline disabled:opacity-50">Delete</button>
      </div>
    </div>
  </Card>
);

const AutomationsView = () => {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [editing, setEditing] = React.useState(null);   // null=closed | {}=new | {id,…}=edit
  const [saving, setSaving] = React.useState(false);
  const [formErr, setFormErr] = React.useState(null);
  const [busyId, setBusyId] = React.useState(null);

  const load = React.useCallback(async () => {
    try { setData(await api('/engage/automations?refresh=1')); setErr(null); }
    catch (e) { setErr(e?.message || 'Failed to load automations'); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const automations = data?.automations || [];
  const accounts = data?.accounts || [];

  const save = async (payload, id) => {
    setSaving(true); setFormErr(null);
    try {
      if (id) await api(`/engage/automations?id=${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/engage/automations', { method: 'POST', body: JSON.stringify(payload) });
      setEditing(null);
      await load();
    } catch (e) { setFormErr(e?.message || 'Save failed'); }
    finally { setSaving(false); }
  };
  const toggle = async (a) => {
    setBusyId(a.id);
    try { await api(`/engage/automations?id=${encodeURIComponent(a.id)}`, { method: 'PATCH', body: JSON.stringify({ is_active: !a.is_active }) }); await load(); }
    catch (e) { setErr(e?.message || 'Update failed'); }
    finally { setBusyId(null); }
  };
  const del = async (a) => {
    if (!window.confirm(`Delete automation “${a.name}”? This removes it from Zernio too.`)) return;
    setBusyId(a.id);
    try { await api(`/engage/automations?id=${encodeURIComponent(a.id)}`, { method: 'DELETE' }); await load(); }
    catch (e) { setErr(e?.message || 'Delete failed'); }
    finally { setBusyId(null); }
  };

  if (loading) return <div className="py-10 text-center text-[13px] text-mute dark:text-muteDark">Loading automations…</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12.5px] text-mute dark:text-muteDark max-w-xl">
          When someone comments a keyword on your Instagram or Facebook post, Zernio instantly sends them a DM with your message — and can post a public reply too.
        </p>
        {accounts.length > 0 && !editing && (
          <Btn variant="ink" onClick={() => { setFormErr(null); setEditing({}); }}>New automation</Btn>
        )}
      </div>

      {err && <div className="text-[12px] text-magenta">{err}</div>}

      {accounts.length === 0 && (
        <Card className="!p-6 text-center">
          <p className="text-[13px] text-mute dark:text-muteDark">Connect an Instagram or Facebook account to create comment→DM automations.</p>
        </Card>
      )}

      {editing && (
        <AutomationForm accounts={accounts} initial={editing.id ? editing : null}
          onSave={save} onCancel={() => setEditing(null)} saving={saving} error={formErr} />
      )}

      {automations.length === 0 && accounts.length > 0 && !editing && (
        <Card className="!p-8 text-center">
          <p className="text-[13px] text-mute dark:text-muteDark">No automations yet. Create one to auto-DM commenters who use your keywords.</p>
        </Card>
      )}

      <div className="space-y-2">
        {automations.map(a => (
          <AutomationCard key={a.id} a={a} busy={busyId === a.id}
            onToggle={toggle} onEdit={(x) => { setFormErr(null); setEditing(x); }} onDelete={del} />
        ))}
      </div>
    </div>
  );
};

// ─── DM thread (Step 3) ───────────────────────────────────────────────────
// A grouped conversation: all messages we've captured for one Zernio
// conversation, oldest→newest, with an inline reply composer. Sending posts to
// /api/engage/dm (which resolves the account + conversation server-side from
// any event in the thread), then reloads so the sent DM appears in the thread.
const DmThread = ({ thread, onSent }) => {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const msgs = thread.messages;                 // oldest → newest
  const last = msgs[msgs.length - 1];
  const anchorId = last?.id;                     // any event resolves the thread server-side

  const send = async () => {
    const m = text.trim();
    if (!m || sending || !anchorId) return;
    setSending(true); setErr(null);
    try {
      await api('/engage/dm', { method: 'POST', body: JSON.stringify({ inbox_event_id: anchorId, message: m }) });
      setText('');
      if (onSent) await onSent();               // reload → the sent DM stitches into this thread
    } catch (e) { setErr(e?.message || 'Send failed'); }
    finally { setSending(false); }
  };

  return (
    <Card className="!py-3.5">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-start gap-3 text-left">
        <div className="w-8 h-8 rounded-full bg-line dark:bg-lineDark flex items-center justify-center flex-shrink-0">
          <Icon name="message" className="w-4 h-4 text-mute dark:text-muteDark" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[13px] font-medium truncate">{thread.participant}</span>
            <span className="text-[11px] text-mute dark:text-muteDark">{thread.platform_label}</span>
            {msgs.length > 1 && <span className="text-[10px] font-mono text-mute dark:text-muteDark px-1.5 py-0.5 rounded bg-ink/[0.06] dark:bg-paper/[0.08]">{msgs.length}</span>}
            <span className="text-[11px] text-mute dark:text-muteDark ml-auto flex-shrink-0">{timeAgo(thread.last_at)}</span>
          </div>
          <p className="text-[13px] text-mute dark:text-muteDark line-clamp-1">
            {last?.direction === 'outgoing' ? 'You: ' : ''}{last?.body || <span className="italic opacity-70">(no text)</span>}
          </p>
        </div>
      </button>

      {open && (
        <div className="mt-3 pl-11 space-y-2">
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {msgs.map(m => (
              <div key={m.id} className={cls('flex', m.direction === 'outgoing' ? 'justify-end' : 'justify-start')}>
                <div className={cls('max-w-[85%] rounded-2xl px-3 py-1.5 text-[13px]',
                  m.direction === 'outgoing'
                    ? 'bg-ink text-paper dark:bg-paper dark:text-ink rounded-br-sm'
                    : 'bg-ink/[0.06] dark:bg-paper/[0.08] rounded-bl-sm')}>
                  {m.body ? m.body : ((m.media && m.media.length) ? null : <span className="italic opacity-70">(no text)</span>)}
                  <MediaRow media={m.media} />
                </div>
              </div>
            ))}
          </div>
          <div className="pt-1 space-y-2">
            <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
              placeholder={`Reply to ${thread.participant}…`}
              className="w-full rounded-lg border border-line dark:border-lineDark bg-transparent px-3 py-2 text-[13px] resize-y focus:outline-none focus:ring-1 focus:ring-ultra" />
            {err && <div className="text-[12px] text-magenta">{err}</div>}
            <div className="flex items-center gap-2">
              <Btn variant="ink" onClick={send} disabled={sending || !text.trim()}>{sending ? 'Sending…' : 'Send DM'}</Btn>
              <span className="text-[11px] text-mute dark:text-muteDark">Sends a direct message via Zernio</span>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};

const ConversationsScreen = ({ activePlatform }) => {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [locked, setLocked] = React.useState(false);
  const [filter, setFilter] = React.useState('all');
  const [view, setView] = React.useState('inbox');   // 'inbox' | 'automations'

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api('/conversations');
        if (alive) { setData(r); setLocked(false); }
      } catch (e) {
        if (alive) setLocked(/unlock|brand|agency|402/i.test(e.message || ''));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Silent refetch after a send, so a newly-sent DM appears in its thread.
  const reload = React.useCallback(async () => {
    try { const r = await api('/conversations'); setData(r); } catch { /* keep current */ }
  }, []);

  if (loading) {
    return <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 text-center text-[13px] text-mute dark:text-muteDark">Loading conversations…</div>;
  }

  if (locked) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16 text-center">
        <Eyebrow color="text-ultra">Pro Creator feature</Eyebrow>
        <h1 className="font-display text-[28px] sm:text-[34px] font-semibold tracking-tightest mt-2 mb-3">Your inbox, in one place.</h1>
        <p className="text-[14.5px] text-mute dark:text-muteDark max-w-md mx-auto mb-7">
          DMs, comments and reviews across Instagram, Facebook, Telegram, WhatsApp and Google Business — reply to comments and automate comment→DM, right from Mashal.
        </p>
        <Btn variant="ink" onClick={() => window.dispatchEvent(new CustomEvent('pulse:openUpgrade'))}>Upgrade workspace</Btn>
      </div>
    );
  }

  const items = data?.items || [];
  // Scope to the globally-selected account (top AccountBar). 'all' → everything.
  const wantPlatform = (activePlatform && activePlatform !== 'all') ? (PLAT_KEY[activePlatform] || activePlatform) : null;
  const byAccount = wantPlatform ? items.filter(i => i.platform === wantPlatform) : items;
  const shown = filter === 'all' ? byAccount : byAccount.filter(i => i.group === filter);

  // Account-aware tiles + 7-day series (recomputed client-side so switching
  // accounts updates the numbers, not just the list).
  const now = Date.now();
  const counts = { total: byAccount.length, dm: 0, comment: 0, review: 0 };
  const last7 = [0, 0, 0, 0, 0, 0, 0];
  for (const i of byAccount) {
    counts[i.group] = (counts[i.group] || 0) + 1;
    const d = Math.floor((now - new Date(i.received_at).getTime()) / 86400000);
    if (d >= 0 && d < 7) last7[d] += 1;
  }
  const series = last7.slice().reverse();
  const maxBar = Math.max(1, ...series);

  // Group DMs into conversation threads; other kinds stay as flat cards. Build
  // a recency-ordered feed where each DM thread appears once, at its latest msg.
  const dmThreads = new Map();
  const feed = [];
  for (const it of shown) {                        // shown is newest-first
    if (it.group === 'dm') {
      const key = it.conversation_id || ('u:' + (it.author || 'unknown'));
      let t = dmThreads.get(key);
      if (!t) {
        t = { key, participant: null, platform: it.platform, platform_label: it.platform_label, messages: [], last_at: it.received_at };
        dmThreads.set(key, t);
        feed.push({ type: 'thread', key });
      }
      t.messages.push(it);
      if (!t.participant && it.author) t.participant = it.author;
    } else {
      feed.push({ type: 'item', it });
    }
  }
  for (const t of dmThreads.values()) {
    t.messages.reverse();                          // oldest → newest for display
    if (!t.participant) t.participant = 'Someone';
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-[24px] sm:text-[28px] font-semibold tracking-tightest">Conversations</h1>
          <p className="text-[13.5px] text-mute dark:text-muteDark mt-1">Incoming DMs, comments and reviews — plus comment→DM automations.</p>
        </div>
        <div className="flex gap-1.5">
          {['inbox', 'automations'].map(v => (
            <button key={v} onClick={() => setView(v)}
              className={cls('h-8 px-3.5 rounded-lg text-[12.5px] font-medium border transition capitalize',
                view === v
                  ? 'bg-ink text-paper border-ink dark:bg-paper dark:text-ink dark:border-paper'
                  : 'border-line dark:border-lineDark text-mute dark:text-muteDark hover:text-ink dark:hover:text-paper')}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === 'automations' ? <AutomationsView /> : (<>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatTile label="Total" value={formatNum(counts.total || 0)} />
        <StatTile label="DMs" value={formatNum(counts.dm || 0)} />
        <StatTile label="Comments" value={formatNum(counts.comment || 0)} />
        <StatTile label="Reviews" value={formatNum(counts.review || 0)} />
      </div>

      {counts.total > 0 && (
        <Card className="mb-5">
          <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-mute dark:text-muteDark mb-3">Last 7 days</div>
          <div className="flex items-end gap-1.5 h-16">
            {series.map((v, i) => (
              <div key={i} className="flex-1 bg-ultra/20 rounded-t" style={{ height: Math.max(4, (v / maxBar) * 100) + '%' }} title={v + ' messages'} />
            ))}
          </div>
        </Card>
      )}

      <div className="flex gap-1.5 mb-4 flex-wrap">
        {GROUPS.map(g => (
          <button key={g.id} onClick={() => setFilter(g.id)}
            className={cls('h-8 px-3.5 rounded-lg text-[12.5px] font-medium border transition',
              filter === g.id
                ? 'bg-ink text-paper border-ink dark:bg-paper dark:text-ink dark:border-paper'
                : 'border-line dark:border-lineDark text-mute dark:text-muteDark hover:text-ink dark:hover:text-paper')}>
            {g.label}
          </button>
        ))}
      </div>

      {feed.length === 0 ? (
        <Card className="!p-10 text-center">
          <p className="text-[14px] text-mute dark:text-muteDark">No conversations yet. As people DM, comment and review, they'll appear here.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {feed.map(f => f.type === 'thread' ? (
            <DmThread key={f.key} thread={dmThreads.get(f.key)} onSent={reload} />
          ) : (
            <Card key={f.it.id} className="!py-3.5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-line dark:bg-lineDark flex items-center justify-center flex-shrink-0">
                  <Icon name="message" className="w-4 h-4 text-mute dark:text-muteDark" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[13px] font-medium truncate">{f.it.author || 'Someone'}</span>
                    <span className="text-[11px] text-mute dark:text-muteDark">{f.it.platform_label}</span>
                    <span className="text-[10px] font-mono uppercase tracking-wide text-mute dark:text-muteDark px-1.5 py-0.5 rounded bg-ink/[0.06] dark:bg-paper/[0.08]">{f.it.group}</span>
                    <span className="text-[11px] text-mute dark:text-muteDark ml-auto flex-shrink-0">{timeAgo(f.it.received_at)}</span>
                  </div>
                  <p className="text-[13px] text-mute dark:text-muteDark line-clamp-2">{f.it.body ? f.it.body : ((f.it.media && f.it.media.length) ? null : <span className="italic opacity-70">(no text)</span>)}</p>
                  <MediaRow media={f.it.media} />
                  <ReplyBox item={f.it} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-[11px] text-mute dark:text-muteDark text-center mt-6">Reply to comments and DMs right from here.</p>

      </>)}
    </div>
  );
};

Object.assign(window, { Conversations: { Panel: ConversationsScreen } });
