import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The demo page (index.html) points at the local API and storefront; override with env vars.
const demo: Record<string, string> = {
  OPENRENT_API_URL: process.env.OPENRENT_API_URL ?? 'http://localhost:7070',
  STOREFRONT_URL: process.env.STOREFRONT_URL ?? 'http://localhost:7072',
};

/**
 * Two IIFE bundles (FR-SF-2): openrent-widget.js registers <openrent-product>, <openrent-category> and
 * <openrent-book-button>; `--mode checkout` builds openrent-checkout.js, which the first script loads
 * on the first "Book" so pages that only show products stay small.
 */
export default defineConfig(({ mode }) => ({
  plugins: [
    { name: 'openrent-demo-urls', transformIndexHtml: (html) => html.replace(/%(\w+)%/g, (m, k: string) => demo[k] ?? m) },
    tailwindcss(),
    svelte({
      // svelte.config.js turns on custom elements; shadcn components from @openrent/ui stay regular components.
      dynamicCompileOptions: ({ filename }) => (/[/\\]apps[/\\]widget[/\\]src[/\\]/.test(filename) ? undefined : { customElement: false }),
    }),
  ],
  // shadcn components already merge classes with cn(); the lite build skips tailwind-variants' own merge pass.
  resolve: { alias: [{ find: /^tailwind-variants$/, replacement: 'tailwind-variants/lite' }] },
  build: {
    lib:
      mode === 'checkout'
        ? { entry: 'src/checkout.ts', name: 'OpenRentCheckout', formats: ['iife'], fileName: () => 'openrent-checkout.js' }
        : { entry: 'src/main.ts', name: 'OpenRentWidget', formats: ['iife'], fileName: () => 'openrent-widget.js' },
    emptyOutDir: mode !== 'checkout',
    target: 'es2020',
    minify: true,
  },
}));
