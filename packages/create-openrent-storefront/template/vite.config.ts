import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // Vite finds the pages' dependencies at start-up instead of reloading the first page that needs one.
  server: { warmup: { clientFiles: ['./src/routes/**/*.svelte'] } },
  plugins: [
    sveltekit({
      compilerOptions: { runes: true },
      adapter: adapter(),
      // A second dev server in this folder (tests) needs its own generated files.
      outDir: process.env.SVELTEKIT_OUT_DIR || '.svelte-kit',
    }),
  ],
});
