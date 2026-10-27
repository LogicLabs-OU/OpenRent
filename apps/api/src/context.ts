import type { FastifyRequest } from 'fastify';
import type { Ctx, Queryable } from '@openrent/core';
import type { AppDeps } from './deps.ts';

export function coreConfig(deps: AppDeps): Ctx['config'] {
  return {
    publicUrl: deps.config.publicUrl, adminUrl: deps.config.adminUrl, storefrontUrl: deps.config.storefrontUrl, storefrontDomain: deps.config.storefrontDomain, livemode: deps.config.livemode, multiTenant: deps.config.mode === 'multi_tenant',
    renderPdf: deps.config.pdfRenderer === 'playwright' ? async (html) => (await import('./pdf.ts')).renderPdf(html) : undefined,
  };
}

/** One Ctx per transaction attempt; `now` is taken here so retries see a fresh clock. */
export function makeCtx(deps: AppDeps, db: Queryable, req: FastifyRequest): Ctx {
  const auth = req.auth!;
  return {
    db,
    tenantId: auth.tenantId!,
    actor: auth.actor,
    now: new Date(),
    requestId: String(req.id),
    idempotencyKey: req.headers['idempotency-key'] ? String(req.headers['idempotency-key']) : undefined,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    plugins: deps.plugins,
    secrets: deps.secrets,
    config: coreConfig(deps),
    logger: req.log as any,
  };
}

export function systemCtx(deps: AppDeps, db: Queryable, tenantId: string, logger: any): Ctx {
  return {
    db,
    tenantId,
    actor: { type: 'system', id: null },
    now: new Date(),
    plugins: deps.plugins,
    secrets: deps.secrets,
    config: coreConfig(deps),
    logger,
  };
}
