import { DeliveryError, type Attachment, type DomainEvent } from '@openrent/plugin-sdk';
import { webhooks, notifications, orders, customers, storefront, catalog, servicing, integrations, accounting, payments, documents, plugins, files, jobs, reports, imports, tenancy, domains, exportZip, hookContext, serverT, type Ctx, guardedFetch } from '@openrent/core';
import { readSheet, rowsSheet, writeCsv, writeXlsx } from '@openrent/api/spreadsheets';
import { withSystem, withTenant, type PoolClient } from '@openrent/db';
import type { AppDeps } from '@openrent/api/deps';

export interface WorkerLogger {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
  debug(o: unknown, m?: string): void;
}

function ctxFor(deps: AppDeps, db: PoolClient, tenantId: string, logger: WorkerLogger): Ctx {
  return {
    db,
    tenantId,
    actor: { type: 'system', id: null },
    now: new Date(),
    plugins: deps.plugins,
    secrets: deps.secrets,
    config: {
      publicUrl: deps.config.publicUrl, adminUrl: deps.config.adminUrl, storefrontUrl: deps.config.storefrontUrl, storefrontDomain: deps.config.storefrontDomain, livemode: deps.config.livemode, multiTenant: deps.config.mode === 'multi_tenant',
      renderPdf: deps.config.pdfRenderer === 'playwright' ? async (html) => (await import('@openrent/api/pdf')).renderPdf(html) : undefined,
    },
    logger,
  };
}

async function asTenant(c: PoolClient, tenantId: string) {
  await c.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.system', 'off', true)`, [tenantId]);
}

async function asSystem(c: PoolClient) {
  await c.query(`SELECT set_config('app.system', 'on', true)`);
}

/** Work that must wait for a commit (`internal.*` events other than job wake-ups). */
const INTERNAL: Record<string, (ctx: Ctx, object: any) => Promise<void>> = {
  'internal.file.purge': (ctx, o) => files.purgeStored(ctx, o),
};

/**
 * Moves committed outbox rows to the webhook event log and per-endpoint deliveries (PRD §6, §7.3).
 * One transaction per batch; each row is processed in its tenant's RLS context.
 * Returns the published events so plugins can be notified after commit.
 */

export async function publishOutbox(deps: AppDeps, logger: WorkerLogger, batch = 100): Promise<number> {
  const published: DomainEvent[] = [];
  await withSystem(deps.db, async (c) => {
    const rows = (await c.query(`SELECT * FROM outbox WHERE published_at IS NULL ORDER BY created_at, id LIMIT $1 FOR UPDATE SKIP LOCKED`, [batch])).rows;
    for (const row of rows) {
      await asTenant(c, row.tenant_id);
      await c.query('SAVEPOINT evt');
      try {
        if (!row.event_type.startsWith('internal.')) {
          const ctx = ctxFor(deps, c, row.tenant_id, logger);
          await webhooks.fanOut(ctx, { id: row.id, type: row.event_type, payload: row.payload });
          // Integrations that want this event get a task (run by integrations.run).
          await integrations.enqueueForEvent(ctx, row.payload, { type: row.aggregate_type, id: row.aggregate_id });
          published.push(row.payload);
        } else if (INTERNAL[row.event_type]) {
          await INTERNAL[row.event_type]!(ctxFor(deps, c, row.tenant_id, logger), row.payload?.data?.object);
        }
        await c.query(`UPDATE outbox SET published_at = now() WHERE id = $1`, [row.id]);
        await c.query('RELEASE SAVEPOINT evt');
      } catch (err) {
        await c.query('ROLLBACK TO SAVEPOINT evt');
        logger.error({ err, event: row.id }, 'outbox publish failed; will retry');
      }
      await asSystem(c);
    }
  });
  // Each event reaches plugins in its shop's transaction, so their scope (database, services) works.
  for (const ev of published) {
    await withTenant(deps.db, ev.tenant_id, (c) => deps.plugins.dispatch(ev, { ...hookContext(ctxFor(deps, c, ev.tenant_id, logger)), actor: ev.actor })).catch((err) =>
      logger.error({ err, event: ev.id }, 'plugin event dispatch failed'),
    );
  }
  return published.length;
}

