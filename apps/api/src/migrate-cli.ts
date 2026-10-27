import { loadDotEnv } from '@openrent/db';
import { ConfigError, loadConfig } from './config.ts';
import { bootstrap } from './bootstrap.ts';

/**
 * `node dist/migrate.js`: applies OpenRent's and the plugins' database migrations, then exits. The Helm
 * chart runs it as a Job before each install and upgrade, so the API and worker start with
 * AUTO_MIGRATE=false and never race each other to migrate.
 */
loadDotEnv();
const log = { info: (...a: unknown[]) => console.log('[migrate]', ...a), warn: (...a: unknown[]) => console.warn('[migrate]', ...a), error: (...a: unknown[]) => console.error('[migrate]', ...a), debug: () => undefined };
try {
  const deps = await bootstrap(loadConfig(), log, { migrate: true, poolSize: 1, themes: false });
  await deps.db.close();
  log.info('database is up to date');
  process.exit(0);
} catch (err) {
  if (err instanceof ConfigError) console.error(err.message);
  else log.error(err);
  process.exit(1);
}
