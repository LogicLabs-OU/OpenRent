import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { newId, AppError, assertCan, pluginScope, serverT } from '@openrent/core';
import { withTenant } from '@openrent/db';
import type { AppDeps } from './deps.ts';
import { registerAuth } from './auth.ts';
import { errorHandler, problem } from './errors.ts';
import { Router } from './http.ts';
import { registerSystem } from './routes/system.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerTenant } from './routes/tenant.ts';
import { registerCatalog } from './routes/catalog.ts';
import { registerInventory } from './routes/inventory.ts';
import { registerCustomers } from './routes/customers.ts';
import { registerOrders } from './routes/orders.ts';
import { registerCancellations } from './routes/cancellations.ts';
import { registerDeliveries } from './routes/deliveries.ts';
import { registerTransfers } from './routes/transfers.ts';
import { registerInspections } from './routes/inspections.ts';
import { registerServicing } from './routes/servicing.ts';
import { registerSignatures } from './routes/signatures.ts';
import { registerSso } from './routes/sso.ts';
import { registerIntegrations } from './routes/integrations.ts';
import { registerAccounting } from './routes/accounting.ts';
import { registerCalendar } from './routes/calendar.ts';
import { registerDocuments } from './routes/documents.ts';
import { registerWebhooks } from './routes/webhooks.ts';
import { registerReports } from './routes/reports.ts';
import { registerStorefront } from './routes/storefront.ts';
import { registerInbound } from './routes/inbound.ts';
import { registerExtensions } from './routes/extensions.ts';
import { registerFiles, MAX_UPLOAD_MB } from './routes/files.ts';
import { registerImports } from './routes/imports.ts';
import { registerWarehouse } from './routes/warehouse.ts';
import { registerAttachments } from './routes/attachments.ts';
import { registerCustomFields } from './routes/customfields.ts';
import { registerMe } from './routes/me.ts';
import { registerJobs } from './routes/jobs.ts';
import { registerDomains } from './routes/domains.ts';
import { registerStrings } from './routes/strings.ts';
import { makeCtx } from './context.ts';
import { Money } from './schemas.ts';

