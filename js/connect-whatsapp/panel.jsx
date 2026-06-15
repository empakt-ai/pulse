import React from 'react';

// ─────────────────────────────────────────────────────────────────────────
// Mashal — WhatsApp connect (bring-your-own number via Meta Embedded Signup).
//
// Not OAuth-via-Zernio-popup and not a code flow — it loads Meta's JS SDK and
// runs FB.login with Zernio's Embedded-Signup config_id. The business authorizes
// their OWN existing WhatsApp Business number; Meta returns an auth `code` (and
// the WABA / phone-number ids via a postMessage), which we hand to Zernio to
// register. The number then imports uniformly through the existing
// POST /api/accounts sync. READ-ONLY BYO: no provisioning, no outbound.
//
// CRITICAL: the SDK + config are preloaded on mount so FB.login can be called
// SYNCHRONOUSLY in the click handler. Browsers block the signup popup if you
// await anything (config fetch, SDK load) between the click and FB.login — that
// produced a silent "stuck on Connecting, no popup" hang.
//
// Self-contained window-bridge module: window.WhatsappConnect.Card, mounted by
// screens.jsx in the Settings "Connected accounts" section. Brand/Agency only.
// ─────────────────────────────────────────────────────────────────────────

const { cls, Btn, Icon, Plat, api } = window;

const ENABLED = true;
// TEMP owner-only testing gate (2026-06-15): while we validate the Meta Embedded
// Signup flow end-to-end, only platform admins (the founder, profiles.is_admin)
// see the card. Paying customers don't. Flip OWNER_ONLY=false to expose to all
// Brand/Agency. The server (api/connect/whatsapp.js) enforces the SAME gate so
// it can't be bypassed by a non-owner hitting the endpoint directly.
const OWNER_ONLY = true;
const FB_SDK_VERSION = 'v21.0';

// Load Meta's JS SDK once and init it with the app id, via the canonical
// fbAsyncInit hook so FB.init only runs when the SDK is genuinely ready.
function ensureFbReady(appId) {
  return new Promise((resolve, reject) => {
    if (window.FB && window.__mashalFbInited) return resolve(window.FB);
    const doInit = () => {
      try {
        window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: FB_SDK_VERSION });
        window.__mashalFbInited = true;
        resolve(window.FB);
      } catch (e) { reject(e); }
    };
    if (window.FB) return doInit();
    window.fbAsyncInit = doInit;
    if (!document.getElementById('facebook-jssdk')) {
      const s = document.createElement('script');
      s.id = 'facebook-jssdk';
      s.async = true; s.defer = true; s.crossOrigin = 'anonymous';
      s.src = 'https://connect.facebook.net/en_US/sdk.js';
      s.onerror = () => reject(new Error('Failed to load Meta SDK (ad blocker?)'));
      document.body.appendChild(s);
    }
    setTimeout(() => { if (!window.__mashalFbInited) reject(new Error('Meta SDK timed out loading')); }, 12000);
  });
}

const isFacebookOrigin = (origin) => {
  try { return /(^|\.)facebook\.com$/.test(new URL(origin).hostname); }
  catch { return false; }
};

