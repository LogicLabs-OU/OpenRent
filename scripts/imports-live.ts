/**
 * Live check of the Booqable and Snipe-IT importers against the real APIs. Opt-in: a system is checked
 * only when its variables are set. It only reads: it prints how many records of each kind would be
 * imported and the first row of each, and changes nothing anywhere.
 *
 *   BOOQABLE_COMPANY=rentals BOOQABLE_API_KEY=...
 *   SNIPEIT_URL=https://assets.example.com SNIPEIT_TOKEN=...
 *
 *   pnpm test:imports-live
 */
import { booqableSheets, snipeitSheets } from '../packages/core/src/imports/sources.ts';

const env = (k: string) => process.env[k]?.trim() ?? '';
const checks: { name: string; vars: string[]; read: () => Promise<Record<string, { headers: string[]; rows: string[][] } | undefined>> }[] = [
  { name: 'Booqable', vars: ['BOOQABLE_COMPANY', 'BOOQABLE_API_KEY'], read: () => booqableSheets({ company: env('BOOQABLE_COMPANY'), apiKey: env('BOOQABLE_API_KEY') }) },
  { name: 'Snipe-IT', vars: ['SNIPEIT_URL', 'SNIPEIT_TOKEN'], read: () => snipeitSheets({ baseUrl: env('SNIPEIT_URL').replace(/\/$/, ''), token: env('SNIPEIT_TOKEN') }, []) },
];

let ran = 0;
let failed = 0;
for (const c of checks) {
  if (!c.vars.every((k) => env(k))) {
    console.log(`${c.name}: skipped (set ${c.vars.join(', ')})`);
    continue;
  }
  ran++;
  console.log(`${c.name}:`);
  try {
    for (const [entity, sheet] of Object.entries(await c.read())) {
      if (!sheet) continue;
      console.log(`  ${entity}: ${sheet.rows.length}`);
      if (sheet.rows[0]) console.log(`    ${sheet.headers.map((h, i) => `${h}=${sheet.rows[0]![i]}`).join(', ')}`);
    }
    console.log('  ok');
  } catch (e) {
    failed++;
    console.log(`  FAILED: ${(e as Error).message}`);
  }
}
if (!ran) console.log('Nothing to check: no credentials set.');
process.exit(failed ? 1 : 0);
