import type { FastifyInstance } from 'fastify';
import { customers, notifications, payments, plugins, rfid, signatures, storefront, AppError, serverT } from '@openrent/core';
import { withSystem, withTenant } from '@openrent/db';
import type { AppDeps } from '../deps.ts';
import { systemCtx } from '../context.ts';

/**
 * Inbound provider webhooks on a tenant-scoped URL: POST /webhooks/{provider}/{tenant_id} (PRD §6.6).
 * The raw body is kept for signature verification. Replays and unknown events answer 200.
 */
export async function registerInbound(app: FastifyInstance, deps: AppDeps) {
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer' }, (req, body, done) => {
      req.rawBody = body as Buffer;
      done(null, null);
    });
    scope.post('/webhooks/:provider/:tenant', { schema: { hide: true } as any }, async (req, reply) => {
      const { provider, tenant } = req.params as { provider: string; tenant: string };
      const exists = await withSystem(deps.db, (c) => c.query(`SELECT 1 FROM tenants WHERE id = $1`, [tenant]));
      if (!exists.rows.length) throw new AppError('unknown_tenant', 404, serverT('error.unknown_tenant'));
      const result = await withTenant(deps.db, tenant, async (c) => {
        const ctx = systemCtx(deps, c, tenant, req.log);
        const pc = await payments.providerContext(ctx, provider);
        const ev = await pc.provider.handleWebhook(pc.pctx, { rawBody: req.rawBody ?? Buffer.alloc(0), headers: req.headers });
        return payments.applyProviderEvent(ctx, provider, ev, { onRentalPaid: (orderId) => storefront.confirmPaidOrder(ctx, orderId) });
      });
      return reply.send({ received: true, duplicate: result.duplicate });
    });
    // Delivery reports from email and text message plugins (FR-NOT-5): delivered, bounced, complained,
    // failed. Some text providers report with a GET and a query string.
    const notify = async (req: any, reply: any) => {
      const { plugin, tenant } = req.params as { plugin: string; tenant: string };
      const exists = await withSystem(deps.db, (c) => c.query(`SELECT 1 FROM tenants WHERE id = $1`, [tenant]));
      if (!exists.rows.length) throw new AppError('unknown_tenant', 404, serverT('error.unknown_tenant'));
      const channel = (['email', 'sms', 'whatsapp'] as const)
        .flatMap((k) => deps.plugins.notificationChannels(k))
        .find((ch) => (deps.plugins.pluginIdOf(ch.id) ?? ch.id) === plugin && ch.handleWebhook);
      if (!channel?.handleWebhook) throw new AppError('not_found', 404, serverT('plugins.not_installed', { id: plugin }));
      const query = String(req.url).includes('?') ? String(req.url).slice(String(req.url).indexOf('?') + 1) : '';
      const updated = await withTenant(deps.db, tenant, async (c) => {
        const ctx = systemCtx(deps, c, tenant, req.log);
        const { config } = await plugins.pluginConfig(ctx, plugin);
        const pctx = { tenantId: tenant, config, logger: req.log, webhookUrl: notifications.textWebhookUrl(ctx, plugin) };
        const reports = await channel.handleWebhook!(pctx, { rawBody: req.rawBody ?? Buffer.alloc(0), headers: req.headers, method: req.method, query });
        return notifications.applyDeliveryReports(ctx, plugin, reports);
      });
      return reply.send({ received: true, updated });
    };
    // Signing services report signed and declined requests (plugin API 1.9).
    scope.post('/webhooks/sign/:plugin/:tenant', { schema: { hide: true } as any }, async (req, reply) => {
      const { plugin, tenant } = req.params as { plugin: string; tenant: string };
      const exists = await withSystem(deps.db, (c) => c.query(`SELECT 1 FROM tenants WHERE id = $1`, [tenant]));
      if (!exists.rows.length) throw new AppError('unknown_tenant', 404, serverT('error.unknown_tenant'));
      const provider = (deps.plugins.signatureProviders?.() ?? []).find((p) => (deps.plugins.pluginIdOf(p.id) ?? p.id) === plugin);
      if (!provider?.handleWebhook) throw new AppError('not_found', 404, serverT('plugins.not_installed', { id: plugin }));
      const status = await withTenant(deps.db, tenant, async (c) => {
        const ctx = systemCtx(deps, c, tenant, req.log);
        const { config } = await plugins.pluginConfig(ctx, plugin);
        const update = await provider.handleWebhook!({ tenantId: tenant, config, logger: req.log, webhookUrl: signatures.signatureWebhookUrl(ctx, plugin) }, { rawBody: req.rawBody ?? Buffer.alloc(0), headers: req.headers });
        return update ? signatures.applyExternalSignature(ctx, provider.id, update) : null;
      });
      return reply.send({ received: true, status });
    });
    // ID check services report verified and failed sessions (plugin API 1.9).
    // RFID reads (FR-SCAN-7): the reader's own address; its token in the Authorization header, or ?token=
    // for readers that cannot send headers.
    scope.post('/webhooks/rfid/:reader', { schema: { hide: true } as any }, async (req, reply) => {
      const { reader } = req.params as { reader: string };
      const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || String((req.query as Record<string, string>).token ?? '');
      const row = await withSystem(deps.db, (c) => rfid.readerForToken({ db: c }, reader, token));
      if (!row) return reply.code(401).send({ code: 'invalid_token', message: serverT('rfid.invalid_token') });
      const kept = await withTenant(deps.db, row.tenant_id, async (c) => {
        const ctx = systemCtx(deps, c, row.tenant_id, req.log);
        const reads = await rfid.parseReads(ctx, row.format, { headers: req.headers, rawBody: req.rawBody ?? Buffer.alloc(0) });
        return rfid.storeReads(ctx, row, reads);
      });
      return reply.send({ object: 'rfid_reads_received', kept });
    });

    scope.post('/webhooks/identity/:plugin/:tenant', { schema: { hide: true } as any }, async (req, reply) => {
      const { plugin, tenant } = req.params as { plugin: string; tenant: string };
      const exists = await withSystem(deps.db, (c) => c.query(`SELECT 1 FROM tenants WHERE id = $1`, [tenant]));
      if (!exists.rows.length) throw new AppError('unknown_tenant', 404, serverT('error.unknown_tenant'));
      const provider = (deps.plugins.identityProviders?.() ?? []).find((p) => (deps.plugins.pluginIdOf(p.id) ?? p.id) === plugin);
      if (!provider?.handleWebhook) throw new AppError('not_found', 404, serverT('plugins.not_installed', { id: plugin }));
      const status = await withTenant(deps.db, tenant, async (c) => {
        const ctx = systemCtx(deps, c, tenant, req.log);
        const { config } = await plugins.pluginConfig(ctx, plugin);
        const update = await provider.handleWebhook!({ tenantId: tenant, config, logger: req.log, webhookUrl: customers.identityWebhookUrl(ctx, plugin) }, { rawBody: req.rawBody ?? Buffer.alloc(0), headers: req.headers });
        return update ? customers.applyIdentityResult(ctx, provider.id, update) : null;
      });
      return reply.send({ received: true, status });
    });
    scope.post('/webhooks/notify/:plugin/:tenant', { schema: { hide: true } as any }, notify);
    scope.get('/webhooks/notify/:plugin/:tenant', { schema: { hide: true } as any }, notify);
  });
}