/** Runs due integration tasks, oldest first, each in its own tenant transaction. */
export async function runIntegrationTasks(deps: AppDeps, logger: WorkerLogger, batch = 50): Promise<number> {
  const due = await withSystem(deps.db, (c) =>
    c.query<{ id: string; tenant_id: string }>(
      `SELECT t.id, t.tenant_id FROM integration_tasks t JOIN integration_connections c ON c.id = t.connection_id
        WHERE t.status = 'pending' AND t.next_attempt_at <= now() AND c.status IN ('connected', 'error') ORDER BY t.next_attempt_at, t.created_at LIMIT $1`,
      [batch],
    ),
  );
  let n = 0;
  for (const t of due.rows) {
    try {
      const r = await withTenant(deps.db, t.tenant_id, (c) => integrations.runTask(ctxFor(deps, c, t.tenant_id, logger), t.id));
      if (r) n++;
      if (r === 'retry' || r === 'failed') logger.warn({ task: t.id, result: r }, 'integration task did not go through');
    } catch (err) {
      logger.error({ err, task: t.id }, 'integration task crashed');
    }
  }
  return n;
}

/** Sends due webhook deliveries (first attempts and retries). */
/** Requests to one endpoint in flight at once, across all workers (PRD §6.5). */
export const ENDPOINT_CONCURRENCY = 4;
/** Deliveries one worker runs at the same time. */
const WORKER_CONCURRENCY = 4;

/**
 * Sends due webhook deliveries (first attempts and retries). Each delivery takes one of
 * ENDPOINT_CONCURRENCY advisory-lock slots for its endpoint; when all are taken it waits for the next run.
 */
export async function deliverWebhooks(deps: AppDeps, logger: WorkerLogger, fetchImpl?: webhooks.FetchLike, batch = 20): Promise<number> {
  // Through the network guard unless the installation allows private endpoints (WEBHOOKS_ALLOW_PRIVATE_NETWORK).
  fetchImpl ??= (webhooks.allowPrivateNetwork() ? fetch : guardedFetch) as unknown as webhooks.FetchLike;
  const due = await withSystem(deps.db, (c) =>
    c.query<{ id: string; tenant_id: string; endpoint_id: string }>(
      `SELECT id, tenant_id, endpoint_id FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT $1`,
      [batch],
    ),
  );
  let n = 0;
  const deliver = async (d: { id: string; tenant_id: string; endpoint_id: string }) => {
    try {
      await withTenant(deps.db, d.tenant_id, async (c) => {
        let slot = false;
        for (let i = 0; i < ENDPOINT_CONCURRENCY && !slot; i++)
          slot = (await c.query(`SELECT pg_try_advisory_xact_lock(hashtext($1), $2) AS ok`, [`webhook:${d.endpoint_id}`, i])).rows[0].ok;
        if (!slot) return;
        // Lock the row; skip if another worker took it.
        const locked = await c.query(`SELECT 1 FROM webhook_deliveries WHERE id = $1 AND status = 'pending' AND next_attempt_at <= now() FOR UPDATE SKIP LOCKED`, [d.id]);
        if (!locked.rows.length) return;
        const r = await webhooks.attemptDelivery(ctxFor(deps, c, d.tenant_id, logger), d.id, fetchImpl);
        n++;
        if (r.status !== 'succeeded') logger.warn({ delivery: d.id, status: r.status, retry_at: r.retryAt }, 'webhook delivery failed');
      });
    } catch (err) {
      logger.error({ err, delivery: d.id }, 'webhook delivery crashed');
    }
  };
  const queue = [...due.rows];
  await Promise.all(Array.from({ length: Math.min(WORKER_CONCURRENCY, queue.length) }, async () => {
    for (let d = queue.shift(); d; d = queue.shift()) await deliver(d);
  }));
  return n;
}

/**
 * What each job kind produces; runs in one repeatable-read tenant transaction, so exports are
 * consistent and an import batch goes in whole or not at all (FR-MIG-2). Imports make no file.
 */
