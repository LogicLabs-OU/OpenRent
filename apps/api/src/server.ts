import { accounting } from '@openrent/core';
import { loadDotEnv, withSystem, withTenant } from '@openrent/db';
import { systemCtx } from './context.ts';
import { ConfigError, loadConfig } from './config.ts';
import { bootstrap } from './bootstrap.ts';
import { buildApp } from './app.ts';

loadDotEnv();
let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    console.error('\nCopy .env.example to .env and run scripts/gen-secrets.sh to generate keys.');
    process.exit(1);
  }
  throw err;
}

const bootLogger = { info: (...a: unknown[]) => console.log('[boot]', ...a), warn: (...a: unknown[]) => console.warn('[boot]', ...a), error: (...a: unknown[]) => console.error('[boot]', ...a), debug: () => undefined };
const deps = await bootstrap(config, bootLogger);
const app = await buildApp(deps);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await import('./pdf.ts').then((m) => m.closePdfRenderer()).catch(() => undefined);
  await deps.db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.port, host: config.host });
app.log.info(`OpenRent API on ${config.publicUrl} (docs at /docs)`);

// Invoices and payments from before the accounting triggers are booked once, in the background
// (ADR 0009). Safe to repeat; the worker does the same when it starts.
void (async () => {
  const tenants = await withSystem(deps.db, (c) => c.query<{ id: string }>(`SELECT id FROM tenants`));
  for (const t of tenants.rows) {
    await withTenant(deps.db, t.id, async (c) => {
      const ctx = systemCtx(deps, c, t.id, app.log);
      if (await accounting.backfill(ctx)) while ((await accounting.postPending(ctx)) > 0);
    }).catch((err) => app.log.error({ err, tenant: t.id }, 'accounting backfill failed'));
  }
})();
