// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Tiny HTML-escape helper. Used by every email template that
// interpolates user-controlled strings into HTML.
//
// SECURITY (audit, May 2026): several templates were escaping only `<`,
// leaving `>`, `&`, `"`, and `'` raw — which means user-controlled
// content in attribute contexts could break out of quotes and inject
// attributes. The fix is to consistently use this five-character escape
// everywhere user content lands in an HTML email body.
// ═════════════════════════════════════════════════════════════════════════

const ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, m => ENTITIES[m]);
}
