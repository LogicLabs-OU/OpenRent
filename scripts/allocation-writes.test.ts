import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Bookings stay correct only if every change to `allocations` goes through the availability module,
 * which locks the pool, checks capacity and maps the exclusion constraint (ADR 0002, ADR 0007). Any
 * other code that inserts, updates or deletes allocation rows directly fails this test.
 */
const root = path.resolve(import.meta.dirname, '..');
const allowed = new Set(['packages/core/src/availability/index.ts']);
const WRITE = /\b(insert\s+into|update|delete\s+from)\s+allocations\b/i;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', 'build', 'test', '.svelte-kit', '.turbo'].includes(name) || name.startsWith('.svelte-kit')) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(ts|js|svelte)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

describe('allocation writes', () => {
  it('happen only in the availability module', () => {
    const offenders: string[] = [];
    for (const dir of ['apps', 'packages']) {
      for (const file of sources(path.join(root, dir))) {
        const rel = path.relative(root, file);
        if (allowed.has(rel)) continue;
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (WRITE.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
