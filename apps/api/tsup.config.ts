import { defineConfig } from 'tsup';
import { externalDeps } from '../../scripts/external-deps.ts';
import { cpSync } from 'node:fs';

// Bundles workspace packages into dist; third-party dependencies stay in node_modules.
export default defineConfig({
  entry: { server: 'src/server.ts', spec: 'scripts/spec.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: true,
  noExternal: [/^@openrent\//],
  external: externalDeps('../..'),
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  onSuccess: async () => {
    cpSync('../../packages/db/migrations', 'dist/migrations', { recursive: true });
    cpSync('../../packages/db/sql', 'dist/sql', { recursive: true });
  },
});
