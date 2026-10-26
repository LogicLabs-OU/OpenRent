import { withSystem, withTenant } from '@openrent/db';
import { AppError, auth as coreAuth, tenancy, notifications, permissionsFor, serverT } from '@openrent/core';
import type { Router } from '../http.ts';
import { CSRF_COOKIE, SESSION_COOKIE, newCsrfToken } from '../auth.ts';
import { systemCtx } from '../context.ts';
import { Locale, Type } from '../schemas.ts';

export function registerAuthRoutes(r: Router) {
  const { deps } = r;
  const secure = deps.config.publicUrl.startsWith('https://');
  const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure, maxAge: coreAuth.SESSION_TTL_DAYS * 86400 };
  const setSession = (reply: any, token: string) => {
    reply.setCookie(SESSION_COOKIE, token, cookieOpts);
    const csrf = newCsrfToken();
    reply.setCookie(CSRF_COOKIE, csrf, { ...cookieOpts, httpOnly: false });
    return csrf;
  };

  r.post(
    '/auth/login',
    {
      public: true,
      tx: 'none',
      tags: ['Auth'],
      summary: 'Sign in with email and password (optional TOTP code)',
      body: Type.Object({ email: Type.String({ format: 'email' }), password: Type.String({ minLength: 1 }), totp: Type.Optional(Type.String()) }),
      rateLimit: { max: 10, timeWindow: '1 minute' },
      status: 200,
    },
    async (_c, req, reply) => {
      const b = req.body as { email: string; password: string; totp?: string };
      const { token, session } = await withSystem(deps.db, (c) => coreAuth.login(c, { ...b, ip: req.ip, userAgent: req.headers['user-agent'] }));
      const csrf = setSession(reply, token);
      return { object: 'session', user_id: session.userId, tenant_id: session.tenantId, csrf_token: csrf };
    },
  );

  r.post('/auth/logout', { public: true, tx: 'none', tags: ['Auth'], summary: 'Sign out and revoke the session' }, async (_c, req, reply) => {
    if (req.auth?.sessionId) await withSystem(deps.db, (c) => coreAuth.revokeSession(c, req.auth!.sessionId!));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.clearCookie(CSRF_COOKIE, { path: '/' });
    return undefined;
  });

  r.post(
    '/auth/magic_link',
    { public: true, tx: 'none', tags: ['Auth'], summary: 'Email a one-time sign-in link', body: Type.Object({ email: Type.String({ format: 'email' }) }), rateLimit: { max: 5, timeWindow: '1 minute' }, status: 202 },
    async (_c, req) => {
      const { email } = req.body as { email: string };
      await withSystem(deps.db, async (c) => {
        const res = await coreAuth.createLoginToken(c, email);
        if (!res) return;
        const m = await coreAuth.membershipsOf(c, res.user.id);
        const tenantId = m[0]?.tenant_id;
        if (!tenantId) return;
        await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
        const ctx = systemCtx(deps, c, tenantId, req.log);
        await notifications.queue(ctx, { template: 'magic_link', to: res.user.email, audience: 'staff', data: { link: `${deps.config.adminUrl}/login?magic=${encodeURIComponent(res.token)}` } });
      });
      // Same answer whether or not the email exists.
      return { object: 'magic_link', status: 'sent_if_account_exists' };
    },
  );

  r.post(
    '/auth/magic_link/verify',
    { public: true, tx: 'none', tags: ['Auth'], summary: 'Exchange a sign-in link token for a session', body: Type.Object({ token: Type.String() }), status: 200 },
    async (_c, req, reply) => {
      const { token } = req.body as { token: string };
      const { token: sess, session } = await withSystem(deps.db, (c) => coreAuth.consumeLoginToken(c, token, { ip: req.ip, userAgent: req.headers['user-agent'] }));
      const csrf = setSession(reply, sess);
      return { object: 'session', user_id: session.userId, tenant_id: session.tenantId, csrf_token: csrf };
    },
  );

  r.get('/auth/me', { public: true, tx: 'none', tags: ['Auth'], summary: 'Current user, tenant, role and permissions' }, async (_c, req, reply) => {
    const a = req.auth;
    if (!a || a.kind === 'anonymous' || a.kind === 'slug' || a.kind === 'publishable') throw new AppError('unauthorized', 401, serverT('auth.not_signed_in'));
    if (a.kind === 'secret_key') return { object: 'me', kind: 'api_key', tenant_id: a.tenantId, permissions: permissionsFor(a.actor) };
    const out = await withSystem(deps.db, async (c) => {
      const user = (await c.query(`SELECT id, email, name, locale, totp_secret IS NOT NULL AS totp_enabled, password_hash IS NOT NULL AS has_password FROM users WHERE id = $1`, [a.userId])).rows[0];
      const memberships = await coreAuth.membershipsOf(c, a.userId!);
      const tenant = a.tenantId ? (await c.query(`SELECT id, slug, name, currency, timezone, locale, branding FROM tenants WHERE id = $1`, [a.tenantId])).rows[0] : null;
      return { user, memberships, tenant };
    });
    // Rotate a CSRF cookie if the browser lost it.
    let csrf = req.cookies?.[CSRF_COOKIE];
    if (!csrf) {
      csrf = newCsrfToken();
      reply.setCookie(CSRF_COOKIE, csrf, { ...cookieOpts, httpOnly: false });
    }
    return { object: 'me', kind: 'user', ...out, role: a.actor.role ?? null, permissions: permissionsFor(a.actor), csrf_token: csrf };
  });

  r.patch(
    '/auth/me',
    {
      public: true,
      tx: 'none',
      tags: ['Auth'],
      summary: "Change your own name or admin language",
      body: Type.Object({ name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })), locale: Type.Optional(Locale) }),
    },
    async (_c, req) => {
      const a = req.auth;
      if (a?.kind !== 'session' || !a.userId) throw new AppError('unauthorized', 401, serverT('auth.not_signed_in'));
      const user = await withSystem(deps.db, async (c) => {
        const r = await c.query(`UPDATE users SET name = coalesce($2, name), locale = coalesce($3, locale) WHERE id = $1 RETURNING id, email, name, locale`, [a.userId, req.body.name ?? null, req.body.locale ?? null]);
        return r.rows[0];
      });
      return { object: 'user', ...user };
    },
  );

  r.post(
    '/auth/me/password',
    {
      public: true, tx: 'none', tags: ['Auth'], summary: 'Set your own password (the current one is needed if you have one); other sessions end',
      body: Type.Object({ password: Type.String({ maxLength: 200 }), current_password: Type.Optional(Type.String({ maxLength: 200 })) }, { additionalProperties: false }),
      rateLimit: { max: 10, timeWindow: '1 minute' }, status: 200,
    },
    async (_c, req) => {
      const a = req.auth;
      if (a?.kind !== 'session' || !a.userId) throw new AppError('unauthorized', 401, serverT('auth.not_signed_in'));
      return withSystem(deps.db, (c) => coreAuth.setOwnPassword(c, a.userId!, a.sessionId ?? null, req.body));
    },
  );

  r.post('/auth/switch_tenant', { public: true, tx: 'none', tags: ['Auth'], summary: 'Switch the session to another tenant you belong to', body: Type.Object({ tenant_id: Type.String() }), status: 200 }, async (_c, req) => {
    const a = req.auth;
    if (a?.kind !== 'session') throw new AppError('unauthorized', 401, serverT('auth.not_signed_in'));
    const { tenant_id } = req.body as { tenant_id: string };
    await withSystem(deps.db, async (c) => {
      const m = await coreAuth.membershipsOf(c, a.userId!);
      if (!m.some((x) => x.tenant_id === tenant_id)) throw new AppError('forbidden', 403, serverT('error.you_are_not_a_member_of_that'));
      await coreAuth.switchSessionTenant(c, a.sessionId!, tenant_id);
    });
    return { object: 'session', tenant_id };
  });

  r.post('/auth/totp/enroll', { public: true, tx: 'none', tags: ['Auth'], summary: 'Start TOTP enrolment (returns secret and otpauth URI)', status: 200 }, async (_c, req) => {
    const a = req.auth;
    if (a?.kind !== 'session') throw new AppError('unauthorized', 401, serverT('auth.not_signed_in'));
    const secret = coreAuth.newTotpSecret();
    const user = await withSystem(deps.db, async (c) => {
      await c.query(`UPDATE users SET totp_pending = $2 WHERE id = $1`, [a.userId, secret]);
      return (await c.query(`SELECT email FROM users WHERE id = $1`, [a.userId])).rows[0];
    });
    return { object: 'totp_enrollment', secret, otpauth_uri: coreAuth.totpUri(secret, user.email) };
  });

  r.post('/auth/totp/verify', { public: true, tx: 'none', tags: ['Auth'], summary: 'Confirm TOTP enrolment with a code', body: Type.Object({ code: Type.String() }), status: 200 }, async (_c, req) => {
    const a = req.auth;
    if (a?.kind !== 'session') throw new AppError('unauthorized', 401, serverT('auth.not_signed_in'));
    const { code } = req.body as { code: string };
    await withSystem(deps.db, async (c) => {
      const u = (await c.query(`SELECT totp_pending FROM users WHERE id = $1`, [a.userId])).rows[0];
      if (!u?.totp_pending || !coreAuth.verifyTotp(u.totp_pending, code)) throw new AppError('invalid_totp', 422, serverT('error.the_code_is_incorrect'));
      await c.query(`UPDATE users SET totp_secret = totp_pending, totp_pending = NULL WHERE id = $1`, [a.userId]);
    });
    return { object: 'totp', enabled: true };
  });

  r.post('/auth/totp/disable', { public: true, tx: 'none', tags: ['Auth'], summary: 'Turn off TOTP (requires a current code)', body: Type.Object({ code: Type.String() }), status: 200 }, async (_c, req) => {
    const a = req.auth;
    if (a?.kind !== 'session') throw new AppError('unauthorized', 401, serverT('auth.not_signed_in'));
    const { code } = req.body as { code: string };
    await withSystem(deps.db, async (c) => {
      const u = (await c.query(`SELECT totp_secret FROM users WHERE id = $1`, [a.userId])).rows[0];
      if (!u?.totp_secret || !coreAuth.verifyTotp(u.totp_secret, code)) throw new AppError('invalid_totp', 422, serverT('error.the_code_is_incorrect'));
      await c.query(`UPDATE users SET totp_secret = NULL WHERE id = $1`, [a.userId]);
    });
    return { object: 'totp', enabled: false };
  });

  // --- First run (PRD §10.3) ---------------------------------------------

  r.get('/setup', { public: true, tx: 'none', tags: ['Setup'], summary: 'Whether first-run setup is still needed' }, async () => {
    const done = await withSystem(deps.db, (c) => tenancy.isSetupComplete(c));
    return { object: 'setup_status', required: !done };
  });

  r.post(
    '/setup',
    {
      public: true,
      tx: 'none',
      tags: ['Setup'],
      summary: 'Create the first tenant, owner and location (only before any tenant exists)',
      body: Type.Object({
        owner: Type.Object({ email: Type.String({ format: 'email' }), password: Type.String({ minLength: 8 }), name: Type.String({ minLength: 1 }) }),
        tenant: Type.Object({ name: Type.String({ minLength: 1 }), slug: Type.Optional(Type.String()), currency: Type.String({ pattern: '^[A-Z]{3}$' }), timezone: Type.String(), locale: Type.Optional(Type.String()) }),
        location: Type.Object({ name: Type.String({ minLength: 1 }), address: Type.Optional(Type.Record(Type.String(), Type.Unknown())) }),
        tax: Type.Optional(Type.Object({ name: Type.String(), rate_bp: Type.Integer({ minimum: 0, maximum: 10000 }) })),
        demo_data: Type.Optional(Type.Boolean()),
      }),
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
    async (_c, req, reply) => {
      const body = req.body as any;
      const result = await withSystem(deps.db, async (c) => {
        await c.query(`SELECT pg_advisory_xact_lock(7340212)`);
        if (await tenancy.isSetupComplete(c)) throw new AppError('setup_complete', 409, serverT('error.setup_has_already_been_completed'));
        return tenancy.runSetup(c, body, { livemode: deps.config.livemode });
      });
      if (body.demo_data) {
        const { seedDemoCatalog } = await import('@openrent/db/demo');
        await withTenant(deps.db, result.tenantId, (c) => seedDemoCatalog(systemCtx(deps, c, result.tenantId, req.log)));
      }
      const { token } = await withSystem(deps.db, async (c) => {
        const user = (await c.query(`SELECT * FROM users WHERE id = $1`, [result.userId])).rows[0];
        return coreAuth.createSession(c, user, { ip: req.ip, userAgent: req.headers['user-agent'] });
      });
      const csrf = setSession(reply, token);
      return { object: 'setup_result', tenant_id: result.tenantId, slug: result.slug, location_id: result.locationId, publishable_key: result.publishableKey, csrf_token: csrf };
    },
  );
}
