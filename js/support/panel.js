// ═════════════════════════════════════════════════════════════════════════
// Mashal Support Panel — Settings → Suggestions / Bugs / Questions.
//
// Available to every authenticated user regardless of tier or role.
// Submits to POST /api/support (which emails the founder) and lists
// the caller's own tickets newest-first with status badges + any
// founder note that was attached to a status change. Refreshes on
// window focus so accepted/resolved updates land without reloading.
//
// Loaded as <script type="text/babel" src="js/support/panel.js"></script>.
// Depends on api() from js/core/api.js and global Btn/Card/cls/Icon/
// Eyebrow defined inline in index.html.
// ═════════════════════════════════════════════════════════════════════════

const TYPE_META = {
  bug:        { label: 'Bug',        icon: 'warning', placeholder: 'What broke? Steps to reproduce, what you expected, what actually happened.' },
  suggestion: { label: 'Suggestion', icon: 'sparkle', placeholder: 'What would help? Describe the workflow or feature — the more specific the better.' },
  question:   { label: 'Question',   icon: 'message', placeholder: "What's unclear or missing? We'll write back as soon as we look at it." },
};

const STATUS_META = {
  open:        { label: 'Open',        cls: 'bg-paper/40 dark:bg-ink/40 text-mute dark:text-muteDark' },
  in_review:   { label: 'In review',   cls: 'bg-amber/15 text-amber' },
  accepted:    { label: 'Accepted',    cls: 'bg-ultra/15 text-ultra dark:text-ultra' },
  in_progress: { label: 'In progress', cls: 'bg-ultra/15 text-ultra dark:text-ultra' },
  resolved:    { label: 'Resolved',    cls: 'bg-lime/20 text-limeDeep dark:text-lime' },
  declined:    { label: 'Declined',    cls: 'bg-magenta/15 text-magenta' },
};

const SupportPanel = () => {
  const [tickets, setTickets] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [form, setForm]       = React.useState({ type: 'suggestion', subject: '', body: '' });
  const [submitting, setSubmitting] = React.useState(false);
  const [feedback, setFeedback]     = React.useState(null);

  const fetchTickets = React.useCallback(async () => {
    try {
      const r = await api('/support');
      setTickets(r?.tickets || []);
    } catch (e) {
      // Silent — the panel is non-critical; if /api/support is unreachable
      // the form still renders so the user can try submitting.
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchTickets();
    const onFocus = () => fetchTickets();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchTickets]);

  const submit = async (e) => {
    e?.preventDefault?.();
    const subject = form.subject.trim();
    const bodyText = form.body.trim();
    if (!subject) { setFeedback({ type: 'err', msg: 'Add a short subject line.' }); return; }
    if (!bodyText) { setFeedback({ type: 'err', msg: 'Tell us a bit more in the body.' }); return; }
    setSubmitting(true);
    setFeedback(null);
    try {
      const r = await api('/support', {
        method: 'POST',
        body: JSON.stringify({ type: form.type, subject, body: bodyText }),
      });
      setForm({ type: form.type, subject: '', body: '' });
      setFeedback({
        type: r.email_status === 'sent' ? 'ok' : 'warn',
        msg:  r.email_status === 'sent'
          ? "Thanks — we've got it. You'll hear back as soon as it's looked at."
          : "Saved, but the founder notification email didn't go through. We'll still see it in the queue.",
      });
      fetchTickets();
    } catch (e) {
      setFeedback({ type: 'err', msg: e.message || 'Submit failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  const meta = TYPE_META[form.type] || TYPE_META.suggestion;

  return (
    <div id="settings-support" className="rounded-2xl border border-line dark:border-lineDark bg-chalk dark:bg-coalsoft p-5" style={{ scrollMarginTop: '80px' }}>
      <Eyebrow color="text-ultra dark:text-lime">Suggestions &amp; bugs</Eyebrow>
      <h3 className="font-display text-[18px] font-semibold tracking-tightest mt-1.5 mb-1">
        Talk to the team.
      </h3>
      <p className="text-[12.5px] text-mute dark:text-muteDark leading-relaxed mb-4">
        Bug, feature suggestion, or a question — anything in here goes straight to the founder's inbox and gets reviewed daily. You'll get an email back when something changes on your ticket.
      </p>

      <form onSubmit={submit} className="space-y-2.5">
        <select
          value={form.type}
          onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
          className="w-full h-10 px-3 rounded-xl border border-line dark:border-lineDark bg-paper dark:bg-ink text-[13px] focus:outline-none focus:border-ultra transition"
        >
          <option value="suggestion">Suggestion</option>
          <option value="bug">Bug</option>
          <option value="question">Question</option>
        </select>
        <input
          type="text"
          value={form.subject}
          maxLength={140}
          onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
          placeholder="One-line summary"
          className="w-full h-10 px-3 rounded-xl border border-line dark:border-lineDark bg-paper dark:bg-ink text-[13.5px] focus:outline-none focus:border-ultra transition"
        />
        <textarea
          value={form.body}
          maxLength={5000}
          onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
          placeholder={meta.placeholder}
          rows={4}
          className="w-full px-3 py-2.5 rounded-xl border border-line dark:border-lineDark bg-paper dark:bg-ink text-[13.5px] leading-relaxed focus:outline-none focus:border-ultra transition resize-y"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-mute dark:text-muteDark font-mono">{form.body.length} / 5000</span>
          <Btn variant="ink" type="submit" disabled={submitting || !form.subject.trim() || !form.body.trim()}>
            {submitting ? 'Sending…' : 'Send'}
          </Btn>
        </div>
        {feedback && (
          <div className={cls(
            'text-[12.5px] rounded-xl p-3 border mt-1',
            feedback.type === 'ok'   && 'bg-lime/15 border-lime/40 text-limeDeep dark:text-lime',
            feedback.type === 'warn' && 'bg-amber/15 border-amber/40 text-amber',
            feedback.type === 'err'  && 'bg-magenta/15 border-magenta/40 text-magenta',
          )}>
            {feedback.msg}
          </div>
        )}
      </form>

      {!loading && tickets.length > 0 && (
        <div className="mt-5 pt-4 border-t border-line dark:border-lineDark">
          <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-mute dark:text-muteDark mb-2">
            Your tickets ({tickets.length})
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {tickets.map(t => {
              const status = STATUS_META[t.status] || STATUS_META.open;
              const typeLabel = TYPE_META[t.type]?.label || t.type;
              return (
                <div key={t.id} className="py-2.5 px-3 rounded-xl bg-paper dark:bg-ink border border-line dark:border-lineDark">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium truncate">{t.subject}</div>
                      <div className="text-[10.5px] font-mono uppercase tracking-[0.1em] text-mute dark:text-muteDark mt-0.5">
                        {typeLabel} · {new Date(t.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </div>
                    </div>
                    <span className={cls('inline-flex items-center px-2 h-5 rounded-full text-[10px] font-mono uppercase tracking-[0.12em] flex-shrink-0', status.cls)}>
                      {status.label}
                    </span>
                  </div>
                  {t.founder_note && (
                    <div className="mt-2 text-[12px] leading-relaxed text-mute dark:text-muteDark border-l-2 border-ultra/40 pl-2.5">
                      {t.founder_note}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

Object.assign(window, {
  Support: Object.assign(window.Support || {}, { Panel: SupportPanel }),
});
