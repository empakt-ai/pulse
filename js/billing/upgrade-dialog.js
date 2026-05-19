// ═════════════════════════════════════════════════════════════════════════
// Mashal Billing — UpgradeDialog.
//
// Modal opened via the `pulse:openUpgrade` custom event so any screen
// (trial banner, locked paywall, AdsScreen locked card, etc.) can
// request it without prop drilling. POSTs to /api/stripe?action=checkout
// and redirects the browser to Stripe's hosted Checkout. On failure,
// surfaces an inline error + an email-support fallback link.
//
// Loaded as <script type="text/babel" src="js/billing/upgrade-dialog.js"></script>.
// Depends on api() from js/core/api.js and on the global Icon + Eyebrow
// components defined inline in index.html.
// ═════════════════════════════════════════════════════════════════════════

const UpgradeDialog = ({ open, onClose, intentTier, trial, trialDays }) => {
  const [loading, setLoading] = React.useState(false);
  const [error, setError]     = React.useState(null);

  if (!open) return null;
  const tierLabel = intentTier
    ? intentTier.charAt(0).toUpperCase() + intentTier.slice(1)
    : 'Your plan';
  const isTrialFlow = Number(trialDays) > 0;
  const supportEmail = 'hello@mashal.app';

  const startCheckout = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api('/stripe?action=checkout', {
        method: 'POST',
        body: JSON.stringify({
          tier: intentTier || undefined,
          // Only forward trial_days when the dialog was opened in trial
          // mode (referral-unlock CTA). The server validates eligibility
          // before honouring it.
          ...(isTrialFlow ? { trial_days: Number(trialDays) } : {}),
        }),
      });
      if (!r?.url) throw new Error('No checkout URL returned');
      window.location.href = r.url;
    } catch (e) {
      setError(e.message || 'Could not start checkout.');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="max-w-md w-full bg-paper dark:bg-coal rounded-3xl p-7 sm:p-8 border border-line dark:border-lineDark"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="w-10 h-10 rounded-2xl bg-ultra/15 text-ultra flex items-center justify-center">
            <Icon name="sparkle" className="w-5 h-5" />
          </div>
          <button type="button" onClick={onClose} className="text-mute dark:text-muteDark hover:text-ink dark:hover:text-paper transition" aria-label="Close">
            <Icon name="x" className="w-4 h-4" />
          </button>
        </div>
        <Eyebrow color="text-ultra">{isTrialFlow ? `Unlock ${trialDays} days free` : `Upgrade to ${tierLabel}`}</Eyebrow>
        <h2 className="font-display text-[28px] font-semibold tracking-tightest mt-2 mb-2 leading-tight">
          {isTrialFlow ? 'Add your card. No charge for 30 days.' : 'Continue to Stripe.'}
        </h2>
        <p className="text-[14px] text-mute dark:text-muteDark leading-relaxed mb-5">
          {isTrialFlow
            ? `We'll redirect you to Stripe's secure checkout to save your card and start your ${trialDays}-day free trial on ${tierLabel}. You won't be charged for ${trialDays} days, and you can cancel anytime from Settings → Billing.`
            : `We'll redirect you to Stripe's secure checkout to start your ${tierLabel} subscription. You can cancel or change plans anytime from Settings → Billing.`}
        </p>
        {trial?.days_left != null && !trial.locked && (
          <div className="rounded-xl bg-chalk dark:bg-coalsoft p-3 text-[12.5px] text-mute dark:text-muteDark mb-5">
            <Icon name="clock" className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" />
            You still have {trial.days_left === 0 ? 'less than a day' : `${trial.days_left} day${trial.days_left === 1 ? '' : 's'}`} left on your trial.
          </div>
        )}
        {error && (
          <div className="rounded-xl bg-magenta/10 border border-magenta/40 text-magenta text-[12.5px] p-3 mb-4">
            {error} · <a className="underline" href={`mailto:${supportEmail}?subject=Upgrade%20issue`}>email support</a>
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={startCheckout}
            disabled={loading}
            className="flex-1 h-11 inline-flex items-center justify-center gap-1.5 rounded-xl bg-ink text-paper dark:bg-paper dark:text-ink font-medium text-[13.5px] hover:opacity-90 transition disabled:opacity-60"
          >
            {loading ? 'Redirecting…' : <>Continue to Stripe <Icon name="arrowUpRight" className="w-3.5 h-3.5" /></>}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="h-11 px-4 rounded-xl text-[13.5px] font-medium border border-line dark:border-lineDark text-mute dark:text-muteDark hover:text-ink dark:hover:text-paper transition disabled:opacity-60"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { UpgradeDialog });
