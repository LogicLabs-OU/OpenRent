/**
 * Keeps every translation in step with English (`pnpm check:i18n`, run in CI). For each catalogue
 * folder it checks that every language has exactly the English keys, the same `{placeholders}`, and
 * plural blocks (`{n, plural, … other {…}}`) for the same variables. `_meta` keys are ignored.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { messageShape, shapeProblem } from '../packages/i18n/src/index.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const FOLDERS = [
  'apps/admin/src/lib/i18n',
  'apps/storefront/src/lib/i18n',
  'apps/widget/src/i18n',
  'packages/core/src/i18n',
  'packages/themes/default/locales',
  'packages/themes/retro/locales',
  'packages/themes/concept/locales',
  'packages/themes/ink-green/locales',
  'packages/themes/marquee/locales',
  'packages/themes/linen/locales',
  'packages/themes/nightfall/locales',
];

type Catalog = Record<string, unknown>;
const read = (file: string): Catalog => JSON.parse(readFileSync(file, 'utf8'));

const problems: string[] = [];
let checked = 0;

for (const folder of FOLDERS) {
  const dir = path.join(ROOT, folder);
  const en = read(path.join(dir, 'en.json'));
  const keys = Object.keys(en).filter((k) => !k.startsWith('_'));
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'en.json').sort()) {
    const cat = read(path.join(dir, file));
    const where = `${folder}/${file}`;
    checked++;
    for (const k of keys) {
      const v = cat[k];
      if (typeof v !== 'string' || !v.trim()) {
        problems.push(`${where}: missing "${k}"`);
        continue;
      }
      const diff = shapeProblem(String(en[k]), v);
      if (!diff) continue;
      const mine = [...messageShape(v).params].join(',') || '-';
      if (mine !== (diff.params.join(',') || '-') || !diff.plurals) problems.push(`${where}: "${k}" placeholders ${mine} ≠ ${diff.params.join(',') || '-'}`);
      if (diff.plurals) problems.push(`${where}: "${k}" plural blocks differ from English`);
    }
    for (const k of Object.keys(cat)) if (!k.startsWith('_') && !(k in en)) problems.push(`${where}: extra key "${k}"`);
  }
}

if (problems.length) {
  for (const p of problems.slice(0, 200)) process.stderr.write(`${p}\n`);
  if (problems.length > 200) process.stderr.write(`… and ${problems.length - 200} more\n`);
  process.stderr.write(`\n${problems.length} translation problems in ${checked} files\n`);
  process.exit(1);
}
process.stdout.write(`${checked} translation files match English\n`);
