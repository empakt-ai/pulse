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
      await api('/engage/reply', { method: 'POST', body: JSON.stringify({ inbox_event_id: item.id, message: msg }) });
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

const ConversationsScreen = () => {
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
  const a = data?.analytics || { total: 0, by_group: {}, last_7d: [] };
  const shown = filter === 'all' ? items : items.filter(i => i.group === filter);
  const series = a.last_7d || [];
  const maxBar = Math.max(1, ...series);

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
        <StatTile label="Total" value={formatNum(a.total || 0)} />
        <StatTile label="DMs" value={formatNum(a.by_group?.dm || 0)} />
        <StatTile label="Comments" value={formatNum(a.by_group?.comment || 0)} />
        <StatTile label="Reviews" value={formatNum(a.by_group?.review || 0)} />
      </div>

      {series.length > 0 && (
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

      {shown.length === 0 ? (
        <Card className="!p-10 text-center">
          <p className="text-[14px] text-mute dark:text-muteDark">No conversations yet. As people DM, comment and review, they'll appear here.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {shown.map(it => (
            <Card key={it.id} className="!py-3.5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-line dark:bg-lineDark flex items-center justify-center flex-shrink-0">
                  <Icon name="message" className="w-4 h-4 text-mute dark:text-muteDark" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[13px] font-medium truncate">{it.author || 'Someone'}</span>
                    <span className="text-[11px] text-mute dark:text-muteDark">{it.platform_label}</span>
                    <span className="text-[10px] font-mono uppercase tracking-wide text-mute dark:text-muteDark px-1.5 py-0.5 rounded bg-ink/[0.06] dark:bg-paper/[0.08]">{it.group}</span>
                    <span className="text-[11px] text-mute dark:text-muteDark ml-auto flex-shrink-0">{timeAgo(it.received_at)}</span>
                  </div>
                  <p className="text-[13px] text-mute dark:text-muteDark line-clamp-2">{it.body || <span className="italic opacity-70">(no text)</span>}</p>
                  <ReplyBox item={it} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-[11px] text-mute dark:text-muteDark text-center mt-6">Reply to comments right here. Replying to DMs is coming soon.</p>

      </>)}
    </div>
  );
};

Object.assign(window, { Conversations: { Panel: ConversationsScreen } });
