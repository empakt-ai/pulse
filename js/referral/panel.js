// ═════════════════════════════════════════════════════════════════════════
// Mashal Referral Panel — Creator-tier only.
//
// Self-contained React component mounted inside SettingsScreen's Plan
// area. Reads GET /api/referral on mount + on window focus so the
// counter stays live without the user reloading the page after a
// successful share.
//
// Renders nothing for Brand/Agency (the API returns 403 — we hide
// instead of showing a paywall, matching the user's UX decision that
// referrals are a Creator-tier feature in v1).
//
// Loaded as <script type="text/babel" src="js/referral/panel.js"></script>.
// Depends on api() from js/core/api.js, plus global Btn / Card / cls /
// Icon / Eyebrow defined inline in index.html.
// ═════════════════════════════════════════════════════════════════════════

const ReferralPanel = () => {
  const [data, setData]       = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [copied, setCopied]   = React.useState(null);   // 'link' | 'code' | null
  const [hidden, setHidden]   = React.useState(false);  // 403 / non-Creator

  const fetchData = React.useCallback(async () => {
    try {
      const r = await api('/referral');
      setData(r);
      setHidden(false);
    } catch (e) {
      // 403 = non-Creator tier. Any other error: log silently, hide.
      setHidden(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchData();
    const onFocus = () => fetchData();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchData]);

  if (hidden) return null;

  const link = data?.code
    ? `${window.location.origin}/?ref=${encodeURIComponent(data.code)}`
    : null;
  const rewardsEarned   = data?.rewards_earned   ?? 0;
  const rewardsPending  = data?.rewards_pending  ?? 0;
  const maxRewards      = data?.max_rewards      ?? 3;
  const capReached      = rewardsEarned >= maxRewards;

  const copy = async (what, value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // No-op — older browsers without Clipboard API just don't get
      // a "Copied" confirmation. The text was selectable manually.
    }
  };

  const whatsappHref = link
    ? `https://wa.me/?text=${encodeURIComponent(`Try Mashal — daily social intelligence brief. Use my link: ${link}`)}`
    : '#';

  // Loading skeleton — matches the Plan Card visual cadence so the right
  // column doesn't jump as the panel resolves.
  if (loading) {
    return (
      <div className="rounded-2xl border border-line dark:border-lineDark bg-chalk dark:bg-coalsoft p-5">
        <div className="h-3 w-24 rounded bg-ink/10 dark:bg-paper/10 animate-pulse mb-3" />
        <div className="h-7 w-40 rounded bg-ink/10 dark:bg-paper/10 animate-pulse mb-2" />
        <div className="h-3 w-56 rounded bg-ink/10 dark:bg-paper/10 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line dark:border-lineDark bg-chalk dark:bg-coalsoft p-5">
      <Eyebrow color="text-ultra dark:text-lime">Refer &amp; earn</Eyebrow>
      <h3 className="font-display text-[20px] font-semibold tracking-tightest mt-1.5 mb-1">
        {capReached
          ? `You've earned the maximum ${maxRewards} months. Thanks for sharing.`
          : `Earn a free month for every friend who upgrades.`}
      </h3>
      <p className="text-[12.5px] text-mute dark:text-muteDark leading-relaxed mb-4">
        Your friend gets their first month free when they add a card at signup. You get one month of Creator credited to your next invoice when they upgrade to a paying plan. Cap of {maxRewards} rewards per account to start.
      </p>

      {/* Counter row — pending + earned visible at a glance */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="rounded-xl bg-paper dark:bg-ink border border-line dark:border-lineDark p-3">
          <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-mute dark:text-muteDark">Earned</div>
          <div className="font-display text-[22px] font-semibold tracking-tightest mt-0.5">
            {rewardsEarned}<span className="text-mute dark:text-muteDark text-[14px]"> / {maxRewards}</span>
          </div>
        </div>
        <div className="rounded-xl bg-paper dark:bg-ink border border-line dark:border-lineDark p-3">
          <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-mute dark:text-muteDark">Pending</div>
          <div className="font-display text-[22px] font-semibold tracking-tightest mt-0.5">
            {rewardsPending}
          </div>
        </div>
      </div>

      {/* Code + copy */}
      <div className="rounded-xl bg-ink/[0.03] dark:bg-paper/[0.04] border border-line dark:border-lineDark p-3 mb-3">
        <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-mute dark:text-muteDark mb-1">Your code</div>
        <div className="flex items-center justify-between gap-3">
          <code className="font-mono text-[16px] tracking-[0.08em] font-semibold">{data?.code}</code>
          <button
            type="button"
            onClick={() => copy('code', data.code)}
            className="text-[11px] font-mono uppercase tracking-[0.14em] text-ultra dark:text-lime hover:underline"
          >
            {copied === 'code' ? 'Copied ✓' : 'Copy code'}
          </button>
        </div>
      </div>

      {/* Share buttons — only render when there's a real link */}
      {link && (
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            type="button"
            onClick={() => copy('link', link)}
            className="flex-1 min-w-[140px] h-9 px-3 rounded-xl bg-ink text-paper dark:bg-paper dark:text-ink text-[12.5px] font-medium hover:opacity-90 transition inline-flex items-center justify-center gap-1.5"
          >
            <Icon name="link" className="w-3.5 h-3.5" />
            {copied === 'link' ? 'Link copied ✓' : 'Copy invite link'}
          </button>
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 min-w-[140px] h-9 px-3 rounded-xl border border-line dark:border-lineDark text-[12.5px] font-medium hover:bg-ink/5 dark:hover:bg-paper/5 transition inline-flex items-center justify-center gap-1.5"
          >
            <Icon name="message" className="w-3.5 h-3.5" />
            Share via WhatsApp
          </a>
        </div>
      )}

      {/* Recent invitations list — compact, privacy-respecting (no
          referee identity). Only renders when there's at least one. */}
      {data?.referrals?.length > 0 && (
        <div className="pt-3 border-t border-line dark:border-lineDark">
          <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-mute dark:text-muteDark mb-2">Recent invites</div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {data.referrals.slice(0, 10).map(r => {
              const stamp = r.reward_applied_at || r.converted_at || r.signed_up_at;
              const dateStr = stamp
                ? new Date(stamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                : '';
              const statusMeta = {
                pending:   { label: 'Pending',  cls: 'bg-paper/40 dark:bg-ink/40 text-mute dark:text-muteDark' },
                converted: { label: 'Paid',     cls: 'bg-amber/15 text-amber' },
                rewarded:  { label: 'Rewarded', cls: 'bg-lime/20 text-limeDeep dark:text-lime' },
                rejected:  { label: 'Rejected', cls: 'bg-magenta/15 text-magenta' },
                expired:   { label: 'Expired',  cls: 'bg-paper/30 dark:bg-ink/30 text-mute dark:text-muteDark' },
              }[r.status] || { label: r.status, cls: 'bg-paper/30 dark:bg-ink/30 text-mute dark:text-muteDark' };
              return (
                <div key={r.number} className="flex items-center justify-between text-[12px]">
                  <span className="font-mono text-mute dark:text-muteDark">Invite #{r.number}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-mute dark:text-muteDark">{dateStr}</span>
                    <span className={cls('inline-flex items-center px-2 h-5 rounded-full text-[10px] font-mono uppercase tracking-[0.12em]', statusMeta.cls)}>
                      {statusMeta.label}
                    </span>
                  </div>
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
  Referral: Object.assign(window.Referral || {}, { Panel: ReferralPanel }),
});
