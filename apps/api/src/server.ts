import { loadDotEnv } from '@openrent/db';
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
