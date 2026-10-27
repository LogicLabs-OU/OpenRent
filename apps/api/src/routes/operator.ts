import { timingSafeEqual } from 'node:crypto';
import { eraseTenant, withSystem, withTenant } from '@openrent/db';
import { AppError, files, serverT, tenancy } from '@openrent/core';
import type { FastifyRequest } from 'fastify';
import type { Router } from '../http.ts';
import { systemCtx } from '../context.ts';
import { forgetShopStatus } from '../auth.ts';
import { IdParams, Nullable, Type } from '../schemas.ts';

/**
 * The installation operator's API (managed cloud, PRD §10.1): every shop with its usage, limits,
 * suspending, resuming and erasing a shop. Only with `OPENRENT_OPERATOR_KEY` set, sent as
 * `X-Operator-Key`; shop staff and API keys never reach it.
 */
export function registerOperator(r: Router) {
  const { deps } = r;
  const O = ['Operator'];
  const guard = (req: FastifyRequest) => {
    const key = deps.config.operatorKey;
    if (!key) throw new AppError('not_found', 404, serverT('error.operator_disabled'));
    const given = Buffer.from(String(req.headers['x-operator-key'] ?? ''));
    const want = Buffer.from(key);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw new AppError('unauthorized', 401, serverT('error.operator_key_required'));
  };
  const Limits = Type.Object(
    { orders_per_month: Type.Optional(Nullable(Type.Integer({ minimum: 0 }))), storage_mb: Type.Optional(Nullable(Type.Integer({ minimum: 0 }))), plugins: Type.Optional(Nullable(Type.Integer({ minimum: 0 }))) },
    { additionalProperties: false },
  );
  const opts = { public: true, tx: 'none' as const, tags: O, rateLimit: { max: 60, timeWindow: '1 minute' } };

  r.get('/operator/shops', { ...opts, summary: 'Every shop with its status, limits and usage this month' }, async (_c, req) => {
    guard(req);
    return { object: 'list', data: await withSystem(deps.db, (c) => tenancy.listShops(c)) };
  });
  r.patch('/operator/shops/:id', { ...opts, summary: 'Set a shop’s limits (null removes one)', params: IdParams, body: Type.Object({ limits: Limits }, { additionalProperties: false }) }, async (_c, req) => {
    guard(req);
    return withSystem(deps.db, (c) => tenancy.setLimits(c, req.params.id, req.body.limits));
  });
  r.post('/operator/shops/:id/actions/suspend', { ...opts, summary: 'Suspend a shop: admin and storefront answer "suspended"; nothing is deleted', params: IdParams, body: Type.Object({ reason: Type.Optional(Nullable(Type.String({ maxLength: 500 }))) }), status: 200 }, async (_c, req) => {
    guard(req);
    const out = await withSystem(deps.db, (c) => tenancy.suspendShop(c, req.params.id, req.body.reason ?? null));
    forgetShopStatus(req.params.id);
    return out;
  });
  r.post('/operator/shops/:id/actions/resume', { ...opts, summary: 'Resume a suspended shop', params: IdParams, status: 200 }, async (_c, req) => {
    guard(req);
    const out = await withSystem(deps.db, (c) => tenancy.resumeShop(c, req.params.id));
    forgetShopStatus(req.params.id);
    return out;
  });
  r.delete(
    '/operator/shops/:id',
    { ...opts, summary: 'Erase a suspended shop and all its data for good; `confirm` must be its slug', params: IdParams, querystring: Type.Object({ confirm: Type.String() }), raw: true },
    async (_c, req, reply) => {
      guard(req);
      const shop = (await withSystem(deps.db, (c) => c.query(`SELECT id, slug, status FROM tenants WHERE id = $1`, [req.params.id]))).rows[0];
      if (!shop) throw new AppError('not_found', 404, serverT('error.shop_not_found'));
      if (shop.status !== 'suspended') throw new AppError('not_suspended', 409, serverT('error.erase_suspend_first'));
      if (req.query.confirm !== shop.slug) throw new AppError('confirm_mismatch', 422, serverT('error.erase_confirm'));
      // Stored files first (object storage keeps no link to the database), then every row.
      const stored = await withTenant(deps.db, shop.id, (c) => c.query(`SELECT storage, key FROM files WHERE storage <> 'database' AND key IS NOT NULL`));
      for (const f of stored.rows) {
        await withTenant(deps.db, shop.id, (c) => files.purgeStored(systemCtx(deps, c, shop.id, req.log), f)).catch((err) => req.log.warn({ err, key: f.key }, 'stored file could not be removed'));
      }
      const out = await eraseTenant(deps.config.databaseMigrationUrl, shop.id, (m) => req.log.info(m));
      forgetShopStatus(shop.id);
      return reply.send({ object: 'erased_shop', id: shop.id, slug: shop.slug, rows: out.rows, files: stored.rowCount });
    },
  );
}
