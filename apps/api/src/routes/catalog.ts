import { catalog } from '@openrent/core';
import type { Router } from '../http.ts';
import { parseList } from '../http.ts';
import { Id, IdParams, Json, ListQuery, Nullable, Page, PriceStructureInput, Product, ProductInput, ProductPatch, Type, VariantInput, ok } from '../schemas.ts';

export function registerCatalog(r: Router) {
  const P = ['Products'];
  r.get('/products', { permission: 'catalog:read', tags: P, summary: 'List products (filters: type, visibility, category_id, tag)', querystring: ListQuery, response: ok(Page(Product)) }, async (ctx, req) =>
    catalog.listProducts(ctx, parseList(req.query)),
  );
  r.post('/products', { permission: 'catalog:write', tags: P, summary: 'Create a product with variants (and bundle components)', body: ProductInput, response: ok(Product, 201) }, async (ctx, req) => catalog.createProduct(ctx, req.body));
  r.get('/products/:id', { permission: 'catalog:read', tags: P, summary: 'Get a product by id or slug', params: IdParams, response: ok(Product) }, async (ctx, req) => catalog.getProduct(ctx, req.params.id));
  r.patch('/products/:id', { permission: 'catalog:write', tags: P, summary: 'Update a product', params: IdParams, body: ProductPatch, response: ok(Product) }, async (ctx, req) => catalog.updateProduct(ctx, req.params.id, req.body));
  r.delete('/products/:id', { permission: 'catalog:write', tags: P, summary: 'Delete a product without open orders', params: IdParams }, async (ctx, req) => catalog.deleteProduct(ctx, req.params.id));
  r.post('/products/:id/actions/archive', { permission: 'catalog:write', tags: P, summary: 'Archive (hide everywhere, keep history)', params: IdParams, status: 200 }, async (ctx, req) => catalog.archiveProduct(ctx, req.params.id));
  r.post('/products/:id/actions/duplicate', { permission: 'catalog:write', tags: P, summary: 'Copy a product as a hidden draft', params: IdParams }, async (ctx, req) => catalog.duplicateProduct(ctx, req.params.id));

  r.get('/products/:id/variants', { permission: 'catalog:read', tags: P, summary: 'List variants', params: IdParams }, async (ctx, req) => ({ object: 'list', data: await catalog.listVariants(ctx, req.params.id) }));
  r.post('/products/:id/variants', { permission: 'catalog:write', tags: P, summary: 'Add a variant', params: IdParams, body: VariantInput }, async (ctx, req) => catalog.createVariant(ctx, req.params.id, req.body));
  r.get('/variants/:id', { permission: 'catalog:read', tags: P, summary: 'Get a variant', params: IdParams }, async (ctx, req) => catalog.getVariant(ctx, req.params.id));
  r.patch('/variants/:id', { permission: 'catalog:write', tags: P, summary: 'Update a variant (tracking changes are blocked while allocations exist)', params: IdParams, body: VariantInput }, async (ctx, req) =>
    catalog.updateVariant(ctx, req.params.id, req.body),
  );
  r.delete('/variants/:id', { permission: 'catalog:write', tags: P, summary: 'Delete a variant', params: IdParams }, async (ctx, req) => catalog.deleteVariant(ctx, req.params.id));

  // Bundles are products of type bundle; their id is the product's (PRD §5.4).
  const BundleCreate = Type.Intersect([Type.Omit(ProductInput, ['type']), Type.Object({ bundle: Type.Index(ProductInput, ['bundle']) })]);
  r.get('/products/:id/relations', { permission: 'catalog:read', tags: P, summary: 'Accessories, related products and those often rented with it (FR-CAT-7)', params: IdParams }, async (ctx, req) =>
    catalog.relationsToApi((await catalog.relationsOf(ctx, [req.params.id])).get(req.params.id)!),
  );
  r.put(
    '/products/:id/relations',
    {
      permission: 'catalog:write', tags: P, summary: 'Set the accessories and related products (often rented with is worked out from bookings)', params: IdParams,
      body: Type.Object({ accessory: Type.Optional(Type.Array(Id, { maxItems: 50 })), related: Type.Optional(Type.Array(Id, { maxItems: 50 })) }, { additionalProperties: false }),
    },
    async (ctx, req) => catalog.setRelations(ctx, req.params.id, req.body),
  );
  r.get('/bundles', { permission: 'catalog:read', tags: P, summary: 'List bundles (products of type bundle) with their components and slots', querystring: ListQuery, response: ok(Page(Product)) }, async (ctx, req) => {
    const q = parseList(req.query);
    return catalog.listProducts(ctx, { ...q, filters: { ...(q.filters ?? {}), type: { eq: ['bundle'] } } });
  });
  r.post('/bundles', { permission: 'catalog:write', tags: P, summary: 'Create a bundle: a product of fixed components and slots of alternatives', body: BundleCreate, response: ok(Product, 201) }, async (ctx, req) =>
    catalog.createProduct(ctx, { ...(req.body as any), type: 'bundle' }),
  );
  r.get('/bundles/:id', { permission: 'catalog:read', tags: P, summary: 'Get a bundle', params: IdParams, response: ok(Product) }, async (ctx, req) => catalog.getBundle(ctx, req.params.id));
  r.patch('/bundles/:id', { permission: 'catalog:write', tags: P, summary: 'Update a bundle', params: IdParams, body: ProductPatch, response: ok(Product) }, async (ctx, req) => {
    await catalog.getBundle(ctx, req.params.id);
    return catalog.updateProduct(ctx, req.params.id, req.body);
  });
  r.delete('/bundles/:id', { permission: 'catalog:write', tags: P, summary: 'Delete a bundle without open orders', params: IdParams }, async (ctx, req) => {
    await catalog.getBundle(ctx, req.params.id);
    return catalog.deleteProduct(ctx, req.params.id);
  });
  r.get('/bundles/:id/components', { permission: 'catalog:read', tags: P, summary: 'Bundle components (id = bundle product id)', params: IdParams }, async (ctx, req) => ({ object: 'list', data: (await catalog.getProduct(ctx, req.params.id)).bundle?.components ?? [] }));
  r.put(
    '/bundles/:id/components',
    {
      permission: 'catalog:write',
      tags: P,
      summary: 'Replace bundle components (id = bundle product id)',
      params: IdParams,
      body: Type.Object({ pricing_mode: Type.Optional(Type.Union([Type.Literal('sum'), Type.Literal('fixed'), Type.Literal('discount_pct')])), discount_bp: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })), components: Type.Array(Type.Object({ variant_id: Id, quantity: Type.Integer({ minimum: 1 }), slot_name: Type.Optional(Nullable(Type.String({ maxLength: 80 }))) }), { minItems: 1 }) }),
    },
    async (ctx, req) => catalog.updateProduct(ctx, req.params.id, { bundle: req.body }),
  );

  const crud = (path: string, svc: any, tag: string, body: any, perm: 'catalog' | 'pricing') => {
    r.get(`/${path}`, { permission: `${perm}:read` as any, tags: [tag], summary: `List ${path.replace('_', ' ')}`, querystring: ListQuery }, async (ctx, req) => svc.list(ctx, parseList(req.query)));
    r.post(`/${path}`, { permission: `${perm}:write` as any, tags: [tag], summary: `Create`, body }, async (ctx, req) => svc.create(ctx, req.body));
    r.get(`/${path}/:id`, { permission: `${perm}:read` as any, tags: [tag], summary: `Get`, params: IdParams }, async (ctx, req) => svc.get(ctx, req.params.id));
    r.patch(`/${path}/:id`, { permission: `${perm}:write` as any, tags: [tag], summary: `Update`, params: IdParams, body: Type.Partial(body) }, async (ctx, req) => svc.update(ctx, req.params.id, req.body));
    r.delete(`/${path}/:id`, { permission: `${perm}:write` as any, tags: [tag], summary: `Delete`, params: IdParams }, async (ctx, req) => svc.remove(ctx, req.params.id));
  };

  crud('categories', catalog.categories, 'Categories', Type.Object({ name: Type.String({ minLength: 1 }), slug: Type.Optional(Type.String()), parent_id: Type.Optional(Nullable(Id)), position: Type.Optional(Type.Integer()), translations: Type.Optional(Json) }, { additionalProperties: false }), 'catalog');
  crud('price_structures', catalog.priceStructures, 'Pricing', PriceStructureInput, 'pricing');
  crud('tax_profiles', catalog.taxProfiles, 'Pricing', Type.Object({ name: Type.String({ minLength: 1 }), rates: Type.Array(Type.Object({ name: Type.String(), rate_bp: Type.Integer({ minimum: 0, maximum: 10000 }) })), is_default: Type.Optional(Type.Boolean()) }, { additionalProperties: false }), 'pricing');
  crud(
    'coupons',
    catalog.coupons,
    'Pricing',
    Type.Object(
      {
        code: Type.String({ minLength: 2, maxLength: 40 }),
        kind: Type.Union([Type.Literal('percent'), Type.Literal('fixed')]),
        value: Type.Integer({ minimum: 0, description: 'Basis points for percent (1000 = 10%), minor units for fixed' }),
        scope: Type.Optional(Type.Object({ type: Type.Union([Type.Literal('order'), Type.Literal('category'), Type.Literal('product')]), ids: Type.Optional(Type.Array(Id)) })),
        valid_from: Type.Optional(Nullable(Type.String({ format: 'date-time' }))),
        valid_until: Type.Optional(Nullable(Type.String({ format: 'date-time' }))),
        max_uses: Type.Optional(Nullable(Type.Integer({ minimum: 1 }))),
        max_uses_per_customer: Type.Optional(Nullable(Type.Integer({ minimum: 1 }))),
        min_order: Type.Optional(Type.Integer({ minimum: 0 })),
        combinable: Type.Optional(Type.Boolean()),
        active: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
    'pricing',
  );
  crud(
    'price_rules',
    catalog.priceRules,
    'Pricing',
    Type.Object(
      {
        name: Type.String({ minLength: 1, maxLength: 120 }),
        kind: Type.Union(['season', 'weekday', 'holiday', 'customer_group', 'volume', 'lead_time'].map((k) => Type.Literal(k))),
        adjustment_bp: Type.Integer({ minimum: -10000, maximum: 100000, description: 'Basis points: -1000 = 10% off, 2500 = 25% more' }),
        priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000, description: 'Lower runs first' })),
        stackable: Type.Optional(Type.Boolean({ description: 'Applies together with other stackable rules' })),
        active: Type.Optional(Type.Boolean()),
        product_ids: Type.Optional(Type.Array(Id, { description: 'Empty: every rental product' })),
        category_ids: Type.Optional(Type.Array(Id)),
        starts_on: Type.Optional(Nullable(Type.String({ format: 'date', description: 'season, holiday: first day (shop time zone)' }))),
        ends_on: Type.Optional(Nullable(Type.String({ format: 'date', description: 'season, holiday: last day, inclusive' }))),
        weekdays: Type.Optional(Type.Array(Type.Integer({ minimum: 0, maximum: 6 }), { description: 'weekday: 0 = Sunday … 6 = Saturday' })),
        customer_tags: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
        min_quantity: Type.Optional(Nullable(Type.Integer({ minimum: 1 }))),
        min_lead_days: Type.Optional(Nullable(Type.Integer({ minimum: 0 }))),
        max_lead_days: Type.Optional(Nullable(Type.Integer({ minimum: 0 }))),
      },
      { additionalProperties: false },
    ),
    'pricing',
  );
  crud(
    'fee_rules',
    catalog.feeRules,
    'Pricing',
    Type.Object(
      {
        name: Type.String({ minLength: 1, maxLength: 120 }),
        kind: Type.Union(['delivery', 'cleaning', 'damage_waiver', 'extension', 'late'].map((k) => Type.Literal(k))),
        calculation: Type.Union(['flat', 'per_unit', 'percent', 'per_period', 'zone'].map((k) => Type.Literal(k))),
        amount: Type.Optional(Type.Integer({ minimum: 0, description: 'Minor units; basis points for percent (1000 = 10%)' })),
        period_unit: Type.Optional(Nullable(Type.Union(['hour', 'day', 'week', 'month'].map((k) => Type.Literal(k))))),
        zones: Type.Optional(Type.Array(Type.Object({ postcodes: Type.Array(Type.String({ minLength: 1, maxLength: 20 }), { maxItems: 200 }), amount: Type.Integer({ minimum: 0 }) }), { maxItems: 50 })),
        mode: Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('optional')], { description: 'optional: the customer chooses it at checkout' })),
        product_ids: Type.Optional(Type.Array(Id)),
        category_ids: Type.Optional(Type.Array(Id)),
        tax_profile_id: Type.Optional(Nullable(Id)),
        translations: Type.Optional(Json),
        description: Type.Optional(Type.String({ maxLength: 500 })),
        position: Type.Optional(Type.Integer()),
        active: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
    'pricing',
  );
  r.post('/coupons/:id/actions/disable', { permission: 'pricing:write', tags: ['Pricing'], summary: 'Disable a coupon', params: IdParams, status: 200 }, async (ctx, req) => catalog.coupons.update(ctx, req.params.id, { active: false }));
}
