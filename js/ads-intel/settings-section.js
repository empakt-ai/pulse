// ═════════════════════════════════════════════════════════════════════════
// Mashal Ad Intelligence — Settings section.
//
// Self-contained component mounted inside SettingsScreen. Owns its own
// state (load + save). Reads/writes /api/workspace/ad-settings. Exposes
// itself as window.AdsIntel.Settings so SettingsScreen mounts it with
// a single line.
//
// Loaded as <script type="text/babel" src="js/ads-intel/settings-section.js"></script>.
// Depends on api() from js/core/api.js and the global Btn, Card, cls,
// components defined inline in index.html.
// ═════════════════════════════════════════════════════════════════════════

const AdsIntelSettings = ({ onToast }) => {
  const [settings, setSettings] = React.useState(null);
  const [form, setForm] = React.useState({
    goal: '',
    category: '',
    regions: [],
    network_opt_in: true,
  });
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  // Initial load. /api/workspace/ad-settings returns settings:null when
  // the row doesn't exist yet — that's the "first-time setup" state.
  React.useEffect(() => {
    (async () => {
      try {
        const r = await api('/workspace/ad-settings');
        if (r?.settings) {
          setSettings(r.settings);
          setForm({
            goal: r.settings.goal || '',
            category: r.settings.category || '',
            regions: r.settings.regions || [],
            network_opt_in: r.settings.network_opt_in !== false,
          });
        }
      } catch {
        // No-op — most likely a stale auth token; the screen still renders.
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api('/workspace/ad-settings', {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      setSettings(r.settings);
      onToast?.('Ad Intelligence settings saved ✓');
      // Refresh the brief so spot scores + recommendations rebuild with the
      // new settings. The dashboard hydrates from /api/brief, so this is
      // the single source-of-truth refresh.
      try { window.dispatchEvent(new CustomEvent('pulse:refresh-brief')); } catch {}
    } catch (e) {
      onToast?.(e?.message || 'Save failed', 'err');
    } finally {
      setSaving(false);
    }
  };

  const fieldDirty = settings
    ? settings.goal !== form.goal
      || settings.category !== form.category
      || !!settings.network_opt_in !== !!form.network_opt_in
    : (!!form.goal || !!form.category);

  return (
    <div id="settings-ad-intel" style={{ scrollMarginTop: '80px' }}>
      <h3 className="font-display text-[17px] font-semibold tracking-tight mb-1">Ad Intelligence</h3>
      <p className="text-[13px] text-mute dark:text-muteDark mb-4">
        Set your advertising goal and category so Mashal can benchmark your ad performance and surface the highest-performing spots.
      </p>
      <Card className="!p-5 space-y-4">
        {/* Goal + category — two compact dropdowns side-by-side on
            desktop, stacking on narrower screens so labels don't truncate. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-mono uppercase tracking-[0.1em] text-mute dark:text-muteDark mb-1.5 block">
              Primary ad goal
            </label>
            <select
              value={form.goal}
              onChange={e => setForm(f => ({ ...f, goal: e.target.value }))}
              disabled={loading}
              className="w-full h-10 px-3 rounded-xl border border-line dark:border-lineDark bg-chalk dark:bg-coalsoft text-[13.5px] focus:outline-none focus:border-ultra"
            >
              <option value="">Select goal…</option>
              <option value="sales">Sales / Conversions</option>
              <option value="leads">Lead generation</option>
              <option value="awareness">Brand awareness</option>
              <option value="followers">Audience growth</option>
              <option value="traffic">Website traffic</option>
            </select>
          </div>

          <div>
            <label className="text-[12px] font-mono uppercase tracking-[0.1em] text-mute dark:text-muteDark mb-1.5 block">
              Industry category
            </label>
            <select
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              disabled={loading}
              className="w-full h-10 px-3 rounded-xl border border-line dark:border-lineDark bg-chalk dark:bg-coalsoft text-[13.5px] focus:outline-none focus:border-ultra"
            >
              <option value="">Select category…</option>
              <option value="food_beverage">Food & Beverage</option>
              <option value="automotive">Automotive</option>
              <option value="fashion">Fashion & Apparel</option>
              <option value="saas">SaaS / Tech</option>
              <option value="health_wellness">Health & Wellness</option>
              <option value="real_estate">Real Estate</option>
              <option value="finance">Finance</option>
              <option value="retail">Retail / Ecommerce</option>
              <option value="media">Media & Entertainment</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 pt-2 border-t border-line dark:border-lineDark">
          <div className="min-w-0">
            <div className="text-[13px] font-medium mb-0.5">Contribute to Mashal benchmarks</div>
            <div className="text-[12px] text-mute dark:text-muteDark leading-relaxed">
              Your anonymised ad metrics (no content, no creative, no account identity) help improve spot-score benchmarks for every Mashal workspace.
            </div>
          </div>
          {/* Toggle switch — On/Off label travels with the track so the
              state is unambiguous regardless of theme contrast. Inline
              left/transform values avoid Tailwind class-detection misses
              on translate-x-* (these are loaded from an external babel
              file the Tailwind JIT may not scan). */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={cls(
              'text-[10.5px] font-mono uppercase tracking-[0.14em]',
              form.network_opt_in ? 'text-limeDeep dark:text-lime' : 'text-mute dark:text-muteDark'
            )}>
              {form.network_opt_in ? 'On' : 'Off'}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={!!form.network_opt_in}
              onClick={() => setForm(f => ({ ...f, network_opt_in: !f.network_opt_in }))}
              className={cls(
                'flex-shrink-0 w-11 h-6 rounded-full transition-colors relative border',
                form.network_opt_in
                  ? 'bg-ultra dark:bg-lime border-ultra dark:border-lime'
                  : 'bg-line dark:bg-lineDark border-line dark:border-lineDark'
              )}
              aria-label="Toggle network contribution"
            >
              <span
                className="absolute top-1/2 w-4 h-4 rounded-full bg-white shadow transition-all"
                style={{
                  left: form.network_opt_in ? '22px' : '4px',
                  transform: 'translateY(-50%)',
                }}
              />
            </button>
          </div>
        </div>

        <Btn variant="ink" onClick={save} disabled={saving || loading || !fieldDirty}>
          {saving ? 'Saving…' : settings ? 'Update Ad Intelligence' : 'Save Ad Intelligence settings'}
        </Btn>
      </Card>
    </div>
  );
};

Object.assign(window, { AdsIntel: Object.assign(window.AdsIntel || {}, { Settings: AdsIntelSettings }) });
