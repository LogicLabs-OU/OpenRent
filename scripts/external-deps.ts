/** Third-party dependencies of every workspace package: kept external by the bundler. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

export function externalDeps(root: string): string[] {
  const dirs = ['apps', 'packages', 'packages/plugins'].flatMap((d) =>
    existsSync(path.join(root, d)) ? readdirSync(path.join(root, d)).map((n) => path.join(root, d, n)) : [],
  );
  const names = new Set<string>();
  for (const dir of dirs) {
    const f = path.join(dir, 'package.json');
    if (!existsSync(f)) continue;
    const pkg = JSON.parse(readFileSync(f, 'utf8'));
    for (const n of Object.keys(pkg.dependencies ?? {})) if (!n.startsWith('@openrent/')) names.add(n);
  }
  return [...names];
}
