import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the built app loads from a file:// path (the shoot harness
  // opens dist/index.html directly rather than via a web server).
  base: './',
  build: { outDir: 'dist' },
});