const JOB_RUNNERS: Record<jobs.JobKind, (ctx: Ctx, job: jobs.JobRow, progress: (pct: number) => void) => Promise<{ filename: string; contentType: string; body: Buffer } | null>> = {
  async tenant_export(ctx, _job, progress) {
    const { zip } = await exportZip(ctx, progress);
    return { filename: `openrent-export-${ctx.now.toISOString().slice(0, 10)}.zip`, contentType: 'application/zip', body: zip };
  },
  async report_export(ctx, job) {
    const { name, format, query } = job.params as { name: string; format: 'csv' | 'xlsx'; query: Record<string, string> };
    const sheet = rowsSheet((await reports.runReport(ctx, name, query ?? {})).data as Record<string, unknown>[]);
    const stamp = ctx.now.toISOString().slice(0, 10);
    return format === 'xlsx'
      ? { filename: `${name}-${stamp}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: await writeXlsx(sheet, name) }
      : { filename: `${name}-${stamp}.csv`, contentType: 'text/csv; charset=utf-8', body: Buffer.from(writeCsv(sheet)) };
  },
  async import_fetch(ctx, job) {
    await imports.fetchBatch(ctx, job);
    return null;
  },
  async import_apply(ctx, job) {
    await imports.applyBatch(ctx, job, async (fileId) => {
      const f = await files.getFile(ctx, fileId);
      return readSheet(await files.readFile(ctx, f), f.filename);
    });
    return null;
  },
};

/** An import's failure in words: field errors name their rows. */
function importError(err: any) {
  const rows = (err?.errors ?? []).slice(0, 5).map((e: any) => `${e.field}: ${e.message}`);
  return [String(err?.message ?? err), ...rows].join('; ');
}

/** Runs queued jobs (exports); progress is written outside the job's transaction so the admin can show it. */
export async function runJobs(deps: AppDeps, logger: WorkerLogger, batch = 2): Promise<number> {
  const claimed = await withSystem(deps.db, (c) => jobs.claimJobs(c, batch));
  for (const job of claimed) {
    let last = 0;
    const progress = (pct: number) => {
      if (pct - last < 5) return;
      last = pct;
      void withTenant(deps.db, job.tenant_id, (c) => jobs.setProgress(ctxFor(deps, c, job.tenant_id, logger), job.id, pct)).catch(() => undefined);
    };
    try {
      await withTenant(
        deps.db,
        job.tenant_id,
        async (c) => {
          const ctx = ctxFor(deps, c, job.tenant_id, logger);
          const out = await JOB_RUNNERS[job.kind](ctx, job, progress);
          const file = out ? await files.putFile(ctx, { kind: 'export', filename: out.filename, contentType: out.contentType, body: out.body, ownerType: 'job', ownerId: job.id }) : null;
          await jobs.finishJob(ctx, job, file);
          if (job.kind === 'report_export' && file) await reports.deliverSavedReport(ctx, job, file);
        },
        { isolation: 'repeatable read', retries: 0 },
      );
      logger.info({ job: job.id, kind: job.kind }, 'job finished');
    } catch (err: any) {
      logger.error({ err, job: job.id }, 'job failed');
      await withTenant(deps.db, job.tenant_id, async (c) => {
        const ctx = ctxFor(deps, c, job.tenant_id, logger);
        await jobs.failJob(ctx, job, String(err?.message ?? err));
        await reports.savedReportFailed(ctx, job, String(err?.message ?? err));
        if (job.kind === 'import_fetch' || job.kind === 'import_apply') await imports.batchFailed(ctx, job, importError(err));
      }).catch(() => undefined);
    }
  }
  return claimed.length;
}

/** Sends queued emails through the configured channel; without SMTP they stay queued (FR-NOT-5). */
/** "Name <address>" keeps its name; a bare address gets the shop name as display name. */
export function formatFrom(from: string | null | undefined, shopName: string): string | undefined {
  const f = from?.trim();
  if (!f) return undefined;
  if (f.includes('<')) return f;
  return `"${shopName.replace(/["\\]/g, '')}" <${f}>`;
}

/**
 * PDFs of the message's documents, stored files as they are (scheduled reports), and a booking's
 * pickup and return as a calendar file (`ics:<order id>`). A missing
 * renderer never blocks the email; links still work.
 */
