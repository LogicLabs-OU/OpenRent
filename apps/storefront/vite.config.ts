import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';
import { openrentThemes } from './themes-plugin.ts';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, '../../', ''), ...process.env };
  // Product photos are served by the API (/api/v1/public/files); allow its origin even over http in development.
  const apiOrigin = new URL(env.OPENRENT_PUBLIC_URL || env.OPENRENT_API_URL || 'http://localhost:7070')
    .origin;
  return {
    // Read the repository-root .env shared by every app.
    envDir: '../../',
    // Transform every page and theme file at start-up, so Vite finds all dependencies before the first
    // visit instead of reloading an open page when it meets a new one.
    server: { warmup: { clientFiles: ['./src/routes/**/*.svelte', './src/lib/**/*.svelte', '../../packages/themes/*/{layouts,templates,snippets,sections}/**/*.svelte'] } },
    plugins: [
      openrentThemes({ themesConfig: env.THEMES_CONFIG || path.resolve('../../themes.json'), themesDir: env.THEMES_DIR || undefined }),
      tailwindcss(),
      sveltekit({
        compilerOptions: {
          // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
          runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
        },
        adapter: adapter(),
        // A second dev server in this folder (the e2e stack) needs its own generated files, or each
        // server's restart reloads the other's env and it falls back to the default API URL.
        outDir: process.env.SVELTEKIT_OUT_DIR || '.svelte-kit',
        // Theme JS runs in the browser only; no inline scripts outside the bundle (FR-THM-7).
        csp: {
          mode: 'auto',
          directives: {
            'default-src': ['self'],
            // Payment providers add their own origins per shop (hooks.server.ts, PaymentProvider.cspSources).
            'script-src': ['self'],
            'frame-src': ['self'],
            'connect-src': ['self'],
            // In development any local port is allowed, so a test stack on other ports still shows photos.
            'img-src': [
              'self',
              'data:',
              'https:',
              apiOrigin as 'self',
              ...(mode === 'development' ? ['http://localhost:*' as 'self'] : []),
            ],
            'style-src': ['self', 'unsafe-inline'],
            // Child themes' fonts come from the API (FR-THM-8).
            'font-src': ['self', 'data:', apiOrigin as 'self'],
            'object-src': ['none'],
            'base-uri': ['self'],
          },
        },
      }),
    ],
  };
});
