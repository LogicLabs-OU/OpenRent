import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const api = process.env.OPENRENT_API_URL ?? 'http://localhost:7070';

export default defineConfig({
  // A second dev server in this folder (a test stack) needs its own dependency cache, or each one's
  // re-optimising leaves the other serving stale modules (a blank page).
  cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
      },
      // The back office is a single-page app served by the API under /admin (PRD §7.8).
      adapter: adapter({ fallback: 'index.html' }),
      paths: { base: '/admin' },
      // The SPA page carries its policy as a meta tag with hashes of SvelteKit's inline start script (§9).
      // Inline style attributes come from components (positioning, transitions); theme previews frame
      // the storefront, which may live on another host.
      csp: {
        mode: 'hash',
        directives: {
          'default-src': ['self'],
          'script-src': ['self'],
          'style-src': ['self', 'unsafe-inline'],
          'img-src': ['self', 'data:', 'blob:', 'https:', ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:*' as 'self'])],
          'font-src': ['self', 'data:'],
          'connect-src': ['self'],
          'frame-src': ['self', 'https:', ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:*' as 'self'])],
          'worker-src': ['self'],
          'media-src': ['self', 'blob:'],
          'object-src': ['none'],
          'base-uri': ['self'],
          'form-action': ['self'],
        },
      },
      // Lets a second dev server (the e2e stack) keep its own generated files.
      outDir: process.env.SVELTEKIT_OUT_DIR || '.svelte-kit',
    }),
  ],
  server: {
    proxy: { '/api': { target: api, changeOrigin: false }, '/webhooks': api, '/docs': api },
    // Transform every page at start-up, so Vite finds all dependencies before the first visit instead
    // of reloading an open page when it meets a new one (flaky end-to-end runs).
    warmup: { clientFiles: ['./src/routes/**/*.svelte', './src/lib/**/*.svelte'] },
  },
});
