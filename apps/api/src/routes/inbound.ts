import type { FastifyInstance } from 'fastify';
import { notifications, payments, plugins, storefront, AppError, serverT } from '@openrent/core';
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
    // Delivery reports from email plugins (FR-NOT-5): delivered, bounced, complained.
    scope.post('/webhooks/notify/:plugin/:tenant', { schema: { hide: true } as any }, async (req, reply) => {
      const { plugin, tenant } = req.params as { plugin: string; tenant: string };
      const exists = await withSystem(deps.db, (c) => c.query(`SELECT 1 FROM tenants WHERE id = $1`, [tenant]));
      if (!exists.rows.length) throw new AppError('unknown_tenant', 404, serverT('error.unknown_tenant'));
      const channel = deps.plugins.notificationChannels('email').find((ch) => (deps.plugins.pluginIdOf(ch.id) ?? ch.id) === plugin);
      if (!channel?.handleWebhook) throw new AppError('not_found', 404, serverT('plugins.not_installed', { id: plugin }));
      const updated = await withTenant(deps.db, tenant, async (c) => {
        const ctx = systemCtx(deps, c, tenant, req.log);
        const { config } = await plugins.pluginConfig(ctx, plugin);
        const reports = await channel.handleWebhook!({ tenantId: tenant, config, logger: req.log }, { rawBody: req.rawBody ?? Buffer.alloc(0), headers: req.headers });
        return notifications.applyDeliveryReports(ctx, plugin, reports);
      });
      return reply.send({ received: true, updated });
    });
  });
}