async function attachmentsFor(deps: AppDeps, ctx: Ctx, ids: string[], logger: WorkerLogger): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const id of ids) {
    try {
      if (id.startsWith('ics:')) {
        const cal = await orders.orderCalendar(ctx, id.slice(4));
        out.push({ filename: cal.filename, contentType: 'text/calendar; charset=utf-8; method=PUBLISH', content: cal.content });
        continue;
      }
      if (id.startsWith('fil_')) {
        const f = await files.getFile(ctx, id);
        out.push({ filename: f.filename, contentType: f.content_type, content: await files.readFile(ctx, f) });
        continue;
      }
      if (deps.config.pdfRenderer !== 'playwright') continue;
      const { documentPdf } = await import('@openrent/api/pdf');
      const doc = await documents.getDocument(ctx, id);
      const pdf = await documentPdf(ctx, doc);
      out.push({ filename: pdf.filename, contentType: 'application/pdf', content: pdf.body });
    } catch (err) {
      logger.warn({ err, document: id }, 'could not attach document PDF; sending without it');
    }
  }
  return out;
}

/**
 * Sends queued email through the email channel plugin with each tenant's own settings
 * (Settings → Email), falling back to the installation's SMTP_URL. Failed attempts are retried
 * with backoff (notifications.RETRY_MINUTES); refused recipients and old messages fail for good.
 */
export async function sendNotifications(deps: AppDeps, logger: WorkerLogger, batch = 20): Promise<number> {
  const due = await withSystem(deps.db, async (c) => {
    await c.query(
      `UPDATE notifications SET status = 'failed', next_attempt_at = NULL, error = coalesce(error, $1)
        WHERE status = 'queued' AND created_at < now() - make_interval(days => $2)`,
      [serverT('email.gave_up', { days: notifications.MAX_QUEUE_DAYS }), notifications.MAX_QUEUE_DAYS],
    );
    return c.query<{ id: string; tenant_id: string }>(
      // A suspended shop's messages wait until it is resumed.
      `SELECT id, tenant_id FROM notifications WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
          AND tenant_id IN (SELECT id FROM tenants WHERE status = 'active')
        ORDER BY created_at LIMIT $1`,
      [batch],
    );
  });
  let sent = 0;
  for (const row of due.rows) {
    await withTenant(deps.db, row.tenant_id, async (c) => {
      const n = (await c.query(`SELECT * FROM notifications WHERE id = $1 AND status = 'queued' FOR UPDATE SKIP LOCKED`, [row.id])).rows[0];
      if (!n) return;
      const ctx = ctxFor(deps, c, row.tenant_id, logger);
      if (n.channel === 'sms' || n.channel === 'whatsapp') {
        if (await sendText(ctx, n, logger)) sent++;
        return;
      }
      const tenant = (await c.query(`SELECT name, settings FROM tenants WHERE id = $1`, [row.tenant_id])).rows[0];
      // Each shop sends with its chosen email plugin (settings.email_channel).
      const picked = await plugins.emailChannel(ctx);
      const channel = picked?.channel;
      const config = picked?.config ?? {};
      const pctx = { tenantId: row.tenant_id, config, logger };
      if (!channel || !picked.enabled || !channel.isConfigured(pctx)) {
        await notifications.recordDeliveryFailure(ctx, n.id, new DeliveryError('not_configured', 'no email channel configured'));
        return;
      }
      try {
        // Without a configured sender, mail goes out as "<shop name>" <no-reply@public host>.
        const from = formatFrom(config.from ? String(config.from) : (tenant.settings?.email_from ?? `no-reply@${new URL(deps.config.publicUrl).hostname}`), tenant.name);
        const attachments = await attachmentsFor(deps, ctx, Array.isArray(n.attachments) ? n.attachments : [], logger);
        const res = await channel.send(pctx, {
          to: n.recipient,
          subject: n.subject,
          html: n.body_html,
          from,
          attachments,
          headers: { 'X-OpenRent-Notification': n.id },
        });
        await c.query(`UPDATE notifications SET attempts = attempts + 1, error = NULL, next_attempt_at = NULL, provider = $2 WHERE id = $1`, [n.id, picked.pluginId]);
        await notifications.markNotification(ctx, n.id, 'sent', { ref: res.ref });
        sent++;
      } catch (err: any) {
        await notifications.recordDeliveryFailure(ctx, n.id, err);
        logger.warn({ err: { message: err?.message, code: err?.code }, notification: n.id }, 'email send failed');
      }
    });
  }
  return sent;
}