const WhatsappCardInner = ({ account, tier, trialActive, atCap, showToast, onSynced, onDisconnect }) => {
  const [ready, setReady] = React.useState(false);
  const [prepErr, setPrepErr] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const cfgRef = React.useRef(null);        // { appId, configId, profileId }
  const sessionRef = React.useRef(null);    // { wabaId, phoneNumberId } from Meta postMessage
  const connected = !!account;
  const tierKey = String(tier || 'creator').toLowerCase();
  const allowed = tierKey === 'brand' || tierKey === 'agency' || !!trialActive;

  // Preload config (appId/configId) + SDK so the click can call FB.login
  // synchronously. Surfaces any failure as prepErr so it's visible, not silent.
  const prepare = React.useCallback(async () => {
    setPrepErr(null);
    try {
      const cfg = await api('/connect/whatsapp');
      await ensureFbReady(cfg.appId);
      cfgRef.current = cfg;
      setReady(true);
    } catch (e) {
      setReady(false);
      setPrepErr(e.message || 'Could not prepare WhatsApp connect');
    }
  }, []);

  React.useEffect(() => {
    if (connected || !allowed || window.__MASHAL_DEMO_MODE) return;
    prepare();
  }, [connected, allowed, prepare]);

  // Capture the WABA / phone-number ids Meta posts back during signup.
  React.useEffect(() => {
    const onMessage = (event) => {
      if (!isFacebookOrigin(event.origin)) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'WA_EMBEDDED_SIGNUP' && data.event === 'FINISH' && data.data) {
          sessionRef.current = { wabaId: data.data.waba_id, phoneNumberId: data.data.phone_number_id };
        }
      } catch { /* not our message */ }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Poll the existing sync until the WhatsApp number lands.
  const pollForNumber = React.useCallback(async () => {
    for (let i = 0; i < 20; i++) {
      try {
        const synced = await api('/accounts', { method: 'POST' });
        const accts = synced.accounts || [];
        if (accts.some(a => a.platform === 'whatsapp' && a.is_active !== false)) {
          onSynced?.(accts);
          showToast?.('WhatsApp number connected ✓');
          return true;
        }
      } catch { /* transient */ }
      await new Promise(r => setTimeout(r, 3000));
    }
    showToast?.("Authorized — it can take a moment to appear. Press Sync all if it doesn't.", 'warn');
    return false;
  }, [onSynced, showToast]);

  // SYNCHRONOUS click handler — opens the Meta popup inside the user gesture.
  // No awaits before FB.login (everything it needs was preloaded on mount).
  const connect = () => {
    if (window.__MASHAL_DEMO_MODE) { window.__demoBlock?.('Sign up to connect your own accounts — this is a read-only demo.'); return; }
    if (!ready || !cfgRef.current || !window.FB) {
      showToast?.(prepErr || 'WhatsApp is still preparing — try again in a moment.', 'warn');
      if (!ready) prepare();
      return;
    }
    setBusy(true);
    sessionRef.current = null;
    try {
      window.FB.login((response) => {
        // The popup is already open; async work here is fine.
        (async () => {
          try {
            const code = response?.authResponse?.code;
            if (!code) { showToast?.('WhatsApp connect cancelled', 'warn'); return; }
            const { wabaId, phoneNumberId } = sessionRef.current || {};
            await api('/connect/whatsapp', {
              method: 'POST',
              body: JSON.stringify({ code, wabaId, phoneNumberId }),
            });
            await pollForNumber();
          } catch (e) {
            showToast?.(e.message || 'WhatsApp registration failed', 'err');
          } finally {
            setBusy(false);
          }
        })();
      }, {
        config_id: cfgRef.current.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
      });
    } catch (e) {
      showToast?.(e.message || "Couldn't open WhatsApp signup", 'err');
      setBusy(false);
    }
  };

  const disabledReason = !allowed ? 'Brand & Agency' : (atCap && !connected ? 'Cap reached' : null);
  const btnDisabled = busy || !!disabledReason || (!connected && !ready && !prepErr);

  return (
    <div className={cls(
      'flex items-start justify-between gap-3 p-4 rounded-2xl border transition min-h-[72px]',
      connected
        ? 'border-lime/40 bg-chalk dark:bg-coalsoft'
        : 'border-line dark:border-lineDark bg-chalk dark:bg-coalsoft hover:border-ink/20 dark:hover:border-paper/20'
    )}>
      <div className="flex items-start gap-3.5 min-w-0">
        <div className="w-11 h-11 rounded-xl border border-line dark:border-lineDark bg-paper dark:bg-ink flex items-center justify-center flex-shrink-0">
          <Plat p="wa" className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-semibold">WhatsApp</span>
            {connected ? (
              <span className="inline-flex items-center gap-1 px-2 h-5 rounded-full bg-lime/20 text-limeDeep dark:text-lime text-[10px] font-medium">
                <span className="w-1 h-1 rounded-full bg-limeDeep dark:bg-lime" />
                Connected
              </span>
            ) : (
              <span className="inline-flex items-center px-2 h-5 rounded-full bg-ultra/10 text-ultra text-[10px] font-medium">Conversations</span>
            )}
          </div>
          <div className="text-[12px] text-mute dark:text-muteDark font-mono mt-0.5 break-words">
            {connected
              ? (account.platform_username || account.platform_name || 'Number linked')
              : prepErr
                ? <span className="text-magenta">{prepErr}</span>
                : 'Your WhatsApp Business number · read-only'}
          </div>
        </div>
      </div>

      {connected ? (
        <button
          onClick={() => onDisconnect && onDisconnect('whatsapp')}
          className="flex-shrink-0 self-center h-8 px-3 rounded-lg text-[12px] font-medium border border-line dark:border-lineDark hover:border-magenta hover:text-magenta transition"
        >
          Disconnect
        </button>
      ) : (
        <button
          onClick={connect}
          disabled={btnDisabled}
          title={disabledReason ? (allowed ? undefined : 'WhatsApp unlocks on Brand and Agency') : (prepErr || undefined)}
          className={cls(
            'flex-shrink-0 self-center h-9 px-4 rounded-xl text-[13px] font-medium transition flex items-center gap-1.5 whitespace-nowrap',
            btnDisabled
              ? 'opacity-50 cursor-not-allowed bg-ink/5 dark:bg-paper/5 border border-line dark:border-lineDark text-mute dark:text-muteDark'
              : 'bg-ink text-paper dark:bg-paper dark:text-ink hover:bg-coal dark:hover:bg-chalk'
          )}
        >
          {busy
            ? <><Icon name="clock" className="w-3.5 h-3.5" /> Connecting…</>
            : disabledReason
              ? <><Icon name="info" className="w-3.5 h-3.5" /> {disabledReason}</>
              : prepErr
                ? <><Icon name="refresh" className="w-3.5 h-3.5" /> Retry</>
                : !ready
                  ? <><Icon name="clock" className="w-3.5 h-3.5" /> Preparing…</>
                  : <><Icon name="plus" className="w-3.5 h-3.5" /> Connect</>}
        </button>
      )}
    </div>
  );
};

// Thin wrapper (no hooks) so the owner gate can early-return safely — the
// hook-bearing inner component only mounts when the card is actually shown,
// which keeps the rules of hooks happy regardless of when D.isAdmin hydrates.
const WhatsappCard = (props) => {
  if (OWNER_ONLY && !(window.D && window.D.isAdmin)) return null;
  return <WhatsappCardInner {...props} />;
};

// Gate at the export so the screens.jsx seam renders nothing while parked.
Object.assign(window, { WhatsappConnect: { Card: ENABLED ? WhatsappCard : null } });
