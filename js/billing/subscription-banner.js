// ═════════════════════════════════════════════════════════════════════════
// PULSE Billing — SubscriptionBanner.
//
// Top-of-app strip surfacing Stripe subscription state. Lives in the
// same slot as TrialBanner but renders only AFTER the trial has
// converted — the two are mutually exclusive in practice.
//
// Three states surface:
//   - past_due:  payment failed, Stripe is retrying. Loudest banner.
//   - canceled:  subscription ended. One-click resubscribe path.
//   - cancel_at_period_end: still active but won't renew. Informational.
//
// No enforcement — the trial paywall is the only hard lock today.
// These are nudges that lead to the Customer Portal or Checkout.
// Loaded as <script type="text/babel" src="js/billing/subscription-banner.js"></script>.
// ═════════════════════════════════════════════════════════════════════════

const SubscriptionBanner = ({ workspace, onUpgrade, onPortal }) => {
  if (!workspace) return null;
  const status = workspace.stripe_subscription_status;
  const cancelPending = !!workspace.stripe_cancel_at_period_end;
  const renewsAt = workspace.stripe_current_period_end;

  // past_due — card failed, Stripe will keep retrying. Loudest banner.
  if (status === 'past_due') {
    return (
      <div className="w-full text-center text-[12.5px] sm:text-[13px] font-medium px-5 py-2 flex items-center justify-center gap-3 flex-wrap bg-magenta text-paper">
        <span>Payment failed · update your card to avoid losing access</span>
        <button
          type="button"
          onClick={onPortal}
          className="inline-flex items-center gap-1 h-7 px-3 rounded-full bg-paper/15 hover:bg-paper/25 text-inherit transition text-[11.5px] font-mono uppercase tracking-[0.12em]"
        >
          Update payment <Icon name="arrowRight" className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // canceled — sub is gone. We show this until the user clicks "Subscribe
  // again". No grace period today; if you want one, gate by
  // stripe_current_period_end being in the future.
  if (status === 'canceled') {
    return (
      <div className="w-full text-center text-[12.5px] sm:text-[13px] font-medium px-5 py-2 flex items-center justify-center gap-3 flex-wrap bg-ink text-paper">
        <span>Subscription ended · resubscribe to keep your data flowing</span>
        <button
          type="button"
          onClick={onUpgrade}
          className="inline-flex items-center gap-1 h-7 px-3 rounded-full bg-lime text-ink hover:brightness-105 transition text-[11.5px] font-mono uppercase tracking-[0.12em]"
        >
          Subscribe again <Icon name="arrowRight" className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // cancel_at_period_end — subscription still active but won't renew.
  // Informational tone; user can change their mind via the portal.
  if (cancelPending && renewsAt) {
    const endsOn = new Date(renewsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return (
      <div className="w-full text-center text-[12.5px] sm:text-[13px] font-medium px-5 py-2 flex items-center justify-center gap-3 flex-wrap bg-amber text-ink">
        <span>Subscription ends {endsOn} · reactivate any time before then</span>
        <button
          type="button"
          onClick={onPortal}
          className="inline-flex items-center gap-1 h-7 px-3 rounded-full bg-ink/10 hover:bg-ink/20 text-inherit transition text-[11.5px] font-mono uppercase tracking-[0.12em]"
        >
          Manage billing <Icon name="arrowRight" className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return null;
};

Object.assign(window, { SubscriptionBanner });
