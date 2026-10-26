import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { AppError, assertCan, withLocale, type Ctx, type FilterValue, type ListParams, type Permission, serverT } from '@openrent/core';
import { withTenant, type TxOptions } from '@openrent/db';
import type { AppDeps } from './deps.ts';
import { makeCtx } from './context.ts';

export interface RouteOptions {
  permission?: Permission | null;
  /** 'tenant' (default): runs inside a tenant transaction. 'none': handler manages its own work. */
  tx?: 'tenant' | 'none';
  isolation?: TxOptions['isolation'];
  tags?: string[];
  summary?: string;
  description?: string;
  body?: unknown;
  params?: unknown;
  querystring?: unknown;
  response?: unknown;
  status?: number;
  /** Raw reply handling (files, HTML). */
  raw?: boolean;
  /** `hook: 'preHandler'` lets `keyGenerator` read the parsed body (e.g. limit per email). */
  rateLimit?: { max: number; timeWindow: string; hook?: 'onRequest' | 'preHandler'; keyGenerator?: (req: FastifyRequest) => string };
  public?: boolean;
}

/** Request as seen by handlers: body, params and query were validated against the route schema. */
export type Req = Omit<FastifyRequest, 'body' | 'params' | 'query'> & { body: any; params: any; query: any };
type Handler = (ctx: Ctx, req: Req, reply: FastifyReply) => Promise<unknown>;

declare module 'fastify' {
  interface FastifyContextConfig {
    permission?: string | null;
  }
}

/** Parses `?filter[status]=a,b&filter[starts_at][gte]=...` (PRD §5.1.8). */
export function parseList(query: Record<string, unknown>): ListParams {
  const filters: Record<string, FilterValue> = {};
  for (const [k, raw] of Object.entries(query ?? {})) {
    const m = /^filter\[(\w+)\](?:\[(gte|lte|gt|lt|eq)\])?$/.exec(k);
    if (!m) continue;
    const v = Array.isArray(raw) ? raw.join(',') : String(raw);
    const f = (filters[m[1]!] ??= {});
    const op = m[2] ?? 'eq';
    if (op === 'eq') f.eq = v.split(',').map((s) => s.trim()).filter(Boolean);
    else f[op as 'gte'] = v;
  }
  const limit = query?.limit !== undefined ? Number(query.limit) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) throw new AppError('validation_error', 400, serverT('error.limit_must_be_between_1_and_200'));
  return {
    limit,
    cursor: query?.cursor ? String(query.cursor) : undefined,
    sort: query?.sort ? String(query.sort) : undefined,
    q: query?.q ? String(query.q) : undefined,
    filters,
  };
}