export async function buildApp(deps: AppDeps, opts: { logger?: boolean | object } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? { level: deps.config.logLevel },
    trustProxy: deps.config.trustProxy,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : newId('req');
    },
    requestIdHeader: false,
    bodyLimit: 2 * 1024 * 1024,
    ajv: { customOptions: { coerceTypes: 'array', removeAdditional: false, useDefaults: true, allErrors: false } },
  });

  // Response schemas document the API; serialisation never drops fields.
  app.setSerializerCompiler(() => (data) => JSON.stringify(data));
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/admin') && deps.config.adminDist) return reply.sendFile('index.html', deps.config.adminDist);
    reply.status(404).type('application/problem+json').send(problem(404, 'route_not_found', `No route for ${req.method} ${req.url.split('?')[0]}`, req));
  });
  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Request-Id', req.id);
  });

  await app.register(cookie, { secret: deps.config.sessionSecret });
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 10 }, throwFileSizeLimit: true });
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      // Storefront and widget calls come from merchant sites; they never use cookies.
      cb(null, deps.config.corsOrigins.includes(origin) ? origin : '*');
    },
    credentials: false,
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'If-Match', 'X-Tenant-Slug', 'X-Request-Id'],
    exposedHeaders: ['ETag', 'X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Idempotent-Replayed'],
  });
  await app.register(rateLimit, {
    global: true,
    max: deps.config.rateLimitPerMinute,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.headers.authorization?.slice(0, 40) ?? req.cookies?.or_session?.slice(0, 16) ?? req.ip,
    addHeadersOnExceeding: { 'x-ratelimit-limit': false, 'x-ratelimit-remaining': false, 'x-ratelimit-reset': false },
    addHeaders: { 'x-ratelimit-limit': false, 'x-ratelimit-remaining': false, 'x-ratelimit-reset': false, 'retry-after': true },
    errorResponseBuilder: (req, ctx) => ({ ...problem(429, 'rate_limited', `Rate limit of ${ctx.max} per ${ctx.after} exceeded`, req), statusCode: 429 }),
  });
  app.addHook('onSend', async (req, reply) => {
    const limit = (req as any).routeOptions?.config?.rateLimit?.max ?? deps.config.rateLimitPerMinute;
    reply.header('RateLimit-Limit', limit);
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'OpenRent API',
        version: deps.version,
        description:
          'Every OpenRent feature is available here; the back office and storefront use the same endpoints. Money is `{amount, currency}` in minor units. Errors are RFC 9457 problem details with a stable `code`. POST requests accept `Idempotency-Key`.',
        license: { name: 'Apache-2.0 (spec), AGPL-3.0-only (server)' },
      },
      servers: [{ url: deps.config.publicUrl }],
      components: {
        securitySchemes: {
          sessionCookie: { type: 'apiKey', in: 'cookie', name: 'or_session', description: 'Back office session; state-changing requests also need X-CSRF-Token' },
          secretKey: { type: 'http', scheme: 'bearer', description: 'sk_live_... secret API key with scopes' },
          publishableKey: { type: 'http', scheme: 'bearer', description: 'pk_live_... key, storefront namespace only' },
          tenantSlug: { type: 'apiKey', in: 'header', name: 'X-Tenant-Slug', description: 'Storefront only: identifies the shop' },
        },
      },
      tags: [
        { name: 'Orders' }, { name: 'Products' }, { name: 'Inventory' }, { name: 'Availability' }, { name: 'Pricing' }, { name: 'Customers' }, { name: 'Payments' },
        { name: 'Documents' }, { name: 'Notifications' }, { name: 'Webhooks' }, { name: 'Reports' }, { name: 'Storefront' }, { name: 'Labels & scanning' },
        { name: 'Tenant' }, { name: 'Locations' }, { name: 'Users' }, { name: 'API keys' }, { name: 'Auth' }, { name: 'Setup' }, { name: 'Audit' }, { name: 'Plugins' }, { name: 'System' },
      ],
    },
    refResolver: { buildLocalReference: (json, _base, _frag, i) => String((json as any).$id ?? `def-${i}`) },
  });
  app.addSchema(Money);

  registerAuth(app, deps);
  const r = new Router(app, deps);
  registerSystem(r);
  registerAuthRoutes(r);
  registerTenant(r);
  registerCatalog(r);
  registerInventory(r);
  registerCustomers(r);
  registerOrders(r);
  registerCancellations(r);
  registerDeliveries(r);
  registerTransfers(r);
  registerInspections(r);
  registerServicing(r);
  registerSignatures(r);
  registerSso(r);
  registerIntegrations(r);
  registerAccounting(r);
  registerCalendar(r);
  registerDocuments(r);
  registerWebhooks(r);
  registerReports(r);
  registerStorefront(r);
  registerExtensions(r);
  registerFiles(r);
  registerImports(r);
  registerWarehouse(r);
  registerAttachments(r);
  registerCustomFields(r);
  registerMe(r);
  registerJobs(r);
  registerDomains(r);
  registerStrings(r);
  await registerInbound(app, deps);

  // Plugin routes under /api/v1/plugins/{id}/... with the same auth (FR-PLG-3).
  for (const { pluginId, handler: route } of deps.plugins.routes) {
    app.route({
      method: route.method,
      url: `/api/v1/plugins/${pluginId}${route.path.startsWith('/') ? '' : '/'}${route.path}`,
      schema: { tags: ['Plugins'], summary: `${pluginId}: ${route.method} ${route.path}` },
      handler: async (req) => {
        if (!req.auth?.tenantId || !['session', 'secret_key'].includes(req.auth.kind)) throw new AppError('unauthorized', 401, serverT('error.sign_in_or_send_an_api_key'));
        if (route.permission) assertCan(req.auth.actor, route.permission as any);
        // A shop that turned the plugin off does not have its routes.
        if (!deps.plugins.isEnabledFor(req.auth.tenantId, pluginId)) throw new AppError('not_found', 404, serverT('plugins.not_installed', { id: pluginId }));
        return withTenant(deps.db, req.auth.tenantId, async (c) => {
          const ctx = makeCtx(deps, c, req);
          return route.handler({ tenantId: ctx.tenantId, actor: ctx.actor, params: req.params as any, query: req.query as any, body: req.body }, { tenantId: ctx.tenantId, actor: ctx.actor, logger: ctx.logger, scope: pluginScope(ctx, pluginId) });
        });
      },
    });
  }

  app.get('/api/v1/openapi.json', { schema: { hide: true } as any }, async () => app.swagger());
  const scalar = (await import('@scalar/fastify-api-reference')).default;
  await app.register(scalar, { routePrefix: '/docs', configuration: { url: '/api/v1/openapi.json', title: 'OpenRent API' } } as any);

  if (deps.config.adminDist && existsSync(path.join(deps.config.adminDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: deps.config.adminDist,
      prefix: '/admin/',
      decorateReply: true,
      wildcard: true,
      maxAge: '1h',
      // Hashed assets never change; the page and the service worker must be checked on every load (FR-SCAN-2).
      setHeaders: (res: any, file: string) => {
        if (file.includes(`${path.sep}_app${path.sep}immutable${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else if (file.endsWith('service-worker.js') || file.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Service-Worker-Allowed', '/admin/');
          // A meta-tag policy cannot forbid framing; the back office is never shown inside another site.
          if (file.endsWith('.html')) res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
        }
      },
    });
    app.get('/admin', (_req, reply) => reply.redirect('/admin/'));
  } else {
    app.get('/admin*', async (_req, reply) => reply.type('text/html').send('<!doctype html><title>OpenRent</title><p>The back office is served by the admin dev server in development (<code>pnpm dev</code>, port 7071) or from ADMIN_DIST in production.</p>'));
  }
  if (deps.config.widgetDist && existsSync(path.join(deps.config.widgetDist, 'openrent-widget.js'))) {
    // Embeddable widget bundle for merchant sites (FR-SF-2).
    await app.register(fastifyStatic, { root: deps.config.widgetDist, prefix: '/widget/', decorateReply: false, maxAge: '1h', setHeaders: (res: any) => res.setHeader('Access-Control-Allow-Origin', '*') });
  }
  app.get('/', async (_req, reply) => reply.redirect(deps.config.adminDist ? '/admin/' : '/docs'));
  return app;
}
