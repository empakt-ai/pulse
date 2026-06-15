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
// Self-contained window-bridge module: window.WhatsappConnect.Card, mounted by
// screens.jsx in the Settings "Connected accounts" section. Brand/Agency only.
//
// PARKED 2026-06-15 behind ENABLED=false: built but hidden until we validate the
// Meta flow against Zernio's live sdk-config + a real WABA. Flip to true (one
// line) to surface the card; the backend (api/connect/whatsapp.js) is live
// either way. Nothing else changes.
// ─────────────────────────────────────────────────────────────────────────

const { cls, Btn, Icon, Plat, api } = window;

const ENABLED = false;
const FB_SDK_VERSION = 'v21.0';

// Load Meta's JS SDK once. Resolves with window.FB.
function loadFbSdk() {
  return new Promise((resolve, reject) => {
    if (window.FB) return resolve(window.FB);
    const existing = document.getElementById('facebook-jssdk');
    if (existing) {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (window.FB) { clearInterval(iv); resolve(window.FB); }
        else if (Date.now() - t0 > 12000) { clearInterval(iv); reject(new Error('Meta SDK load timed out')); }
      }, 100);
      return;
    }
    const s = document.createElement('script');
    s.id = 'facebook-jssdk';
    s.async = true; s.defer = true; s.crossOrigin = 'anonymous';
    s.src = `https://connect.facebook.net/en_US/sdk.js`;
    s.onload = () => (window.FB ? resolve(window.FB) : reject(new Error('Meta SDK unavailable')));
    s.onerror = () => reject(new Error('Failed to load Meta SDK (ad blocker?)'));
    document.body.appendChild(s);
  });
}

const isFacebookOrigin = (origin) => {
  try { return /(^|\.)facebook\.com$/.test(new URL(origin).hostname); }
  catch { return false; }
};

const WhatsappCard = ({ account, tier, trialActive, atCap, showToast, onSynced, onDisconnect }) => {
  const [busy, setBusy] = React.useState(false);
  const sessionRef = React.useRef(null);   // { wabaId, phoneNumberId } from Meta postMessage
  const connected = !!account;
  const tierKey = String(tier || 'creator').toLowerCase();
  const allowed = tierKey === 'brand' || tierKey === 'agency' || !!trialActive;

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

  const connect = async () => {
    if (window.__MASHAL_DEMO_MODE) { window.__demoBlock?.('Sign up to connect your own accounts — this is a read-only demo.'); return; }
    setBusy(true);
    sessionRef.current = null;
    let onMessage;
    try {
      const cfg = await api('/connect/whatsapp');          // { appId, configId, profileId }
      const FB = await loadFbSdk();
      FB.init({ appId: cfg.appId, autoLogAppEvents: true, xfbml: false, version: FB_SDK_VERSION });

      // Capture the WABA / phone-number ids Meta posts back during signup.
      onMessage = (event) => {
        if (!isFacebookOrigin(event.origin)) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'WA_EMBEDDED_SIGNUP' && data.event === 'FINISH' && data.data) {
            sessionRef.current = { wabaId: data.data.waba_id, phoneNumberId: data.data.phone_number_id };
          }
        } catch { /* not our message */ }
      };
      window.addEventListener('message', onMessage);

      await new Promise((resolve) => {
        FB.login(async (response) => {
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
            resolve();
          }
        }, {
          config_id: cfg.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
        });
      });
    } catch (e) {
      showToast?.(e.message || "Couldn't start WhatsApp connect", 'err');
    } finally {
      if (onMessage) window.removeEventListener('message', onMessage);
      setBusy(false);
    }
  };

  const disabledReason = !allowed ? 'Brand & Agency' : (atCap && !connected ? 'Cap reached' : null);

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
          disabled={busy || !!disabledReason}
          title={disabledReason ? (allowed ? undefined : 'WhatsApp unlocks on Brand and Agency') : undefined}
          className={cls(
            'flex-shrink-0 self-center h-9 px-4 rounded-xl text-[13px] font-medium transition flex items-center gap-1.5 whitespace-nowrap',
            (busy || disabledReason)
              ? 'opacity-50 cursor-not-allowed bg-ink/5 dark:bg-paper/5 border border-line dark:border-lineDark text-mute dark:text-muteDark'
              : 'bg-ink text-paper dark:bg-paper dark:text-ink hover:bg-coal dark:hover:bg-chalk'
          )}
        >
          {busy
            ? <><Icon name="clock" className="w-3.5 h-3.5" /> Connecting…</>
            : disabledReason
              ? <><Icon name="info" className="w-3.5 h-3.5" /> {disabledReason}</>
              : <><Icon name="plus" className="w-3.5 h-3.5" /> Connect</>}
        </button>
      )}
    </div>
  );
};

// Gate at the export so the screens.jsx seam renders nothing while parked.
Object.assign(window, { WhatsappConnect: { Card: ENABLED ? WhatsappCard : null } });
