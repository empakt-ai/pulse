import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';

// Two HTML entries, each its own SPA:
//   - index.html  → /src/spa/main.jsx     (Mashal customer app + marketing)
//   - admin.html  → /src/admin/main.jsx   (internal admin console)
//
// Each entry imports its own stylesheet (src/styles/app.css for the main
// SPA, src/styles/admin.css for admin) and resolves Tailwind utilities
// against its own config — admin.css uses the @config directive to point
// at tailwind.admin.config.js so its drifted palette (different magenta,
// solid line color, narrower font roster) stays isolated.
//
// Output lands in dist/, the default. vercel.json wires this in step 6.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main:  resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
        demo:  resolve(__dirname, 'demo.html'),
      },
    },
  },
});
