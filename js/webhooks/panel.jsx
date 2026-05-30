import React from 'react';

// Snapshot the shared symbols this file references off window.
// They are published there by src/spa/utilities.jsx and the js/core/*
// modules; src/spa/main.jsx guarantees the load order.
const {
  cls,
  safeHref,
  Card,
  Btn,
  Eyebrow,
  Plat,
  Sparkline,
  BarSpark,
  Pill,
  MashalDot,
  Progress,
  StatCard,
  SectionHead,
  MashalLogo,
  PlatformIcons,
  Icon,
  D,
  formatNum,
  platformLabel,
  platformBrand,
  initialsOf,
  formatSync,
  hydrateD,
  api,
  API_BASE,
  sbAuth,
  SUPABASE_URL,
  SUPABASE_ANON,
  restoreSession,
  checkMagicLinkHash,
  SubscriptionBanner,
  UpgradeDialog,
} = window;


// ═════════════════════════════════════════════════════════════════════════
// Mashal Webhooks Panel — Settings → Webhooks.
//
// Lets a workspace owner / admin register up to 5 outbound webhook URLs
// that receive a POST when Mashal fires an event (brief generated,
// weekly digest sent, signal detected). Designed for Slack incoming
// webhooks, Microsoft Teams connectors, Zapier catches, or any custom
// receiver that can verify the X-Mashal-Signature HMAC header.
//
// The secret used to sign payloads is shown ONCE on create (so the user
// can copy it into their receiver's verification). It never appears in
// subsequent GETs — only a preview prefix/suffix. Losing it means
// deleting and re-creating the webhook.
//
// Loaded as <script type="text/babel" src="js/webhooks/panel.js">.
// Depends on api() from js/core/api.js and global Btn/Card/cls/Icon/
// Eyebrow defined inline in index.html.
// ═════════════════════════════════════════════════════════════════════════

const EVENT_LABELS = {
  brief_generated:    'Brief generated',
  weekly_digest_sent: 'Weekly digest sent',
  signal_detected:    'Signal detected',
};

const STATUS_CLS = {
  success:        'bg-lime/20 text-limeDeep dark:text-lime',
  timeout:        'bg-amber/15 text-amber',
  network_error:  'bg-amber/15 text-amber',
};
function statusBadgeClass(status) {
  if (!status) return 'bg-paper/40 dark:bg-ink/40 text-mute dark:text-muteDark';
  if (STATUS_CLS[status]) return STATUS_CLS[status];
  if (status.startsWith('http_')) return 'bg-magenta/15 text-magenta';
  return 'bg-paper/40 dark:bg-ink/40 text-mute dark:text-muteDark';
}

