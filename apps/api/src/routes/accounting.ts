import { accounting, integrations, plugins, serverT, tenancy, AppError } from '@openrent/core';
import type { Router } from '../http.ts';
import { rowsSheet, sendSheet } from '../spreadsheets.ts';
import { IdParams, Json, Nullable, Type } from '../schemas.ts';

/**
 * Accounting (FR-INT-3, ADR 0009): the shop's accounting system (connect, organisation, account
 * mapping, start and pause), what reached the books (records, sync log, resend, mark as handled), the
 * booked entries and their journal export, and the shop's own accounting settings.
 */
export function registerAccounting(r: Router) {
  const { deps } = r;
  const A = ['Accounting'];
  const redirectUri = `${deps.config.publicUrl}${integrations.callbackPath}`;
  const READ = 'accounting:read';
  const MANAGE = 'accounting:manage';

  /** The shop's live accounting connection, or a 409 explaining there is none. */
  const liveId = async (ctx: Parameters<typeof integrations.setup.accountingConnection>[0]) => {
    const live = await integrations.setup.accountingConnection(ctx);
    if (!live) throw new AppError('accounting_not_connected', 409, serverT('integrations.accounting_not_connected'));
    return live.c.id as string;
  };
  const accountingProvider = (ctx: { plugins: { integration(id: string): { category: string } | undefined } }, id: string) => {
    if (ctx.plugins.integration(id)?.category !== 'accounting') throw new AppError('not_found', 404, `No accounting system ${id}`);
  };

  r.get('/accounting/overview', { permission: READ, tags: A, summary: 'Connection, what is waiting or failed, and a month’s booked totals by kind', querystring: Type.Object({ month: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}$' })) }) }, async (ctx, req) =>
    integrations.records.overview(ctx, req.query.month),
  );
  r.get('/accounting/systems', { permission: READ, tags: A, summary: 'Accounting systems that can be connected, with the shop’s connection' }, async (ctx) => ({
    object: 'list',
    data: (await integrations.listIntegrations(ctx))
      .filter((i) => i.category === 'accounting')
      // The app credentials the shop may enter itself (values are never sent back); test-only URLs stay hidden.
      .map((i) => ({ ...i, app_fields: (deps.plugins.statuses.find((p) => p.id === i.plugin_id)?.settings ?? []).filter((f) => !/base_url$/.test(f.key)) })),
    redirect_uri: redirectUri,
  }));
  r.post(
    '/accounting/systems/:id/app',
    {
      permission: MANAGE, tags: A, summary: 'Save the app credentials (client id and secret, data centre) when the operator did not set them', params: IdParams, status: 200,
      body: Type.Object({ config: Type.Record(Type.String(), Type.Union([Type.String({ maxLength: 500 }), Type.Null()])) }, { additionalProperties: false }),
    },
    async (ctx, req) => {
      accountingProvider(ctx, req.params.id);
      const pluginId = ctx.plugins.pluginIdOf(req.params.id) ?? req.params.id;
      await plugins.updatePlugin(ctx, deps.plugins.statuses, pluginId, { config: req.body.config });
      return (await integrations.listIntegrations(ctx)).find((i) => i.id === req.params.id);
    },
  );
  r.post(
    '/accounting/systems/:id/connect',
    {
      permission: MANAGE, tags: A, summary: 'Connect: returns the system’s sign-in URL', params: IdParams, status: 200,
      body: Type.Object({ credentials: Type.Optional(Type.Record(Type.String(), Type.String({ maxLength: 2000 }))) }, { additionalProperties: false }),
    },
    async (ctx, req) => {
      accountingProvider(ctx, req.params.id);
      return integrations.connect(ctx, req.params.id, { credentials: req.body?.credentials, redirect_uri: redirectUri });
    },
  );

  r.get('/accounting/connection', { permission: READ, tags: A, summary: 'The shop’s accounting connection, or null' }, async (ctx) => {
    const live = await integrations.setup.accountingConnection(ctx);
    return live ? integrations.connectionToApi(live.c, live.p) : null;
  });
  r.delete('/accounting/connection', { permission: MANAGE, tags: A, summary: 'Disconnect the accounting system (entries stay; nothing more is sent)' }, async (ctx) => integrations.disconnect(ctx, await liveId(ctx)));
  r.patch('/accounting/connection', { permission: MANAGE, tags: A, summary: 'Change the connection’s settings (invoice status, attachments, payments recorded there)', body: Type.Object({ settings: Json }, { additionalProperties: false }) }, async (ctx, req) =>
    integrations.updateSettings(ctx, await liveId(ctx), req.body.settings),
  );
  r.get('/accounting/connection/lookups', { permission: MANAGE, tags: A, summary: 'Accounts, tax rates, items and payment accounts of the connected organisation', querystring: Type.Object({ refresh: Type.Optional(Type.Boolean()) }) }, async (ctx, req) => ({
    object: 'lookups',
    ...(await integrations.setup.lookups(ctx, await liveId(ctx), req.query.refresh === true)),
  }));
  r.put(
    '/accounting/connection/mapping',
    { permission: MANAGE, tags: A, summary: 'Map OpenRent’s accounts and tax rates to the organisation’s', body: Type.Object({ mapping: Type.Record(Type.String(), Type.Union([Type.String({ maxLength: 200 }), Type.Null()])) }, { additionalProperties: false }) },
    async (ctx, req) => integrations.setup.saveMapping(ctx, await liveId(ctx), req.body.mapping),
  );
  r.get('/accounting/connection/check', { permission: MANAGE, tags: A, summary: 'Whether the mapping is complete and still fits; the errors say what to fix' }, async (ctx) => integrations.setup.setupCheck(ctx, await liveId(ctx)));
  r.post(
    '/accounting/connection/actions/start_sync',
    { permission: MANAGE, tags: A, summary: 'Start sending entries from a date', status: 200, body: Type.Object({ from: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }) }, { additionalProperties: false }) },
    async (ctx, req) => integrations.setup.startSync(ctx, await liveId(ctx), req.body),
  );
  r.post('/accounting/connection/actions/pause_sync', { permission: MANAGE, tags: A, summary: 'Stop sending for now', status: 200 }, async (ctx) => integrations.setup.pauseSync(ctx, await liveId(ctx)));
  r.post(
    '/accounting/connection/actions/choose_organisation',
    { permission: MANAGE, tags: A, summary: 'Switch to another organisation of the same sign-in (mapping starts over)', status: 200, body: Type.Object({ organisation_id: Type.String({ minLength: 1, maxLength: 200 }) }, { additionalProperties: false }) },
    async (ctx, req) => integrations.setup.chooseOrganisation(ctx, await liveId(ctx), req.body.organisation_id),
  );
  r.get(
    '/accounting/connection/tasks',
    { permission: READ, tags: A, summary: 'The sync log, newest first', querystring: Type.Object({ status: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) }) },
    async (ctx, req) => ({ object: 'list', data: await integrations.listTasks(ctx, await liveId(ctx), req.query) }),
  );
  r.post('/accounting/tasks/:id/actions/retry', { permission: MANAGE, tags: A, summary: 'Try a sync task again now', params: IdParams, status: 200 }, async (ctx, req) => integrations.retryTask(ctx, req.params.id));

  r.get(
    '/accounting/records',
    {
      permission: READ, tags: A, summary: 'Booked entries with their sync status and the record each became in the accounting system',
      querystring: Type.Object({
        kind: Type.Optional(Type.String()), status: Type.Optional(Type.String()), from: Type.Optional(Type.String({ format: 'date' })), to: Type.Optional(Type.String({ format: 'date' })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
      }),
    },
    async (ctx, req) => {
      await accounting.postPending(ctx);
      return integrations.records.listRecords(ctx, req.query);
    },
  );
  r.post('/accounting/records/:id/actions/resend', { permission: MANAGE, tags: A, summary: 'Send an entry again now', params: IdParams, status: 200 }, async (ctx, req) => integrations.records.resend(ctx, req.params.id));
  r.post(
    '/accounting/records/:id/actions/mark_handled',
    { permission: MANAGE, tags: A, summary: 'Record that staff booked this entry by hand; nothing more is sent for it', params: IdParams, status: 200, body: Type.Object({ note: Type.Optional(Type.String({ maxLength: 500 })) }, { additionalProperties: false }) },
    async (ctx, req) => integrations.records.markHandled(ctx, req.params.id, req.body?.note),
  );
  r.get('/accounting/entries/:id', { permission: READ, tags: A, summary: 'One booked entry with its lines', params: IdParams }, async (ctx, req) => accounting.getEntry(ctx, req.params.id));

  r.patch(
    '/accounting/settings',
    {
      permission: MANAGE, tags: A, summary: 'Account codes, the lock date and when invoices are issued automatically',
      body: Type.Object(
        {
          accounts: Type.Optional(Type.Record(Type.String(), Type.String({ maxLength: 40 }))),
          locked_until: Type.Optional(Nullable(Type.String())),
          invoice_when: Type.Optional(Type.Union([Type.Literal('manual'), Type.Literal('reserved'), Type.Literal('checked_out'), Type.Literal('closed')])),
        },
        { additionalProperties: false },
      ),
    },
    async (ctx, req) => (await tenancy.updateSettings(ctx, { accounting: req.body })).accounting,
  );

  r.get(
    '/accounting/journal',
    {
      permission: READ, tags: A, summary: 'Double-entry journal of the booked entries (amounts in minor units; CSV and XLSX in major units)', raw: true,
      querystring: Type.Object({ from: Type.String(), to: Type.String(), format: Type.Optional(Type.Union([Type.Literal('json'), Type.Literal('csv'), Type.Literal('xlsx')])) }),
    },
    async (ctx, req, reply) => {
      const rows = await accounting.journal(ctx, req.query);
      if (!req.query.format || req.query.format === 'json') return reply.send({ object: 'list', data: rows });
      const major = (n: number, cur: string) => {
        const digits = new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits ?? 2;
        return n ? (n / 10 ** digits).toFixed(digits) : '';
      };
      // An empty period still gets its header row.
      const sheet = rows.length
        ? rowsSheet(rows.map((x) => ({ ...x, debit: major(x.debit, x.currency), credit: major(x.credit, x.currency) })))
        : { headers: ['date', 'number', 'entry', 'account', 'description', 'debit', 'credit', 'currency'], rows: [] };
      return sendSheet(reply, sheet, 'journal', req.query.format);
    },
  );
}
