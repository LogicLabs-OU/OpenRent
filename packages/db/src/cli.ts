import { loadDotEnv, requireDatabaseUrl } from './env.ts';
import { migrate, rollback } from './migrate.ts';

loadDotEnv();
const cmd = process.argv[2];
const url = requireDatabaseUrl('migration');

if (cmd === 'migrate') {
  const dryRun = process.argv.includes('--dry-run');
  const r = await migrate(url, { dryRun });
  if (dryRun) console.log(r.pending.length ? `pending: ${r.pending.join(', ')}` : 'up to date');
  else console.log(r.applied.length ? `applied: ${r.applied.join(', ')}` : 'up to date');
} else if (cmd === 'rollback') {
  const name = await rollback(url);
  console.log(name ? `reverted ${name}` : 'nothing to revert');
} else {
  console.error('usage: cli.ts migrate [--dry-run] | rollback');
  process.exit(1);
}