const WebhooksPanel = () => {
  const [webhooks, setWebhooks] = React.useState([]);
  const [allowedEvents, setAllowedEvents] = React.useState([]);
  const [maxPerWorkspace, setMaxPerWorkspace] = React.useState(5);
  const [loading, setLoading] = React.useState(true);
  const [form, setForm] = React.useState({
    url: '',
    label: '',
    events: ['brief_generated'],
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [feedback, setFeedback] = React.useState(null);
  const [revealedSecret, setRevealedSecret] = React.useState(null);

  const fetchAll = React.useCallback(async () => {
    try {
      const r = await api('/workspace/webhooks');
      setWebhooks(r?.webhooks || []);
      setAllowedEvents(r?.allowed_events || []);
      setMaxPerWorkspace(r?.max_per_workspace || 5);
    } catch (e) {
      // Non-fatal — the form still renders so the user can submit even
      // if the listing fails (e.g., transient DB hiccup).
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { fetchAll(); }, [fetchAll]);

  const toggleEvent = (ev) => {
    setForm(f => ({
      ...f,
      events: f.events.includes(ev)
        ? f.events.filter(e => e !== ev)
        : [...f.events, ev],
    }));
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    const url = form.url.trim();
    if (!/^https:\/\/|^http:\/\/localhost/i.test(url)) {
      setFeedback({ type: 'err', msg: 'URL must start with https:// (or http://localhost for testing).' });
      return;
    }
    if (webhooks.length >= maxPerWorkspace) {
      setFeedback({ type: 'err', msg: `You're at the ${maxPerWorkspace}-webhook limit. Remove one first.` });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const r = await api('/workspace/webhooks', {
        method: 'POST',
        body: { url, label: form.label || null, events: form.events },
      });
      if (r?.error) {
        setFeedback({ type: 'err', msg: r.error });
      } else if (r?.webhook) {
        setRevealedSecret({ id: r.webhook.id, secret: r.webhook.secret });
        setWebhooks(ws => [r.webhook, ...ws]);
        setForm({ url: '', label: '', events: ['brief_generated'] });
        setFeedback({ type: 'ok', msg: 'Webhook created. Copy the signing secret below — we will not show it again.' });
      }
    } catch (err) {
      setFeedback({ type: 'err', msg: err?.message || 'Failed to create webhook.' });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (w) => {
    const next = !w.is_active;
    setWebhooks(ws => ws.map(x => x.id === w.id ? { ...x, is_active: next } : x));
    try {
      await api(`/workspace/webhooks?id=${encodeURIComponent(w.id)}`, {
        method: 'PUT',
        body: { is_active: next },
      });
    } catch (_) {
      // Revert on failure
      setWebhooks(ws => ws.map(x => x.id === w.id ? { ...x, is_active: !next } : x));
    }
  };

  const remove = async (w) => {
    if (!confirm(`Remove the webhook for ${w.url}?`)) return;
    const before = webhooks;
    setWebhooks(ws => ws.filter(x => x.id !== w.id));
    try {
      await api(`/workspace/webhooks?id=${encodeURIComponent(w.id)}`, { method: 'DELETE' });
    } catch (_) {
      setWebhooks(before);
    }
  };

  const sendTest = async (w) => {
    setFeedback({ type: 'ok', msg: `Sending a test delivery to ${w.url}...` });
    try {
      const r = await api(`/workspace/webhooks?action=test&id=${encodeURIComponent(w.id)}`, { method: 'POST' });
      if (r?.results) {
        setFeedback({ type: 'ok', msg: `Test delivery fired. Check ${w.label || w.url} for receipt.` });
        // Refresh to pick up the updated last_delivery_at / last_status.
        fetchAll();
      }
    } catch (err) {
      setFeedback({ type: 'err', msg: 'Test delivery failed. Check the URL is reachable.' });
    }
  };

  if (loading) {
    return (
      <Card className="!p-5">
        <Eyebrow color="text-ultra">Webhooks</Eyebrow>
        <div className="font-display text-[17px] font-semibold tracking-tight mt-1.5 mb-3">Outbound webhooks</div>
        <div className="text-[12.5px] text-mute dark:text-muteDark">Loading…</div>
      </Card>
    );
  }

  return (
    <Card className="!p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div>
          <Eyebrow color="text-ultra">Webhooks</Eyebrow>
          <div className="font-display text-[17px] font-semibold tracking-tight mt-1.5">Outbound webhooks</div>
        </div>
        <span className="text-[10.5px] font-mono text-mute dark:text-muteDark uppercase tracking-[0.12em]">
          {webhooks.length} / {maxPerWorkspace}
        </span>
      </div>
      <p className="text-[12.5px] text-mute dark:text-muteDark leading-relaxed mb-4 max-w-prose">
        Send Mashal events to Slack, Microsoft Teams, Zapier, or any HTTPS endpoint that can verify an HMAC-SHA256 signature. Each delivery is a JSON POST with an X-Mashal-Signature header computed from the per-webhook secret.
      </p>

      {/* Existing webhooks list */}
      {webhooks.length > 0 && (
        <div className="space-y-2.5 mb-5">
          {webhooks.map(w => {
            const showSecret = revealedSecret?.id === w.id;
            return (
              <div key={w.id} className="rounded-xl border border-line dark:border-lineDark p-3.5">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                  <div className="min-w-0">
                    <div className="font-mono text-[12.5px] truncate" title={w.url}>{w.url}</div>
                    {w.label && <div className="text-[12px] text-mute dark:text-muteDark mt-0.5">{w.label}</div>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={cls('text-[10.5px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 rounded', statusBadgeClass(w.last_status))}>
                      {w.last_status || 'never sent'}
                    </span>
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-mute dark:text-muteDark cursor-pointer">
                      <input type="checkbox" checked={!!w.is_active} onChange={() => toggleActive(w)} className="accent-ultra" />
                      Active
                    </label>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap text-[10.5px] font-mono text-mute dark:text-muteDark mb-2">
                  {(w.events || []).length === 0 ? (
                    <span>All events</span>
                  ) : (
                    (w.events || []).map(e => (
                      <span key={e} className="px-1.5 py-0.5 rounded bg-chalk dark:bg-coalsoft">{EVENT_LABELS[e] || e}</span>
                    ))
                  )}
                  {w.last_delivery_at && (
                    <span className="ml-auto">last fired {new Date(w.last_delivery_at).toLocaleString()}</span>
                  )}
                </div>
                {showSecret && (
                  <div className="rounded-lg bg-ultra/10 border border-ultra/30 p-2.5 mb-2">
                    <div className="text-[10.5px] font-mono uppercase tracking-[0.12em] text-ultra mb-1">Signing secret — copy now, we won't show it again</div>
                    <code className="block text-[11.5px] break-all">{revealedSecret.secret}</code>
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <Btn variant="ghost" size="sm" onClick={() => sendTest(w)}>Send test</Btn>
                  <Btn variant="ghost" size="sm" onClick={() => remove(w)}>Remove</Btn>
                  {w.secret_preview && !showSecret && (
                    <span className="text-[10.5px] font-mono text-mute dark:text-muteDark ml-auto">
                      secret: {w.secret_preview}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add form — hidden once the cap is reached */}
      {webhooks.length < maxPerWorkspace && (
        <form onSubmit={submit} className="rounded-xl bg-chalk dark:bg-coalsoft p-3.5">
          <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-mute dark:text-muteDark mb-2">Add a new webhook</div>
          <div className="space-y-2.5">
            <input
              type="url"
              required
              placeholder="https://hooks.slack.com/services/T000/B000/xxxx"
              value={form.url}
              onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
              className="w-full px-3 py-2 text-[13px] font-mono rounded-lg border border-line dark:border-lineDark bg-paper dark:bg-ink"
            />
            <input
              type="text"
              placeholder="Label (optional, e.g. #content-team Slack)"
              value={form.label}
              onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              className="w-full px-3 py-2 text-[13px] rounded-lg border border-line dark:border-lineDark bg-paper dark:bg-ink"
            />
            <div>
              <div className="text-[11px] font-mono text-mute dark:text-muteDark uppercase tracking-[0.12em] mb-1.5">Events</div>
              <div className="flex flex-wrap gap-2">
                {(allowedEvents.length ? allowedEvents : Object.keys(EVENT_LABELS)).map(ev => (
                  <label key={ev} className="inline-flex items-center gap-1.5 text-[12px] cursor-pointer px-2.5 py-1 rounded-lg border border-line dark:border-lineDark hover:bg-paper dark:hover:bg-ink">
                    <input
                      type="checkbox"
                      checked={form.events.includes(ev)}
                      onChange={() => toggleEvent(ev)}
                      className="accent-ultra"
                    />
                    {EVENT_LABELS[ev] || ev}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Btn variant="ink" size="sm" type="submit" disabled={submitting}>
                {submitting ? 'Creating…' : 'Add webhook'}
              </Btn>
              {feedback && (
                <span className={cls('text-[12px]', feedback.type === 'err' ? 'text-magenta' : 'text-ultra')}>
                  {feedback.msg}
                </span>
              )}
            </div>
          </div>
        </form>
      )}

      <p className="text-[11.5px] text-mute dark:text-muteDark mt-4 leading-relaxed">
        Receivers should compute HMAC-SHA256(rawBody, secret) and compare against the <code>X-Mashal-Signature</code> header. The signature format is <code>sha256=&lt;hex&gt;</code>. Empty events array means "subscribe to all".
      </p>
    </Card>
  );
};

Object.assign(window, {
  Webhooks: Object.assign(window.Webhooks || {}, { Panel: WebhooksPanel }),
});
