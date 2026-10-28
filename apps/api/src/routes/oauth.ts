import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { oauth, serverT, AppError } from '@openrent/core';
import { withSystem } from '@openrent/db';
import type { AppDeps } from '../deps.ts';
import type { Router } from '../http.ts';
import { IdParams, Type } from '../schemas.ts';

/**
 * OAuth 2.1 for third-party apps (PRD §5.2). The protocol endpoints live outside /api/v1, as apps expect:
 * /.well-known/oauth-authorization-server, /oauth/authorize (to the admin's consent page), /oauth/token,
 * /oauth/revoke and /oauth/register. Answers follow RFC 6749: `{ error, error_description }`.
 */
export async function registerOAuthEndpoints(app: FastifyInstance, deps: AppDeps) {
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))));
    const fail = (reply: FastifyReply, err: unknown) => {
      if (err instanceof oauth.OAuthError) return reply.code(err.status).header('cache-control', 'no-store').send({ error: err.error, error_description: err.description });
      throw err;
    };
    /** Client credentials from HTTP Basic (client_secret_basic), else none. */
    const basic = (req: FastifyRequest) => {
      const h = String(req.headers.authorization ?? '');
      if (!h.startsWith('Basic ')) return { id: null, secret: null };
      const [id, secret] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
      return { id: decodeURIComponent(id ?? '') || null, secret: secret !== undefined ? decodeURIComponent(secret) : null };
    };

    scope.get('/.well-known/oauth-authorization-server', { schema: { hide: true } as any }, async () => oauth.metadata(deps.config.publicUrl));

    // The person decides on the admin's consent page, signed in; the app's request goes along as it is.
    scope.get('/oauth/authorize', { schema: { hide: true } as any }, async (req, reply) => {
      const qs = new URLSearchParams(req.query as Record<string, string>).toString();
      return reply.redirect(`${deps.config.adminUrl}/oauth/authorize?${qs}`, 302);
    });

    scope.post('/oauth/token', { schema: { hide: true } as any, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, string>;
      // A refused request still commits what it did: a code or refresh token used twice revokes the grant.
      const out = await withSystem(deps.db, async (c) => {
        try {
          return { ok: await oauth.token(c, body, basic(req)) };
        } catch (err) {
          if (err instanceof oauth.OAuthError) return { err };
          throw err;
        }
      });
      if ('err' in out) return fail(reply, out.err);
      return reply.header('cache-control', 'no-store').header('pragma', 'no-cache').send(out.ok);
    });

    scope.post('/oauth/revoke', { schema: { hide: true } as any }, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, string>;
      try {
        const auth = basic(req);
        const clientId = auth.id ?? body.client_id ?? null;
        if (clientId) {
          const client = await withSystem(deps.db, (c) => oauth.getClient(c, clientId));
          if (!client) throw new oauth.OAuthError('invalid_client', 'unknown client', 401);
          oauth.authenticateClient(client, auth.secret ?? body.client_secret ?? null);
        }
        if (body.token) await withSystem(deps.db, (c) => oauth.revokeToken(c, body.token!, clientId));
        return reply.send({});
      } catch (err) {
        return fail(reply, err);
      }
    });

    // RFC 7591: apps register themselves as public clients.
    scope.post('/oauth/register', { schema: { hide: true } as any, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
      try {
        const out = await withSystem(deps.db, (c) => oauth.registerClient(c, (req.body ?? {}) as any));
        return reply.code(201).header('cache-control', 'no-store').send(out);
      } catch (err) {
        return fail(reply, err);
      }
    });
  });
}

/** The consent page's calls, the shop's connected apps, and the operator registering apps with a secret. */
export function registerOAuth(r: Router) {
  const O = ['Apps'];
  const deps = r.deps;
  const Request = Type.Object(
    {
      response_type: Type.Optional(Type.String()), client_id: Type.Optional(Type.String()), redirect_uri: Type.Optional(Type.String()), scope: Type.Optional(Type.String()),
      state: Type.Optional(Type.String({ maxLength: 500 })), code_challenge: Type.Optional(Type.String()), code_challenge_method: Type.Optional(Type.String()),
    },
    { additionalProperties: true },
  );
  r.post(
    '/oauth/authorize/check',
    { permission: 'api_keys:manage', tags: O, summary: 'What an app asks for, for the consent page: the app, its address and scopes, or why the request is refused', body: Request, status: 200 },
    async (ctx, req) => {
      const c: any = await oauth.checkAuthorize(ctx.db, req.body);
      if (c.fatal) return { object: 'oauth_request', ok: false, problem: c.fatal };
      if (c.error) return { object: 'oauth_request', ok: false, redirect_to: oauth.withParams(c.redirect, { ...c.error, state: req.body.state }) };
      return { object: 'oauth_request', ok: true, app: { name: c.client.name, homepage: c.client.homepage, redirect_host: new URL(c.redirect).host }, scopes: c.scopes };
    },
  );
  r.post('/oauth/authorize/approve', { permission: 'api_keys:manage', tags: O, summary: 'Approve the app for this shop; answers where to send the person back, with the code', body: Request, status: 200 }, async (ctx, req) => ({
    object: 'oauth_decision',
    ...(await oauth.approve(ctx, req.body)),
  }));
  r.post('/oauth/authorize/deny', { permission: 'api_keys:manage', tags: O, summary: 'Decline; answers where to send the person back', body: Request, status: 200 }, async (ctx, req) => ({
    object: 'oauth_decision',
    ...(await oauth.deny(ctx.db, req.body)),
  }));
  r.get('/oauth_grants', { permission: 'api_keys:manage', tags: O, summary: 'Apps connected to this shop, with their scopes' }, async (ctx) => ({ object: 'list', data: await oauth.listGrants(ctx) }));
  r.delete('/oauth_grants/:id', { permission: 'api_keys:manage', tags: O, summary: 'Disconnect an app: its tokens stop working at once', params: IdParams, status: 200 }, async (ctx, req) => oauth.disconnect(ctx, req.params.id));

  r.post(
    '/operator/oauth_clients',
    {
      public: true,
      tx: 'none',
      tags: ['Operator'],
      summary: 'Register an app with a client secret (confidential client); the response holds the secret once',
      body: Type.Object({ client_name: Type.String({ maxLength: 100 }), redirect_uris: Type.Array(Type.String({ maxLength: 500 }), { minItems: 1, maxItems: 10 }), client_uri: Type.Optional(Type.String({ maxLength: 500 })) }, { additionalProperties: false }),
      status: 201,
      rateLimit: { max: 60, timeWindow: '1 minute' },
    },
    async (_ctx, req) => {
      const key = deps.config.operatorKey;
      if (!key) throw new AppError('not_found', 404, serverT('error.operator_disabled'));
      if (String(req.headers['x-operator-key'] ?? '') !== key) throw new AppError('unauthorized', 401, serverT('error.operator_key_required'));
      try {
        return await withSystem(deps.db, (c) => oauth.registerClient(c, req.body, { confidential: true, via: 'operator' }));
      } catch (err) {
        if (err instanceof oauth.OAuthError) throw new AppError(err.error, 422, err.description, { errors: [{ field: err.error === 'invalid_redirect_uri' ? 'redirect_uris' : 'client_name', code: err.error, message: err.description }] });
        throw err;
      }
    },
  );
}