/** One SMS or WhatsApp message through the plugin the shop chose for it (FR-NOT-4). */
async function sendText(ctx: Ctx, n: any, logger: WorkerLogger) {
  const picked = await plugins.textChannel(ctx, n.channel);
  if (!picked) {
    await notifications.recordDeliveryFailure(ctx, n.id, new DeliveryError('not_configured', `no ${n.channel} channel configured`));
    return false;
  }
  try {
    const pctx = { tenantId: ctx.tenantId, config: picked.config, logger, webhookUrl: notifications.textWebhookUrl(ctx, picked.pluginId) };
    const res = await picked.channel.send(pctx, { to: n.recipient, subject: '', html: '', text: n.body_text ?? '', template: n.template_key });
    await ctx.db.query(`UPDATE notifications SET attempts = attempts + 1, error = NULL, next_attempt_at = NULL, provider = $2 WHERE id = $1`, [n.id, picked.pluginId]);
    await notifications.markNotification(ctx, n.id, 'sent', { ref: res.ref });
    return true;
  } catch (err: any) {
    await notifications.recordDeliveryFailure(ctx, n.id, err);
    logger.warn({ err: { message: err?.message, code: err?.code }, notification: n.id }, 'text message send failed');
    return false;
  }
}

async function forEachTenant(deps: AppDeps, fn: (ctx: Ctx) => Promise<unknown>, logger: WorkerLogger) {
  // Suspended shops (managed cloud) are paused: no reminders, expiries or plugin jobs until resumed.
  const tenants = await withSystem(deps.db, (c) => c.query<{ id: string }>(`SELECT id FROM tenants WHERE status = 'active'`));
  for (const t of tenants.rows) {
    try {
      await withTenant(deps.db, t.id, (c) => fn(ctxFor(deps, c, t.id, logger)));
    } catch (err) {
      logger.error({ err, tenant: t.id }, 'scheduled job failed for tenant');
    }
  }
}

/** Books what the database queued for accounting (ADR 0009), a batch per transaction until nothing is left. */
export async function postAccounting(deps: AppDeps, logger: WorkerLogger) {
  const tenants = await withSystem(deps.db, (c) => c.query<{ tenant_id: string }>(`SELECT DISTINCT tenant_id FROM accounting_queue`));
  for (const t of tenants.rows) {
    try {
      while ((await withTenant(deps.db, t.tenant_id, (c) => accounting.postPending(ctxFor(deps, c, t.tenant_id, logger)))) > 0);
    } catch (err) {
      logger.error({ err, tenant: t.tenant_id }, 'accounting posting failed for tenant');
    }
  }
}

/** Once at start: movements from before the accounting triggers existed are queued (safe to repeat). */
export async function backfillAccounting(deps: AppDeps, logger: WorkerLogger) {
  await forEachTenant(deps, (ctx) => accounting.backfill(ctx), logger);
  await postAccounting(deps, logger);
}

/** A plugin's scheduled job (api.schedule) for every shop that has the plugin on (FR-PLG-8). */
export async function runPluginSchedule(deps: AppDeps, logger: WorkerLogger, job: AppDeps['plugins']['schedules'][number]) {
  await forEachTenant(
    deps,
    async (ctx) => {
      if (!(await plugins.pluginConfig(ctx, job.pluginId)).enabled) return;
      await deps.plugins.runSchedule(job, hookContext(ctx));
    },
    logger,
  );
}

