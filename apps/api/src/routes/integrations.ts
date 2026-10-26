import { withSystem, withTenant } from '@openrent/db';
import { integrations, AppError, sha256 } from '@openrent/core';
import type { Router } from '../http.ts';
import { systemCtx } from '../context.ts';
import { IdParams, Json, Type } from '../schemas.ts';

/** Integrations with other systems (FR-INT-3 and up): connect, sync log, catch-up. Accounting systems have their own routes (accounting.ts). */
export function registerIntegrations(r: Router) {
  const { deps } = r;
  const I = ['Integrations'];
  const redirectUri = `${deps.config.publicUrl}${integrations.callbackPath}`;

  r.get('/integrations', { permission: 'integrations:manage', tags: I, summary: 'Installed integrations and the shop’s connections' }, async (ctx) => ({
    object: 'list',
    data: await integrations.listIntegrations(ctx),
    redirect_uri: redirectUri,
  }));
  r.post(
    '/integrations/:id/connect',
    {
      permission: 'integrations:manage', tags: I, summary: 'Connect: returns the provider’s sign-in URL (OAuth 2), or checks typed credentials', params: IdParams, status: 200,
      body: Type.Object({ credentials: Type.Optional(Type.Record(Type.String(), Type.String({ maxLength: 2000 }))) }, { additionalProperties: false }),
    },
    async (ctx, req) => integrations.connect(ctx, req.params.id, { credentials: req.body?.credentials, redirect_uri: redirectUri }),
  );
  r.get(
    integrations.callbackPath.replace('/api/v1', ''),
    { public: true, tx: 'none', raw: true, tags: I, summary: 'The provider sends the shop back here after connecting', querystring: Type.Object(
        { code: Type.Optional(Type.String()), state: Type.Optional(Type.String()), error: Type.Optional(Type.String()), error_description: Type.Optional(Type.String()) },
        // Providers add their own values (QuickBooks' realmId); they go to the integration.
        { additionalProperties: Type.String() },
      ) },
    async (_c, req, reply) => {
      const q = req.query as Record<string, string>;
      // Accounting systems are set up on their own page (ADR 0009); everything else on Integrations.
      const pending = q.state
        ? (await withSystem(deps.db, (c) => c.query(`SELECT tenant_id, provider_id FROM integration_connections WHERE oauth_state_hash = $1`, [sha256(q.state!)]))).rows[0]
        : undefined;
      const page = pending && deps.plugins.integration(pending.provider_id)?.category === 'accounting' ? 'accounting' : 'integrations';
      const back = (path: string) => reply.redirect(`${deps.config.adminUrl}/${page}${path}`);
      try {
        if (q.error || !q.code || !q.state) throw new AppError('integration_denied', 400, q.error_description ?? q.error ?? 'denied');
        const tenantId = pending?.tenant_id;
        if (!tenantId) throw new AppError('integration_state', 400, 'expired');
        const { code, state, ...params } = q;
        const conn = await withTenant(deps.db, tenantId, (c) => integrations.completeOAuth(systemCtx(deps, c, tenantId, req.log), { state: state!, code: code!, params, redirect_uri: redirectUri }));
        return back(`?connected=${encodeURIComponent(conn.provider_id)}`);
      } catch (err) {
        req.log.warn({ err }, 'integration oauth callback failed');
        return back(`?integration_error=${encodeURIComponent(err instanceof AppError ? err.code : 'integration_failed')}`);
      }
    },
  );
  r.get('/integration_connections/:id', { permission: 'integrations:manage', tags: I, summary: 'One connection', params: IdParams }, async (ctx, req) => integrations.getConnection(ctx, req.params.id));
  r.patch('/integration_connections/:id', { permission: 'integrations:manage', tags: I, summary: 'Change the connection’s settings (account codes…)', params: IdParams, body: Type.Object({ settings: Json }, { additionalProperties: false }) }, async (ctx, req) =>
    integrations.updateSettings(ctx, req.params.id, req.body.settings),
  );
  r.delete('/integration_connections/:id', { permission: 'integrations:manage', tags: I, summary: 'Disconnect (credentials are forgotten, links and log are kept)', params: IdParams }, async (ctx, req) => integrations.disconnect(ctx, req.params.id));
  r.post(
    '/integration_connections/:id/actions/catch_up',
    { permission: 'integrations:manage', tags: I, summary: 'Bring across what happened since a date', params: IdParams, status: 200, body: Type.Object({ from: Type.String({ format: 'date-time' }) }, { additionalProperties: false }) },
    async (ctx, req) => integrations.catchUp(ctx, req.params.id, req.body.from),
  );
  r.get(
    '/integration_connections/:id/tasks',
    { permission: 'integrations:manage', tags: I, summary: 'The sync log, newest first', params: IdParams, querystring: Type.Object({ status: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) }) },
    async (ctx, req) => ({ object: 'list', data: await integrations.listTasks(ctx, req.params.id, req.query) }),
  );
  r.post('/integration_tasks/:id/actions/retry', { permission: 'integrations:manage', tags: I, summary: 'Try a task again now', params: IdParams, status: 200 }, async (ctx, req) => integrations.retryTask(ctx, req.params.id));
}
