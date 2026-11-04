import { defineConfig } from 'vite';

// Relative paths, so the build works both locally and on GitHub Pages (/mapping-game/).
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1200 },
});
