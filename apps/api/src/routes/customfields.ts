import { customfields } from '@openrent/core';
import type { Router } from '../http.ts';
import { parseList } from '../http.ts';
import { IdParams, ListQuery, Type } from '../schemas.ts';

const Labels = Type.Record(Type.String({ pattern: '^[a-z]{2}(-[A-Z]{2})?$' }), Type.String({ maxLength: 200 }), { description: 'Text per language, e.g. { "en": "Frame size", "de": "Rahmengröße" }' });
const Body = Type.Object(
  {
    entity: Type.Union(customfields.ENTITIES.map((e) => Type.Literal(e))),
    key: Type.String({ pattern: '^[a-z][a-z0-9_]{0,39}$', description: 'Name in custom_fields; cannot change later' }),
    type: Type.Union(customfields.FIELD_TYPES.map((x) => Type.Literal(x))),
    required: Type.Optional(Type.Boolean({ description: 'Staff and API clients must fill it in' })),
    options: Type.Optional(Type.Array(Type.Object({ value: Type.String({ minLength: 1, maxLength: 80 }), labels: Labels }), { maxItems: 100 })),
    labels: Labels,
    help: Type.Optional(Labels),
    position: Type.Optional(Type.Integer()),
    visibility: Type.Optional(Type.Union([Type.Literal('internal'), Type.Literal('storefront'), Type.Literal('portal')], { description: 'storefront shows it on product pages, portal in the customer account' })),
  },
  { additionalProperties: false },
);

/** Custom field definitions (PRD §5.4) and tag suggestions. */
export function registerCustomFields(r: Router) {
  const T = ['Custom fields'];
  const svc = customfields.definitions;
  r.get('/custom_field_definitions', { permission: 'tenant:read', tags: T, summary: 'List field definitions (filter[entity]=product)', querystring: ListQuery }, async (ctx, req) => svc.list(ctx, parseList(req.query)));
  r.post('/custom_field_definitions', { permission: 'tenant:write', tags: T, summary: 'Define a field', body: Body }, async (ctx, req) => svc.create(ctx, req.body));
  r.get('/custom_field_definitions/:id', { permission: 'tenant:read', tags: T, summary: 'Get a field definition', params: IdParams }, async (ctx, req) => svc.get(ctx, req.params.id));
  r.patch('/custom_field_definitions/:id', { permission: 'tenant:write', tags: T, summary: 'Change labels, options, visibility or order', params: IdParams, body: Type.Partial(Body) }, async (ctx, req) => svc.update(ctx, req.params.id, req.body));
  r.delete('/custom_field_definitions/:id', { permission: 'tenant:write', tags: T, summary: 'Remove a field (stored values stay on records)', params: IdParams }, async (ctx, req) => svc.remove(ctx, req.params.id));

  r.get(
    '/tags',
    { permission: 'catalog:read', tags: ['Tags'], summary: 'Tags in use, most used first', querystring: Type.Object({ entity: Type.Union([Type.Literal('product'), Type.Literal('order'), Type.Literal('customer')]), q: Type.Optional(Type.String()) }) },
    async (ctx, req) => ({ object: 'list', data: await customfields.tagsFor(ctx, req.query.entity, req.query.q) }),
  );
}
