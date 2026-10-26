import { webhooks } from '@openrent/core';
import type { Router } from '../http.ts';
import { IdParams, Type } from '../schemas.ts';

export function registerWebhooks(r: Router) {
  const W = ['Webhooks'];
  const Body = Type.Object({ url: Type.String({ minLength: 8 }), events: Type.Optional(Type.Array(Type.String())), description: Type.Optional(Type.String()), api_version: Type.Optional(Type.String()) }, { additionalProperties: false });
  r.get('/webhook_endpoints', { permission: 'webhooks:manage', tags: W, summary: 'List endpoints' }, async (ctx) => ({ object: 'list', data: await webhooks.listEndpoints(ctx) }));
  r.post('/webhook_endpoints', { permission: 'webhooks:manage', tags: W, summary: 'Create an endpoint; the signing secret is returned once', body: Body }, async (ctx, req) => webhooks.createEndpoint(ctx, req.body));
  r.get('/webhook_endpoints/:id', { permission: 'webhooks:manage', tags: W, summary: 'Get an endpoint', params: IdParams }, async (ctx, req) => webhooks.getEndpoint(ctx, req.params.id));
  r.patch(
    '/webhook_endpoints/:id',
    { permission: 'webhooks:manage', tags: W, summary: 'Update or re-enable an endpoint', params: IdParams, body: Type.Object({ url: Type.Optional(Type.String()), events: Type.Optional(Type.Array(Type.String())), description: Type.Optional(Type.String()), status: Type.Optional(Type.Union([Type.Literal('enabled'), Type.Literal('disabled_by_user')])) }) },
    async (ctx, req) => webhooks.updateEndpoint(ctx, req.params.id, req.body),
  );
  r.delete('/webhook_endpoints/:id', { permission: 'webhooks:manage', tags: W, summary: 'Delete an endpoint', params: IdParams }, async (ctx, req) => webhooks.deleteEndpoint(ctx, req.params.id));
  r.get('/webhook_endpoints/:id/deliveries', { permission: 'webhooks:manage', tags: W, summary: 'Delivery attempts with request and response', params: IdParams }, async (ctx, req) => ({ object: 'list', data: await webhooks.listDeliveries(ctx, req.params.id) }));
  r.post('/webhook_endpoints/:id/actions/rotate_secret', { permission: 'webhooks:manage', tags: W, summary: 'Rotate the secret; both sign for 24 h', params: IdParams, status: 200 }, async (ctx, req) => webhooks.rotateSecret(ctx, req.params.id));
  r.post('/webhook_endpoints/:id/actions/test', { permission: 'webhooks:manage', tags: W, summary: 'Send a ping event', params: IdParams, status: 202 }, async (ctx, req) => webhooks.testEndpoint(ctx, req.params.id));
  r.post('/webhook_deliveries/:id/actions/redeliver', { permission: 'webhooks:manage', tags: W, summary: 'Send an event again', params: IdParams, status: 202 }, async (ctx, req) => webhooks.redeliver(ctx, req.params.id));
  r.get('/webhook_events', { permission: 'webhooks:manage', tags: W, summary: 'Recent events', querystring: Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })) }) }, async (ctx, req) => ({ object: 'list', data: await webhooks.listEvents(ctx, req.query.limit) }));
}
