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
      colors: {
        ink:      '#0A0A0B',
        inksoft:  '#15151B',
        paper:    '#F5F1E8',
        chalk:    '#FBFAF6',
        line:     '#E5E1D6',
        lineDark: '#1F1F26',
        mute:     '#6F6B62',
        muteDark: '#A19E94',
        ultra:    '#6B5BFF',
        lime:     '#D6FF3E',
        magenta:  '#FF3D8A',
      },
    },
  },
  plugins: [],
};
