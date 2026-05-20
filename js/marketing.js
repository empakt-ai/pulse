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
  function initThemeToggle() {
    var btn = document.querySelector('[data-theme-toggle]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var isDark = document.documentElement.classList.toggle('dark');
      try { localStorage.setItem('pulse_theme', isDark ? 'dark' : 'light'); } catch (_) {}
    });
  }
  function initNavToggle() {
    var toggle = document.querySelector('[data-nav-toggle]');
    var links  = document.querySelector('.nav-links');
    if (!toggle || !links) return;
    function close() {
      links.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }
    function open() {
      links.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
    }
    toggle.addEventListener('click', function () {
      if (links.classList.contains('is-open')) close(); else open();
    });
    // Close the panel after a link tap (anchors within the same page) and
    // whenever the viewport grows back past the mobile breakpoint so the
    // open class doesn't leak into the desktop layout.
    links.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', close); });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 720) close();
    });
  }
  function init() {
    initThemeToggle();
    initNavToggle();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
