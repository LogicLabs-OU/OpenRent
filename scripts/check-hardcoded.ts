/**
 * Finds user-visible text written straight into Svelte markup instead of going through `t()`
 * (`pnpm check:hardcoded`, run in CI). It flags text nodes and the `placeholder`, `title`,
 * `aria-label`, `alt` and `label` attributes that contain words. Known cases live in
 * `scripts/hardcoded-baseline.json`; a file may never gain new ones, so the baseline only shrinks.
 * Put `<!-- i18n-ignore -->` right before an element whose text is not language (brand names, codes).
 *
 *   node scripts/check-hardcoded.ts            check
 *   node scripts/check-hardcoded.ts --update   rewrite the baseline (only after removing text)
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'svelte/compiler';

const ROOT = path.resolve(import.meta.dirname, '..');
const FOLDERS = ['apps/admin/src', 'apps/storefront/src', 'apps/widget/src', 'packages/themes', 'packages/ui/src/components/openrent'];
const BASELINE = path.join(ROOT, 'scripts/hardcoded-baseline.json');
const ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label']);
/** Product and provider names are not translated. */
const BRANDS = new Set(['OpenRent', 'Stripe']);

/** Text a translator would change: some word made only of letters that is not a brand or a short code. */
export function isLanguage(text: string) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .some((w) => /^\p{L}{2,}$/u.test(w) && !BRANDS.has(w) && !/^\p{Lu}{2,3}$/u.test(w));
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.svelte') ? [p] : [];
  });
}

type Node = { type?: string; [k: string]: unknown };

/** Visible text in one component, as `line: text` entries. */
export function findHardcoded(source: string): string[] {
  const ast = parse(source, { modern: true }) as unknown as { fragment: Node };
  const hits: string[] = [];
  const line = (start: number) => source.slice(0, start).split('\n').length;
  const ignored = (nodes: Node[], i: number) => {
    for (let j = i - 1; j >= 0; j--) {
      const n = nodes[j]!;
      if (n.type === 'Text' && !String(n.data).trim()) continue;
      return n.type === 'Comment' && String(n.data).trim() === 'i18n-ignore';
    }
    return false;
  };
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((n, i) => {
        if (!ignored(node as Node[], i)) walk(n);
      });
      return;
    }
    const n = node as Node;
    if (n.type === 'Text' && isLanguage(String(n.data))) hits.push(`${line(n.start as number)}: ${String(n.data).trim()}`);
    if (n.type === 'Attribute' && ATTRS.has(String(n.name)) && Array.isArray(n.value)) {
      for (const v of n.value as Node[]) if (v.type === 'Text' && isLanguage(String(v.data))) hits.push(`${line(v.start as number)}: ${n.name}="${String(v.data).trim()}"`);
      return;
    }
    if (n.type === 'Attribute') return;
    for (const [k, v] of Object.entries(n)) if (k !== 'parent' && v && typeof v === 'object') walk(v);
  };
  walk(ast.fragment);
  return hits;
}

function main() {
  const found: Record<string, string[]> = {};
  for (const folder of FOLDERS)
    for (const file of files(path.join(ROOT, folder))) {
      const hits = findHardcoded(readFileSync(file, 'utf8'));
      if (hits.length) found[path.relative(ROOT, file)] = hits;
    }
  const counts = Object.fromEntries(Object.entries(found).map(([f, h]) => [f, h.length]).sort(([a], [b]) => String(a).localeCompare(String(b))));
  if (process.argv.includes('--update')) {
    writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`);
    console.log(`Baseline written: ${Object.keys(counts).length} files`);
    return;
  }
  const baseline: Record<string, number> = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const worse = Object.entries(found).filter(([f, h]) => h.length > (baseline[f] ?? 0));
  for (const [f, h] of worse) console.error(`${f}: ${h.length} hard-coded text(s), baseline ${baseline[f] ?? 0}\n  ${h.join('\n  ')}`);
  if (worse.length) {
    console.error(`\nMove the text into the translation catalogues and use t(), or mark non-language text with <!-- i18n-ignore -->.`);
    process.exit(1);
  }
  const better = Object.keys(baseline).filter((f) => (counts[f] ?? 0) < baseline[f]!);
  if (better.length) console.log(`${better.length} file(s) improved; run with --update to shrink the baseline.`);
  console.log(`No new hard-coded text (${Object.values(counts).reduce((a, b) => a + b, 0)} known).`);
}

if (import.meta.filename === process.argv[1]) main();
