import { domains } from '@openrent/core';
import type { Router } from '../http.ts';
import { IdParams, Type } from '../schemas.ts';

/** A shop's own storefront domains (FR-SF-1). */
export function registerDomains(r: Router) {
  const D = ['Storefront domains'];
  r.get('/storefront_domains', { permission: 'tenant:read', tags: D, summary: 'Custom domains with their status and the DNS records to publish' }, async (ctx) => ({ object: 'list', data: await domains.listDomains(ctx) }));
  r.post(
    '/storefront_domains',
    { permission: 'tenant:write', tags: D, summary: 'Add a domain; it serves the storefront once its DNS record is found', body: Type.Object({ hostname: Type.String({ maxLength: 260 }) }) },
    async (ctx, req) => domains.addDomain(ctx, req.body),
  );
  r.post('/storefront_domains/:id/actions/verify', { permission: 'tenant:write', tags: D, summary: 'Look up the DNS records now', params: IdParams, status: 200 }, async (ctx, req) => domains.verifyDomain(ctx, req.params.id));
  r.post('/storefront_domains/:id/actions/make_primary', { permission: 'tenant:write', tags: D, summary: 'Use this domain in emails and documents', params: IdParams, status: 200 }, async (ctx, req) => domains.makePrimary(ctx, req.params.id));
  r.delete('/storefront_domains/:id', { permission: 'tenant:write', tags: D, summary: 'Remove a domain; it stops serving the storefront at once', params: IdParams }, async (ctx, req) => domains.removeDomain(ctx, req.params.id));
}