export function expandOf(query: any): string[] {
  const e = String(query?.expand ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (e.length > 8) throw new AppError('validation_error', 400, serverT('error.at_most_8_expansions_per_request'));
  return e;
}

export function ifMatchOf(req: FastifyRequest): number | null {
  const h = req.headers['if-match'];
  if (!h) return null;
  const m = /(\d+)/.exec(String(h));
  return m ? Number(m[1]) : null;
}

function requestHash(req: FastifyRequest) {
  return createHash('sha256').update(`${req.method} ${req.url} ${JSON.stringify(req.body ?? null)}`).digest('hex');
}

export class Router {
  constructor(
    readonly app: FastifyInstance,
    readonly deps: AppDeps,
    readonly prefix = '/api/v1',
  ) {}

  route(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, opts: RouteOptions, handler: Handler) {
    const deps = this.deps;
    const schema: Record<string, unknown> = { tags: opts.tags, summary: opts.summary, description: opts.description };
    if (opts.body) schema.body = opts.body;
    if (opts.params) schema.params = opts.params;
    if (opts.querystring) schema.querystring = opts.querystring;
    if (opts.response) schema.response = opts.response;
    if (opts.permission) (schema as any)['x-permission'] = opts.permission;
    if (!opts.public) (schema as any).security = url.startsWith('/storefront') ? [{ publishableKey: [] }, { tenantSlug: [] }] : [{ sessionCookie: [] }, { secretKey: [] }];
    this.app.route({
      method,
      url: `${this.prefix}${url}`,
      schema,
      config: { permission: opts.permission ?? null, ...(opts.rateLimit ? { rateLimit: opts.rateLimit } : {}) },
      // Server messages (errors, emails queued here) follow the request's language.
      handler: (req: FastifyRequest, reply: FastifyReply) => withLocale(req.locale, async () => {
        const auth = req.auth;
        if (!opts.public) {
          if (!auth?.tenantId) throw new AppError('unauthorized', 401, serverT('error.sign_in_or_send_an_api_key'));
          if (opts.permission) assertCan(auth.actor, opts.permission);
        }
        const run = async () => {
          if (opts.tx === 'none') return handler(null as unknown as Ctx, req as Req, reply);
          return withTenant(deps.db, auth!.tenantId!, (client) => handler(makeCtx(deps, client, req), req as Req, reply), { isolation: opts.isolation });
        };
        // Idempotency (PRD §5.1.4): replay stored responses for repeated keys.
        const key = method === 'POST' ? req.headers['idempotency-key'] : undefined;
        if (key && auth?.tenantId && !opts.raw) {
          const k = String(key).slice(0, 200);
          const hash = requestHash(req);
          const claim = await withTenant(deps.db, auth.tenantId, async (c) => {
            const ins = await c.query(
              `INSERT INTO idempotency_keys (tenant_id, key, method, path, request_hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, key) DO NOTHING RETURNING key`,
              [auth.tenantId, k, method, req.url, hash],
            );
            if (ins.rows.length) return { fresh: true as const };
            const row = (await c.query(`SELECT * FROM idempotency_keys WHERE tenant_id = $1 AND key = $2`, [auth.tenantId, k])).rows[0];
            return { fresh: false as const, row };
          });
          if (!claim.fresh) {
            const row = claim.row;
            if (row.request_hash !== hash) throw new AppError('idempotency_key_reused', 422, serverT('error.this_idempotency_key_was_used_with_a'));
            if (row.response_status == null) throw new AppError('idempotency_in_progress', 409, serverT('error.a_request_with_this_idempotency_key_is'));
            reply.header('Idempotent-Replayed', 'true');
            return reply.status(row.response_status).send(row.response_body);
          }
          try {
            const data = await run();
            const status = opts.status ?? (method === 'POST' ? 201 : 200);
            await withTenant(deps.db, auth.tenantId, (c) =>
              c.query(`UPDATE idempotency_keys SET response_status = $3, response_body = $4 WHERE tenant_id = $1 AND key = $2`, [auth.tenantId, k, status, JSON.stringify(data ?? null)]),
            );
            return reply.status(status).send(data ?? null);
          } catch (err) {
            await withTenant(deps.db, auth.tenantId, (c) => c.query(`DELETE FROM idempotency_keys WHERE tenant_id = $1 AND key = $2`, [auth.tenantId, k])).catch(() => undefined);
            throw err;
          }
        }
        const data = await run();
        if (opts.raw) return data;
        if (data === undefined) return reply.status(204).send();
        return reply.status(opts.status ?? (method === 'POST' ? 201 : 200)).send(data);
      }),
    });
  }

  get(url: string, opts: RouteOptions, h: Handler) {
    this.route('GET', url, opts, h);
  }
  post(url: string, opts: RouteOptions, h: Handler) {
    this.route('POST', url, opts, h);
  }
  patch(url: string, opts: RouteOptions, h: Handler) {
    this.route('PATCH', url, opts, h);
  }
  put(url: string, opts: RouteOptions, h: Handler) {
    this.route('PUT', url, opts, h);
  }
  delete(url: string, opts: RouteOptions, h: Handler) {
    this.route('DELETE', url, { status: 204, ...opts }, h);
  }
}
