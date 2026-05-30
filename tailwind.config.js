// Tailwind theme extracted verbatim from the inline `tailwind.config = {...}`
// block that used to live in index.html (alongside the cdn.tailwindcss.com
// runtime). Colors, fonts, letter-spacing, and shadows mirror the brand
// system the SPA relies on.
//
// `content` globs cover every surface that uses Tailwind utilities:
//   - The SPA shells (index.html, admin.html)
//   - The marketing pages and compare hub
//   - The legacy `js/**/*.js` babel files (still around until step 2)
//   - The new `src/**/*.{js,jsx}` modules that step 2 will produce
//
// Dynamic class strings (cls(), template literals) are common across the
// SPA, so smoke testing during step 5 will likely turn up a small safelist
// of utilities the scanner can't see statically. Append patterns there as
// they surface — do NOT pre-bloat the safelist on speculation.

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './*.html',
    './compare/*.html',
    './js/**/*.{js,jsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#0A0A0B',
        paper: '#F5F1E8',
        chalk: '#FBF9F4',
        coal: '#15151A',
        coalsoft: '#1C1C24',
        line: 'rgba(10,10,11,0.08)',
        lineDark: 'rgba(245,241,232,0.08)',
        mute: '#6F6B62',
        muteDark: '#9A958A',
        lime: '#D6FF3E',
        limeDeep: '#A8D200',
        magenta: '#FF2D6A',
        magentaSoft: '#FFE3EC',
        ultra: '#6B5BFF',
        ultraSoft: '#E8E4FF',
        amber: '#FFB23E',
      },
      fontFamily: {
        display: ['Bricolage Grotesque', 'system-ui', 'sans-serif'],
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'monospace'],
        serif: ['Instrument Serif', 'Georgia', 'serif'],
      },
      letterSpacing: {
        tightest: '-0.04em',
        tighter: '-0.025em',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(10,10,11,.04), 0 8px 24px -8px rgba(10,10,11,.08)',
        pop: '0 8px 32px -8px rgba(107,91,255,.25), 0 2px 8px rgba(10,10,11,.06)',
      },
    },
  },
  plugins: [],
};
