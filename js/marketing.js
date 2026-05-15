// ═════════════════════════════════════════════════════════════════════════
// [Mashal-SPECIFIC] Marketing-page chrome — theme toggle persistence and
// activation. Loaded by every static marketing page (features, pricing,
// about, contact, privacy, terms) so the header behaviour matches the
// home page's LandingNav.
//
// Theme key (`pulse_theme`) and class (`html.dark`) are intentionally the
// same as the SPA — flipping it on a marketing page persists, and the
// home page picks up the preference on next navigation.
//
// Apply-on-load runs inline in each <head> to avoid a flash; this file
// just wires up the toggle button after DOMContentLoaded.
// ═════════════════════════════════════════════════════════════════════════

(function () {
  function init() {
    var btn = document.querySelector('[data-theme-toggle]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var isDark = document.documentElement.classList.toggle('dark');
      try { localStorage.setItem('pulse_theme', isDark ? 'dark' : 'light'); } catch (_) {}
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
