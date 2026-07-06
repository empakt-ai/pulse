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

const ConversationsScreen = () => {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [locked, setLocked] = React.useState(false);
  const [filter, setFilter] = React.useState('all');

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
        <Eyebrow color="text-ultra">Brand &amp; Agency feature</Eyebrow>
        <h1 className="font-display text-[28px] sm:text-[34px] font-semibold tracking-tightest mt-2 mb-3">Your inbox, in one place.</h1>
        <p className="text-[14.5px] text-mute dark:text-muteDark max-w-md mx-auto mb-7">
          DMs, comments and reviews across Instagram, Facebook, Telegram, WhatsApp and Google Business — with volume and response analytics. Read-only.
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
      <div className="mb-5">
        <h1 className="font-display text-[24px] sm:text-[28px] font-semibold tracking-tightest">Conversations</h1>
        <p className="text-[13.5px] text-mute dark:text-muteDark mt-1">Incoming DMs, comments and reviews across your connected accounts.</p>
      </div>

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
                    <span className="text-[10px] font-mono uppercase tracking-wide text-mute dark:text-muteDark px-1.5 py-0.5 rounded bg-line/60 dark:bg-lineDark/60">{it.group}</span>
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
    </div>
  );
};

Object.assign(window, { Conversations: { Panel: ConversationsScreen } });
