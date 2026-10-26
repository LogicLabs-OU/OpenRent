import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError, auth as coreAuth, domains, tenancy, isLocale, pickLocale, LOCALES, type Actor, type Locale, type Role, serverT } from '@openrent/core';
import { withSystem } from '@openrent/db';
import type { AppDeps } from './deps.ts';

export const SESSION_COOKIE = 'or_session';
export const CSRF_COOKIE = 'or_csrf';

export interface RequestAuth {
  kind: 'session' | 'secret_key' | 'publishable' | 'slug' | 'anonymous';
  tenantId: string | null;
  actor: Actor;
  sessionId?: string;
  userId?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: RequestAuth;
    rawBody?: Buffer;
    /** Language for server messages: the staff user's, else Accept-Language, else English. */
    locale: Locale;
  }
}

const ANON: RequestAuth = { kind: 'anonymous', tenantId: null, actor: { type: 'storefront', id: null } };
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function newCsrfToken() {
  return randomBytes(24).toString('base64url');
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Resolves credentials for every /api/v1 request (PRD §5.2). */
export function registerAuth(app: FastifyInstance, deps: AppDeps) {
  // Single-tenant convenience: cache the only tenant for slug-less storefront calls.
  let soleTenant: { id: string; at: number } | null = null;
  const sole = async () => {
    if (deps.config.mode !== 'single_tenant') return null;
    if (soleTenant && Date.now() - soleTenant.at < 30_000) return soleTenant.id;
    const r = await withSystem(deps.db, (c) => c.query(`SELECT id FROM tenants ORDER BY created_at LIMIT 2`));
    soleTenant = r.rows.length === 1 ? { id: r.rows[0].id, at: Date.now() } : null;
    return soleTenant?.id ?? null;
  };

  // Verified custom domains change rarely: cache each lookup for a minute.
  const hosts = new Map<string, { id: string | null; at: number }>();
  const hostTenant = async (host: string) => {
    const hit = hosts.get(host);
    if (hit && Date.now() - hit.at < 60_000) return hit.id;
    const id = await withSystem(deps.db, (c) => domains.tenantByHost(c, host));
    if (hosts.size > 5000) hosts.clear();
    hosts.set(host, { id, at: Date.now() });
    return id;
  };

  app.decorateRequest('auth', undefined);
  app.decorateRequest('locale', 'en');

  app.addHook('onRequest', async (req: FastifyRequest) => {
    const url = req.url.split('?')[0]!;
    if (!url.startsWith('/api/v1/')) return;
    req.auth = ANON;
    req.locale = pickLocale(req.headers['accept-language'], LOCALES) ?? 'en';
    const authz = req.headers.authorization;
    const bearer = authz?.startsWith('Bearer ') ? authz.slice(7).trim() : null;
    // The portal names the shop like the storefront does; the customer comes with X-Customer-Session.
    const isStorefront = url.startsWith('/api/v1/storefront/') || url.startsWith('/api/v1/portal/');

    if (bearer) {
      const key = await withSystem(deps.db, (c) => coreAuth.resolveApiKey(c, bearer));
      if (!key) throw new AppError('invalid_api_key', 401, serverT('error.the_api_key_is_invalid_or_revoked'));
      if (key.kind === 'publishable') {
        if (!isStorefront) throw new AppError('forbidden', 403, serverT('error.publishable_keys_may_only_call_api_v1'));
        req.auth = { kind: 'publishable', tenantId: key.tenantId, actor: { type: 'storefront', id: key.id, scopes: ['storefront'] } };
      } else {
        req.auth = { kind: 'secret_key', tenantId: key.tenantId, actor: { type: 'api_key', id: key.id, scopes: key.scopes } };
      }
      return;
    }

    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const session = await withSystem(deps.db, (c) => coreAuth.resolveSession(c, token));
      if (session) {
        let tenantId = session.tenantId;
        const requested = req.headers['x-tenant-id'];
        const memberships = await withSystem(deps.db, (c) => coreAuth.membershipsOf(c, session.userId));
        if (requested) {
          if (!memberships.some((m) => m.tenant_id === requested)) throw new AppError('forbidden', 403, serverT('error.you_are_not_a_member_of_that'));
          tenantId = String(requested);
        }
        const member = memberships.find((m) => m.tenant_id === tenantId);
        const role = member?.role as Role | undefined;
        if (!SAFE.has(req.method) && !url.startsWith('/api/v1/auth/login')) {
          const header = String(req.headers['x-csrf-token'] ?? '');
          const cookie = req.cookies?.[CSRF_COOKIE] ?? '';
          if (!header || !cookie || !safeEqual(header, cookie)) throw new AppError('csrf_failed', 403, serverT('error.missing_or_invalid_csrf_token'));
        }
        if (isLocale(session.locale)) req.locale = session.locale;
        req.auth = {
          kind: 'session', tenantId: role ? tenantId : null, sessionId: session.sessionId, userId: session.userId,
          actor: { type: 'user', id: session.userId, role, ...(role === 'custom' ? { permissions: member?.permissions ?? [] } : {}) },
        };
        return;
      }
    }

    if (isStorefront) {
      // The shop is named by a slug header, a verified custom domain the storefront forwards (FR-SF-1),
      // a {slug}.storefront-domain host, or, with one shop, nothing at all.
      const slugHeader = req.headers['x-tenant-slug'];
      const forwardedHost = req.headers['x-storefront-host'];
      const wildcard = deps.config.storefrontDomain?.replace(/^\*\./, '');
      let tenantId: string | null = null;
      if (slugHeader) {
        tenantId = (await withSystem(deps.db, (c) => tenancy.tenantBySlug(c, String(slugHeader))))?.id ?? null;
        if (!tenantId) throw new AppError('unknown_tenant', 404, serverT('error.no_shop_with_that_slug'));
      }
      if (!tenantId && forwardedHost) tenantId = await hostTenant(String(forwardedHost));
      if (!tenantId && wildcard && req.hostname.endsWith(wildcard)) {
        tenantId = (await withSystem(deps.db, (c) => tenancy.tenantBySlug(c, req.hostname.split('.')[0]!)))?.id ?? null;
      }
      if (!tenantId) tenantId = await sole();
      if (tenantId) req.auth = { kind: 'slug', tenantId, actor: { type: 'storefront', id: null, scopes: ['storefront'] } };
    }
  });
}
