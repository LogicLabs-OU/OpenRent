import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The API and worker bundles keep third-party packages external, and their Docker images install only
 * the app's own dependencies. So every runtime dependency of a workspace package they use must also be
 * listed in the app's package.json, or the image fails at startup.
 */
const root = path.resolve(import.meta.dirname, '..');
const workspace = new Map<string, { dir: string; deps: Record<string, string> }>();
for (const d of ['apps', 'packages', 'packages/plugins', 'packages/themes']) {
  for (const n of existsSync(path.join(root, d)) ? readdirSync(path.join(root, d)) : []) {
    const f = path.join(root, d, n, 'package.json');
    if (!existsSync(f)) continue;
    const pkg = JSON.parse(readFileSync(f, 'utf8'));
    workspace.set(pkg.name, { dir: path.join(d, n), deps: pkg.dependencies ?? {} });
  }
}

/** Workspace packages that only browser builds load (admin, storefront, themes); the server bundles skip them. */
const browserOnly = (name: string) => ['@openrent/ui', '@openrent/theme-sdk'].includes(name) || workspace.get(name)!.dir.startsWith('packages/themes');
/** Declared but not loaded at runtime: drizzle-orm describes the schema for `db:generate` only. */
const notAtRuntime = new Set(['drizzle-orm']);
/** The worker uses a few API modules (bootstrap, PDFs, spreadsheets), not the HTTP server: their packages are listed by hand. */
const partly = new Set(['@openrent/api']);

function needed(name: string, seen = new Set<string>([name])): Set<string> {
  const out = new Set<string>();
  for (const dep of Object.keys(workspace.get(name)?.deps ?? {})) {
    if (!workspace.has(dep)) {
      if (!notAtRuntime.has(dep) && !(partly.has(name) && seen.size > 1)) out.add(dep);
    } else if (!seen.has(dep) && !browserOnly(dep)) {
      seen.add(dep);
      for (const n of needed(dep, seen)) out.add(n);
    }
  }
  return out;
}

describe('app dependencies', () => {
  for (const app of ['@openrent/api', '@openrent/worker']) {
    it(`${app} lists every runtime package its workspace dependencies use`, () => {
      const own = new Set(Object.keys(workspace.get(app)!.deps));
      const missing = [...needed(app)].filter((d) => !own.has(d));
      expect(missing).toEqual([]);
    });
  }
});
