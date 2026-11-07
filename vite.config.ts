import { defineConfig } from 'vite';

// Relative paths, so the build works both locally and on GitHub Pages (/mapping-game/).
// `vite build --mode yandex` adds the Yandex Games SDK and builds into dist-yandex/.
export default defineConfig(({ mode }) => ({
  base: './',
  build: { chunkSizeWarningLimit: 1200, outDir: mode === 'yandex' ? 'dist-yandex' : 'dist' },
  plugins: [{
    name: 'yandex-sdk',
    transformIndexHtml(html: string) {
      if (mode !== 'yandex') return html;
      // the platform serves its SDK at /sdk.js next to the game; it must load before the game starts
      return html.replace('<title>', '<script src="/sdk.js"></script>\n    <title>');
    },
  }],
}));
