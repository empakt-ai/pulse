import React from 'react';

// ─────────────────────────────────────────────────────────────────────────
// Mashal — Telegram connect (guided bot + access-code flow, NOT OAuth).
//
// Telegram doesn't ride the OAuth popup the other platforms use. Instead we
// fetch a one-time access code from /api/connect/telegram, show the user how to
// add @ZernioScheduleBot as a channel/group admin + send the code, then poll
// POST /api/accounts until the channel appears (uniform import — no Telegram-
// specific path). Brand/Agency only (server-authoritative; the card mirrors it).
//
// Self-contained window-bridge module: published as window.TelegramConnect.Card
// and mounted by screens.jsx inside the Settings "Connected accounts" section.
// It receives the parent's account/tier state + callbacks as props so it never
// reaches into SettingsScreen internals.
// ─────────────────────────────────────────────────────────────────────────

const { cls, Card, Btn, Icon, Plat, api } = window;

const BOT_FALLBACK = '@ZernioScheduleBot';

// ── The connect dialog (code + steps + auto-detect poll) ──────────────────
const TelegramConnectModal = ({ onClose, onConnected, showToast }) => {
  const [phase, setPhase] = React.useState('loading'); // loading | ready | error
  const [info, setInfo] = React.useState(null);        // { code, botUsername }
  const [error, setError] = React.useState(null);
  const [waiting, setWaiting] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const pollRef = React.useRef(null);

  // Fetch the access code on open.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api('/connect/telegram');
        if (!alive) return;
        setInfo({ code: r.code, botUsername: r.botUsername || BOT_FALLBACK });
        setPhase('ready');
      } catch (e) {
        if (alive) { setError(e.message || 'Could not start Telegram connect.'); setPhase('error'); }
      }
    })();
    return () => { alive = false; };
  }, []);

  // Auto-detect: poll the existing sync until a telegram channel lands.
  React.useEffect(() => {
    if (phase !== 'ready') return;
    setWaiting(true);
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const synced = await api('/accounts', { method: 'POST' });
        const accts = synced.accounts || [];
        const got = accts.find(a => a.platform === 'telegram' && a.is_active !== false);
        if (got) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          onConnected?.(accts, got);
          showToast?.('Telegram channel connected ✓');
          onClose?.();
          return;
        }
      } catch { /* transient — keep polling */ }
      // ~2 min ceiling, then stop polling but leave the dialog open with guidance.
      if (attempts >= 40) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setWaiting(false);
      }
    }, 3000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [phase]);

  const copyCode = async () => {
    if (!info?.code) return;
    try { await navigator.clipboard.writeText(info.code); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { /* clipboard blocked — the code is visible to copy manually */ }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/50 dark:bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-paper dark:bg-coal border border-line dark:border-lineDark rounded-3xl shadow-pop p-6 sm:p-7 fade-up">
        <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center text-mute dark:text-muteDark hover:bg-ink/5 dark:hover:bg-paper/5 transition" aria-label="Close">
          <Icon name="x" className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl border border-line dark:border-lineDark bg-chalk dark:bg-ink flex items-center justify-center">
            <Plat p="tg" className="w-5 h-5" />
          </div>
          <h2 className="font-display text-[19px] font-semibold tracking-tight">Connect Telegram</h2>
        </div>

        {phase === 'loading' && (
          <p className="text-[13px] text-mute dark:text-muteDark mt-4">Getting your access code…</p>
        )}

        {phase === 'error' && (
          <div className="mt-4">
            <div className="p-3 rounded-xl border border-magenta/40 bg-magenta/10 text-magenta text-[12.5px]">{error}</div>
            <div className="flex justify-end mt-4"><Btn variant="outline" size="sm" onClick={onClose}>Close</Btn></div>
          </div>
        )}

        {phase === 'ready' && info && (
          <>
            <p className="text-[13px] text-mute dark:text-muteDark mt-3 mb-4">
              Connect a channel or group you admin. Mashal reads its messages for the Conversations view — it can't post or message anyone.
            </p>

            <ol className="space-y-3 mb-5">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-ink/8 dark:bg-paper/10 text-[11px] font-mono flex items-center justify-center mt-0.5">1</span>
                <span className="text-[13px]">Add <strong className="font-semibold">{info.botUsername}</strong> as an <strong className="font-semibold">admin</strong> of your Telegram channel or group.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-ink/8 dark:bg-paper/10 text-[11px] font-mono flex items-center justify-center mt-0.5">2</span>
                <span className="text-[13px]">Send this code in the channel (or forward any message to the bot):</span>
              </li>
            </ol>

            <button
              onClick={copyCode}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-line dark:border-lineDark bg-chalk dark:bg-coalsoft hover:border-ink/25 dark:hover:border-paper/25 transition mb-4 group"
              title="Copy code"
            >
              <span className="font-mono text-[16px] tracking-wider font-semibold">{info.code}</span>
              <span className="inline-flex items-center gap-1.5 text-[12px] text-mute dark:text-muteDark group-hover:text-ink dark:group-hover:text-paper">
                <Icon name={copied ? 'check' : 'copy'} className="w-3.5 h-3.5" />
                {copied ? 'Copied' : 'Copy'}
              </span>
            </button>

            <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl bg-ultra/8 dark:bg-ultra/12 border border-ultra/20 mb-2">
              {waiting
                ? <span className="w-3.5 h-3.5 border-2 border-ultra/30 border-t-ultra rounded-full animate-spin flex-shrink-0" />
                : <Icon name="info" className="w-4 h-4 text-ultra flex-shrink-0" />}
              <span className="text-[12.5px] text-ink/80 dark:text-paper/80">
                {waiting
                  ? 'Waiting for your channel — keep this open, it connects automatically.'
                  : 'Still not detected. Once the bot is added and the code is sent, close this and press Sync all.'}
              </span>
            </div>

            <p className="text-[11px] text-mute dark:text-muteDark mt-3">
              Read-only: channel &amp; group messages only. Private DMs straight to the bot aren't stored.
            </p>

            <div className="flex justify-end mt-5">
              <Btn variant="outline" size="sm" onClick={onClose}>Done</Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ── The Settings card (mirrors PlatformCard's look) ───────────────────────
const TelegramCard = ({ account, tier, trialActive, atCap, showToast, onSynced, onDisconnect }) => {
  const [open, setOpen] = React.useState(false);
  const connected = !!account;
  const tierKey = String(tier || 'creator').toLowerCase();
  const allowed = tierKey === 'brand' || tierKey === 'agency' || !!trialActive;

  const openConnect = () => {
    if (window.__MASHAL_DEMO_MODE) { window.__demoBlock?.('Sign up to connect your own accounts — this is a read-only demo.'); return; }
    setOpen(true);
  };

  // Disabled-button reason, mirroring the X/Snapchat tier-lock UX on PlatformCard.
  const disabledReason = !allowed
    ? 'Brand & Agency'
    : (atCap && !connected ? 'Cap reached' : null);

  return (
    <>
      <div className={cls(
        'flex items-start justify-between gap-3 p-4 rounded-2xl border transition min-h-[72px]',
        connected
          ? 'border-lime/40 bg-chalk dark:bg-coalsoft'
          : 'border-line dark:border-lineDark bg-chalk dark:bg-coalsoft hover:border-ink/20 dark:hover:border-paper/20'
      )}>
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="w-11 h-11 rounded-xl border border-line dark:border-lineDark bg-paper dark:bg-ink flex items-center justify-center flex-shrink-0">
            <Plat p="tg" className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[14px] font-semibold">Telegram</span>
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
                ? (account.platform_username || account.platform_name || 'Channel linked')
                : 'Channel or group · read-only'}
            </div>
          </div>
        </div>

        {connected ? (
          <button
            onClick={() => onDisconnect && onDisconnect('telegram')}
            className="flex-shrink-0 self-center h-8 px-3 rounded-lg text-[12px] font-medium border border-line dark:border-lineDark hover:border-magenta hover:text-magenta transition"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={openConnect}
            disabled={!!disabledReason}
            title={disabledReason ? (allowed ? undefined : 'Telegram unlocks on Brand and Agency') : undefined}
            className={cls(
              'flex-shrink-0 self-center h-9 px-4 rounded-xl text-[13px] font-medium transition flex items-center gap-1.5 whitespace-nowrap',
              disabledReason
                ? 'opacity-50 cursor-not-allowed bg-ink/5 dark:bg-paper/5 border border-line dark:border-lineDark text-mute dark:text-muteDark'
                : 'bg-ink text-paper dark:bg-paper dark:text-ink hover:bg-coal dark:hover:bg-chalk'
            )}
          >
            {disabledReason
              ? <><Icon name="info" className="w-3.5 h-3.5" /> {disabledReason}</>
              : <><Icon name="plus" className="w-3.5 h-3.5" /> Connect</>}
          </button>
        )}
      </div>

      {open && (
        <TelegramConnectModal
          onClose={() => setOpen(false)}
          onConnected={(accts) => onSynced && onSynced(accts)}
          showToast={showToast}
        />
      )}
    </>
  );
};

Object.assign(window, { TelegramConnect: { Card: TelegramCard } });
