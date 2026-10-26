import { withSystem } from '@openrent/db';
import { AppError, sso, serverT } from '@openrent/core';
import * as oidc from 'openid-client';
import type { Router } from '../http.ts';
import { CSRF_COOKIE, SESSION_COOKIE, newCsrfToken } from '../auth.ts';
import { IdParams, Nullable, Type } from '../schemas.ts';

/**
 * Single sign-on for staff with OpenID Connect (FR-USR-4): authorization code flow with PKCE, state and
 * nonce kept in a signed, short-lived cookie. Providers are set up per shop in Settings.
 */
const STATE_COOKIE = 'or_oidc';
const configs = new Map<string, { at: number; config: oidc.Configuration }>();

/** Provider metadata is fetched once an hour per provider. */
async function configFor(p: { id: string; issuer: string; clientId: string; clientSecret: string | null }) {
  const key = `${p.id}|${p.issuer}|${p.clientId}|${p.clientSecret ?? ''}`;
  const hit = configs.get(key);
  if (hit && Date.now() - hit.at < 3600_000) return hit.config;
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(p.issuer);
  const config = await oidc.discovery(new URL(p.issuer), p.clientId, p.clientSecret ? undefined : { token_endpoint_auth_method: 'none' }, p.clientSecret ? oidc.ClientSecretPost(p.clientSecret) : oidc.None(), {
    execute: local ? [oidc.allowInsecureRequests] : [],
    timeout: 10,
  });
  configs.set(key, { at: Date.now(), config });
  return config;
}

/** Only a path inside the admin is followed after sign-in. */
const safeNext = (next: unknown) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/');

export function registerSso(r: Router) {
  const { deps } = r;
  const secure = deps.config.publicUrl.startsWith('https://');
  const callbackUrl = (id: string) => `${deps.config.publicUrl}/api/v1/auth/oidc/${id}/callback`;
  const back = (reply: any, path: string) => reply.redirect(`${deps.config.adminUrl}${path}`);

  r.get('/auth/sso', { public: true, tx: 'none', tags: ['Auth'], summary: 'Sign-in providers for an email address (for the sign-in page)', querystring: Type.Object({ email: Type.String({ maxLength: 200 }) }) }, async (_c, req) => ({
    object: 'list',
    data: await withSystem(deps.db, (c) => sso.providersForEmail(c, req.query.email)),
  }));

  r.get(
    '/auth/oidc/:id/start',
    { public: true, tx: 'none', raw: true, tags: ['Auth'], summary: 'Go to the provider to sign in', params: IdParams, querystring: Type.Object({ next: Type.Optional(Type.String({ maxLength: 500 })) }), rateLimit: { max: 30, timeWindow: '1 minute' } },
    async (_c, req, reply) => {
      try {
        const p = await withSystem(deps.db, (c) => sso.providerForLogin(c, req.params.id, (s) => deps.secrets.decrypt(s)));
        const config = await configFor(p);
        const verifier = oidc.randomPKCECodeVerifier();
        const state = oidc.randomState();
        const nonce = oidc.randomNonce();
        const url = oidc.buildAuthorizationUrl(config, {
          redirect_uri: callbackUrl(p.id), scope: 'openid email profile', code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256', state, nonce,
        });
        reply.setCookie(STATE_COOKIE, JSON.stringify({ p: p.id, state, nonce, verifier, next: safeNext(req.query.next) }), {
          path: '/api/v1/auth/oidc', httpOnly: true, sameSite: 'lax', secure, maxAge: 600, signed: true,
        });
        return reply.redirect(url.href);
      } catch (err) {
        req.log.warn({ err }, 'oidc start failed');
        return back(reply, `/login?sso_error=${encodeURIComponent(err instanceof AppError ? err.code : 'sso_failed')}`);
      }
    },
  );

  r.get(
    '/auth/oidc/:id/callback',
    { public: true, tx: 'none', raw: true, tags: ['Auth'], summary: 'The provider sends the person back here', params: IdParams, rateLimit: { max: 30, timeWindow: '1 minute' } },
    async (_c, req, reply) => {
      const raw = req.cookies?.[STATE_COOKIE];
      const unsigned = raw ? req.unsignCookie(raw) : null;
      reply.clearCookie(STATE_COOKIE, { path: '/api/v1/auth/oidc' });
      try {
        const saved = unsigned?.valid && unsigned.value ? JSON.parse(unsigned.value) : null;
        if (!saved || saved.p !== req.params.id) throw new AppError('sso_failed', 400, serverT('error.sso_failed'));
        const p = await withSystem(deps.db, (c) => sso.providerForLogin(c, req.params.id, (s) => deps.secrets.decrypt(s)));
        const config = await configFor(p);
        const current = new URL(req.url, deps.config.publicUrl);
        const tokens = await oidc.authorizationCodeGrant(config, new URL(`${callbackUrl(p.id)}${current.search}`), {
          pkceCodeVerifier: saved.verifier, expectedState: saved.state, expectedNonce: saved.nonce, idTokenExpected: true,
        });
        const claims = tokens.claims() ?? {};
        const done = await withSystem(deps.db, (c) => sso.completeSsoLogin(c, p, claims, { ip: req.ip, userAgent: req.headers['user-agent'] }));
        reply.setCookie(SESSION_COOKIE, done.token, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: 30 * 86400 });
        reply.setCookie(CSRF_COOKIE, newCsrfToken(), { path: '/', httpOnly: false, sameSite: 'lax', secure, maxAge: 30 * 86400 });
        return back(reply, saved.next ?? '/');
      } catch (err) {
        req.log.warn({ err }, 'oidc callback failed');
        return back(reply, `/login?sso_error=${encodeURIComponent(err instanceof AppError ? err.code : 'sso_failed')}`);
      }
    },
  );

  const S = ['Single sign-on'];
  const Fields = {
    name: Type.String({ maxLength: 100 }), issuer: Type.String({ maxLength: 500 }), client_id: Type.String({ maxLength: 300 }), client_secret: Type.Optional(Nullable(Type.String({ maxLength: 1000 }))),
    allowed_domains: Type.Array(Type.String({ maxLength: 200 }), { maxItems: 50 }), default_role: Type.Optional(Type.String({ maxLength: 64 })),
    enforce_sso: Type.Optional(Type.Boolean()), active: Type.Optional(Type.Boolean()),
  };
  const withRedirect = (p: any) => ({ ...p, redirect_uri: callbackUrl(p.id) });
  r.get('/sso_providers', { permission: 'users:read', tags: S, summary: 'Sign-in providers of the shop, with the redirect URI to register' }, async (ctx) => ({ object: 'list', data: (await sso.listProviders(ctx)).map(withRedirect) }));
  r.post('/sso_providers', { permission: 'users:write', tags: S, summary: 'Add a sign-in provider', body: Type.Object(Fields, { additionalProperties: false }) }, async (ctx, req) => withRedirect(await sso.createProvider(ctx, req.body)));
  r.patch('/sso_providers/:id', { permission: 'users:write', tags: S, summary: 'Change a sign-in provider', params: IdParams, body: Type.Partial(Type.Object(Fields, { additionalProperties: false })) }, async (ctx, req) =>
    withRedirect(await sso.updateProvider(ctx, req.params.id, req.body)),
  );
  r.delete('/sso_providers/:id', { permission: 'users:write', tags: S, summary: 'Remove a sign-in provider', params: IdParams }, async (ctx, req) => sso.deleteProvider(ctx, req.params.id));
}
