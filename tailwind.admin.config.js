// Admin console has its own brand palette — close to the main SPA's but
// intentionally drifted (different magenta, solid `line` color instead
// of rgba, smaller font roster). Lives as a separate Tailwind config so
// admin classes resolve to admin's exact values, picked up via the
// `@config` directive in src/styles/admin.css.
//
// Extracted verbatim from the inline `tailwind.config = {...}` block
// that used to live in admin.html before the Vite migration.

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './admin.html',
    './src/admin/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['Geist', 'system-ui', 'sans-serif'],
        mono:    ['Geist Mono', 'ui-monospace', 'monospace'],
        display: ['Bricolage Grotesque', 'system-ui', 'sans-serif'],
      },
      // LIGHT THEME. The admin is built with a fixed light-on-dark token set
      // (bg-ink/bg-inksoft surfaces, text-paper/text-muteDark text,
      // border-lineDark). Rather than rewrite ~600 class usages, we flip the
      // token VALUES so every surface/text/border pair inverts together:
      //   • ink/inksoft  → light surfaces (page + white cards)
      //   • paper        → dark text (and dark emphasis buttons via bg-paper)
      //   • muteDark     → a readable mid-grey on light
      //   • lineDark     → a light border
      // The fg/bg relationship is preserved everywhere, so contrast holds.
      colors: {
        ink:      '#F5F1E8',   // page / default surface (was dark)
        inksoft:  '#FFFFFF',   // raised cards, inputs, selects (was dark)
        paper:    '#0A0A0B',   // primary text + dark emphasis (was light)
        chalk:    '#FBFAF6',   // unused in admin
        line:     '#E5E1D6',
        lineDark: '#E5E1D6',   // now a light hairline (was dark)
        mute:     '#6F6B62',
        muteDark: '#6F6B62',   // readable on light (was a light grey)
        ultra:    '#6B5BFF',
        lime:     '#D6FF3E',
        magenta:  '#FF3D8A',
      },
    },
  },
  plugins: [],
};
