import { withSystem } from '@openrent/db';
import { AppError, domains, serverT, tenancy } from '@openrent/core';
import type { Router } from '../http.ts';
import { Type } from '../schemas.ts';

const started = Date.now();
const counters = { requests: 0, errors: 0 };

export function registerSystem(r: Router) {
  const { app, deps } = r;
  app.addHook('onResponse', async (_req, reply) => {
    counters.requests++;
    if (reply.statusCode >= 500) counters.errors++;
  });

  r.get('/system/health', { public: true, tx: 'none', tags: ['System'], summary: 'Liveness', response: { 200: Type.Object({ status: Type.String() }) } }, async () => ({ status: 'ok' }));

  // raw: the handler sets 503 itself (the router would answer 200 for a returned body).
  r.get('/system/ready', { public: true, tx: 'none', raw: true, tags: ['System'], summary: 'Readiness (database, object storage, plugins, outbox backlog)' }, async (_c, _req, reply) => {
    try {
      const out = await withSystem(deps.db, async (c) => {
        const backlog = (await c.query(`SELECT count(*)::int AS n FROM outbox WHERE published_at IS NULL`)).rows[0].n;
        const migrations = (await c.query(`SELECT count(*)::int AS n FROM schema_migrations`)).rows[0].n;
        return { backlog, migrations };
      });
      // Object storage set up by the operator (S3_* defaults) must answer; shop-level settings are checked per use.
      let storage = 'database';
      const sp = deps.plugins.storageProvider();
      if (sp) {
        const pctx = { tenantId: 'system', config: deps.plugins.defaultConfig(deps.plugins.pluginIdOf(sp.id) ?? sp.id), logger: app.log };
        if (sp.isConfigured(pctx)) {
          try {
            await sp.head?.(pctx, 'openrent-ready-probe');
            storage = 'ok';
          } catch (err: any) {
            return reply.status(503).send({ status: 'not_ready', database: 'ok', storage: 'error', error: String(err?.message ?? err) });
          }
        }
      }
      return reply.send({ status: 'ready', database: 'ok', storage, migrations_applied: out.migrations, outbox_backlog: out.backlog, plugins: deps.plugins.statuses.map((p) => ({ id: p.id, state: p.state })) });
    } catch (err: any) {
      return reply.status(503).send({ status: 'not_ready', database: 'error', error: String(err?.message ?? err) });
    }
  });

  // Caddy on-demand TLS asks here before issuing a certificate (FR-SF-1): only hosts that serve a shop get one.
  r.get(
    '/system/domain_check',
    { public: true, tx: 'none', raw: true, tags: ['System'], summary: 'Whether a hostname serves a storefront (200) or not (404); for Caddy on-demand TLS', querystring: Type.Object({ domain: Type.String({ maxLength: 253 }) }) },
    async (_c, req, reply) => {
      const host = domains.normalizeHostname(req.query.domain);
      const platform = new URL(deps.config.storefrontUrl).hostname;
      const wildcard = deps.config.storefrontDomain?.replace(/^\*\./, '');
      let ok = host === platform || (await withSystem(deps.db, (c) => domains.tenantByHost(c, host))) !== null;
      if (!ok && wildcard && host.endsWith(`.${wildcard}`)) ok = !!(await withSystem(deps.db, (c) => tenancy.tenantBySlug(c, host.slice(0, -(wildcard.length + 1)))));
      return reply.status(ok ? 200 : 404).send({ domain: host, ok });
    },
  );

  r.get('/system/version', { public: true, tx: 'none', tags: ['System'], summary: 'Version' }, async () => ({ version: deps.version, api: 'v1', plugin_api: '1.0.0' }));

  r.get('/system/metrics', { public: true, tx: 'none', raw: true, tags: ['System'], summary: 'Prometheus metrics' }, async (_c, req, reply) => {
    if (deps.config.operatorKey && req.headers.authorization !== `Bearer ${deps.config.operatorKey}`) throw new AppError('unauthorized', 401, serverT('error.operator_key_required'));
    const mem = process.memoryUsage();
    const lines = [
      '# TYPE openrent_http_requests_total counter', `openrent_http_requests_total ${counters.requests}`,
      '# TYPE openrent_http_errors_total counter', `openrent_http_errors_total ${counters.errors}`,
      '# TYPE openrent_uptime_seconds gauge', `openrent_uptime_seconds ${Math.round((Date.now() - started) / 1000)}`,
      '# TYPE openrent_heap_bytes gauge', `openrent_heap_bytes ${mem.heapUsed}`,
      '# TYPE openrent_db_pool_total gauge', `openrent_db_pool_total ${deps.db.pool.totalCount}`,
      '# TYPE openrent_db_pool_waiting gauge', `openrent_db_pool_waiting ${deps.db.pool.waitingCount}`,
    ];
    return reply.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n');
  });
}