export const SCHEDULED = {
  'orders.expire_quotes': { cron: '* * * * *', run: (deps: AppDeps, l: WorkerLogger) => forEachTenant(deps, (ctx) => orders.expireQuotes(ctx), l) },
  'orders.reminders': { cron: '*/15 * * * *', run: (deps: AppDeps, l: WorkerLogger) => forEachTenant(deps, (ctx) => orders.sendReminders(ctx), l) },
  'payments.balance_requests': { cron: '7 * * * *', run: (deps: AppDeps, l: WorkerLogger) => forEachTenant(deps, (ctx) => payments.requestDueBalances(ctx), l) },
  // One reminder to carts left with an email and items, when the shop turned them on (FR-SF-9).
  'storefront.cart_reminders': { cron: '*/15 * * * *', run: (deps: AppDeps, l: WorkerLogger) => forEachTenant(deps, (ctx) => storefront.sendCartReminders(ctx), l) },
  // "Often rented with" from the last year of bookings (FR-CAT-7).
  'currency.rates': { cron: '17 6 * * *', run: (deps: AppDeps, l: WorkerLogger) => forEachTenant(deps, (ctx) => tenancy.refreshRates(ctx), l) },
  'reports.saved': { cron: '*/15 * * * *', run: (deps: AppDeps, l: WorkerLogger) => forEachTenant(deps, (ctx) => reports.queueDueReports(ctx), l) },
  'catalog.often_rented_with': { cron: '41 3 * * 1', run: (deps: AppDeps, l: WorkerLogger) => forEachTenant(deps, (ctx) => catalog.computeOftenRentedWith(ctx), l) },
  // Long rentals billed weekly or monthly while out (FR-OR-11).
  'billing.recurring': { cron: '13 * * * *', run: (deps: AppDeps, l: WorkerLogger) => forEachTenant(deps, (ctx) => orders.billRecurring(ctx), l) },
  // Customers invoiced monthly get last month's finished bookings on one invoice (FR-CUS-7).
  'billing.monthly_invoices': { cron: '23 4 * * *', run: (deps: AppDeps, l: WorkerLogger) => forEachTenant(deps, (ctx) => customers.consolidateMonthly(ctx), l) },
  'deposits.maintenance': { cron: '*/30 * * * *', run: (deps: AppDeps, l: WorkerLogger) => forEachTenant(deps, (ctx) => payments.depositMaintenance(ctx), l) },
  'maintenance.cleanup': {
    cron: '17 3 * * *',
    run: async (deps: AppDeps, l: WorkerLogger) =>
      forEachTenant(
        deps,
        async (ctx) => {
          await ctx.db.query(`DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'`);
          await ctx.db.query(`UPDATE checkout_sessions SET status = 'expired' WHERE status = 'open' AND expires_at < now()`);
          await ctx.db.query(`DELETE FROM outbox WHERE published_at < now() - interval '30 days'`);
        },
        l,
      ),
  },
  'availability.low_stock': {
    cron: '13 * * * *',
    run: (deps: AppDeps, l: WorkerLogger) =>
      forEachTenant(
        deps,
        async (ctx) => {
          const { availability, resolveSettings } = await import('@openrent/core');
          const t = (await ctx.db.query(`SELECT settings FROM tenants WHERE id = $1`, [ctx.tenantId])).rows[0];
          await availability.lowAvailabilityCheck(ctx, resolveSettings(t.settings).low_availability_days_ahead);
        },
        l,
      ),
  },
  // Every 10 minutes: look for the DNS records of custom domains still waiting (FR-SF-1).
  // Every minute: integration tasks that are due, one transaction each (they call other systems).
  'integrations.run': { cron: '* * * * *', run: (deps: AppDeps, l: WorkerLogger) => runIntegrationTasks(deps, l) },
  // Every minute: invoices, credit notes and payments become accounting entries (ADR 0009).
  'accounting.post': { cron: '* * * * *', run: (deps: AppDeps, l: WorkerLogger) => postAccounting(deps, l) },
  // Every 15 minutes: payments recorded in the accounting system come back to their orders (when on).
  'accounting.import_payments': { cron: '*/15 * * * *', run: (deps: AppDeps, l: WorkerLogger) => forEachTenant(deps, (ctx) => integrations.records.importRemotePayments(ctx), l) },
  // Daily: what was sent is compared with what the accounting system holds now.
  'accounting.check': { cron: '41 4 * * *', run: (deps: AppDeps, l: WorkerLogger) => forEachTenant(deps, (ctx) => integrations.records.checkRemote(ctx), l) },
  // Daily: idle OAuth connections refresh their token so it does not lapse (Xero: 60 days).
  'integrations.keep_alive': { cron: '17 3 * * *', run: (deps: AppDeps, l: WorkerLogger) => forEachTenant(deps, (ctx) => integrations.setup.keepAlive(ctx), l) },
  // Daily (FR-MNT-4): overdue services are announced and get a ticket.
  'service.due': { cron: '31 5 * * *', run: (deps: AppDeps, l: WorkerLogger) => forEachTenant(deps, (ctx) => servicing.runServiceDue(ctx), l) },
  'domains.verify': { cron: '*/10 * * * *', run: (deps: AppDeps, l: WorkerLogger) => forEachTenant(deps, (ctx) => domains.verifyPending(ctx), l) },
  'files.verify': {
    cron: '23 4 * * 0',
    // Weekly: a sample of stored files must still exist in the object store.
    run: (deps: AppDeps, l: WorkerLogger) =>
      forEachTenant(
        deps,
        async (ctx) => {
          const missing = await files.verifyStorage(ctx);
          if (missing.length) l.error({ tenant: ctx.tenantId, files: missing }, 'stored files are missing from object storage');
        },
        l,
      ),
  },
  'documents.render_pdfs': {
    cron: '*/5 * * * *',
    // Pre-renders PDFs of recently issued documents so downloads and attachments are instant (FR-DOC-3).
    run: async (deps: AppDeps, l: WorkerLogger) => {
      if (deps.config.pdfRenderer !== 'playwright') return;
      const { documentPdf } = await import('@openrent/api/pdf');
      await forEachTenant(
        deps,
        async (ctx) => {
          const r = await ctx.db.query(
            `SELECT d.id, d.type, d.number, d.html FROM documents d
              WHERE d.issued_at > now() - interval '7 days'
                AND NOT EXISTS (SELECT 1 FROM files f WHERE f.owner_type = 'document' AND f.owner_id = d.id AND f.kind = 'pdf')
              ORDER BY d.issued_at LIMIT 20`,
          );
          for (const doc of r.rows) await documentPdf(ctx, doc);
        },
        l,
      );
    },
  },
  'consistency.check': {
    cron: '41 2 * * *',
    // Nightly availability consistency check (PRD §8.3): pools whose peak allocation exceeds capacity.
    run: async (deps: AppDeps, l: WorkerLogger) =>
      forEachTenant(
        deps,
        async (ctx) => {
          const r = await ctx.db.query(
            `SELECT a.variant_id, a.location_id, count(*)::int AS n FROM allocations a
              WHERE a.kind = 'reservation' AND (upper(a.period) IS NULL OR upper(a.period) > now()) GROUP BY 1, 2`,
          );
          const { availability } = await import('@openrent/core');
          for (const g of r.rows) {
            const res = await availability.check(ctx, { variantId: g.variant_id, locationId: g.location_id, from: new Date(), to: new Date(Date.now() + 365 * 86400_000) });
            if (!res.shortage) continue;
            // Booked past stock on purpose (FR-AV-8) is reported apart from shortages nobody explained.
            const ovb = await ctx.db.query(`SELECT coalesce(sum(quantity), 0)::int AS n FROM overbookings WHERE variant_id = $1 AND location_id = $2 AND resolved_at IS NULL`, [g.variant_id, g.location_id]);
            if (ovb.rows[0].n) l.info({ tenant: ctx.tenantId, variant: g.variant_id, location: g.location_id, overbooked: ovb.rows[0].n }, 'availability: pool overbooked on purpose');
            else l.warn({ tenant: ctx.tenantId, variant: g.variant_id, location: g.location_id }, 'availability shortage: allocations exceed capacity');
          }
          const stale = await ctx.db.query(`SELECT count(*)::int AS n FROM payment_intents WHERE status IN ('requires_payment','processing') AND created_at < now() - interval '1 day'`);
          if (stale.rows[0].n) l.warn({ tenant: ctx.tenantId, count: stale.rows[0].n }, 'payment intents pending for more than a day');
          // Our ledger against the payment provider (FR-PAY-7).
          const rec = await payments.reconcilePayments(ctx);
          if (rec.issues) l.warn({ tenant: ctx.tenantId, ...rec }, 'payment reconciliation found differences');
        },
        l,
      ),
  },
} as const;
