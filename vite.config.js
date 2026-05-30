import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Minimal Vite scaffold for step 1 of the build-pipeline migration.
// Multi-entry wiring (index.html SPA + admin.html SPA + the marketing
// CSS pipeline) lands in steps 3/4/5 — this file just confirms the
// toolchain is installed and React + JSX transforms work.
//
// Output goes to dist/ (Vite default), which is already in .gitignore
// and lines up with the outputDirectory we'll set in vercel.json (step 6).
export default defineConfig({
  plugins: [react()],
});
