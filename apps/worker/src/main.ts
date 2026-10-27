import { guardAllFetches } from '@openrent/core';
import { PgBoss } from 'pg-boss';
import pg from 'pg';
import { loadDotEnv } from '@openrent/db';
import { bootstrap } from '@openrent/api/bootstrap';
import { ConfigError, loadConfig } from '@openrent/api/config';
import { SCHEDULED, backfillAccounting, deliverWebhooks, publishOutbox, runJobs, runPluginSchedule, sendNotifications, type WorkerLogger } from './jobs.ts';

loadDotEnv();
let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const level = config.logLevel;
const log = (lvl: string) => (o: unknown, m?: string) => {
  if (lvl === 'debug' && level !== 'debug') return;
  console[lvl === 'error' ? 'error' : lvl === 'warn' ? 'warn' : 'log'](JSON.stringify({ level: lvl, time: new Date().toISOString(), msg: m ?? '', ...(o && typeof o === 'object' ? sanitize(o as Record<string, unknown>) : { data: o }) }));
};
function sanitize(o: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = v instanceof Error ? { message: v.message, stack: v.stack } : v;
  return out;
}
const logger: WorkerLogger = { info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') };

// A multi-shop installation: no request a shop's setting chose may reach the operator's network.
if (config.mode === 'multi_tenant') guardAllFetches();
const deps = await bootstrap(config, logger, { migrate: false, poolSize: 5, themes: false });
// Invoices and payments from before the accounting triggers are booked once (idempotent).
await backfillAccounting(deps, logger).catch((err) => logger.error({ err }, 'accounting backfill failed'));
const boss = new PgBoss({ connectionString: config.databaseUrl, max: Number(process.env.PGBOSS_POOL_MAX ?? 4) });
boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
await boss.start();
for (const [name, job] of Object.entries(SCHEDULED)) {
  await boss.createQueue(name);
  await boss.schedule(name, job.cron, {}, { tz: 'UTC' });
  await boss.work(name, async () => {
    await job.run(deps, logger);
  });
}

for (const job of deps.plugins.schedules) {
  const name = `plugin.${job.pluginId}.${job.name}`;
  try {
    await boss.createQueue(name);
    await boss.schedule(name, job.cron, {}, { tz: 'UTC' });
    await boss.work(name, async () => runPluginSchedule(deps, logger, job));
  } catch (err) {
    logger.error({ err, plugin: job.pluginId, job: job.name }, 'plugin schedule not registered');
  }
}

// Outbox, webhooks and email are driven by LISTEN/NOTIFY plus a short poll (PRD §7.3).
let wake: (() => void) | null = null;
const listener = new pg.Client({ connectionString: config.databaseUrl });
await listener.connect();
await listener.query('LISTEN openrent_outbox');
await listener.query('LISTEN openrent_jobs');
let wakeJobs: (() => void) | null = null;
listener.on('notification', (n) => (n.channel === 'openrent_jobs' ? wakeJobs?.() : wake?.()));

let running = true;
async function loop() {
  while (running) {
    try {
      const p = await publishOutbox(deps, logger);
      const d = await deliverWebhooks(deps, logger);
      const e = await sendNotifications(deps, logger);
      if (p || d || e) logger.debug({ published: p, delivered: d, emailed: e }, 'worker tick');
      if (p >= 100) continue;
    } catch (err) {
      logger.error({ err }, 'worker tick failed');
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 1000);
      wake = () => {
        clearTimeout(t);
        resolve();
      };
    });
    wake = null;
  }
}

/** Exports run beside the outbox loop, so a long export never holds up email or webhooks. */
async function jobLoop() {
  while (running) {
    try {
      if (await runJobs(deps, logger)) continue;
    } catch (err) {
      logger.error({ err }, 'job tick failed');
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 5000);
      wakeJobs = () => {
        clearTimeout(t);
        resolve();
      };
    });
    wakeJobs = null;
  }
}

const shutdown = async () => {
  running = false;
  wake?.();
  wakeJobs?.();
  await boss.stop({ graceful: true, timeout: 10_000 }).catch(() => undefined);
  await listener.end().catch(() => undefined);
  await import('@openrent/api/pdf').then((m) => m.closePdfRenderer()).catch(() => undefined);
  await deps.db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

logger.info({ jobs: Object.keys(SCHEDULED) }, 'OpenRent worker started');
await Promise.all([loop(), jobLoop()]);
