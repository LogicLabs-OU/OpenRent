import { t as msg } from '../i18n/index.ts';
import { validateCustomFields } from '../customfields/index.ts';
import { cleanRichText } from '../storefront/code.ts';

/** Descriptions (base and per language) cleaned for the storefront; only the fields present are returned. */
function cleanDescriptions(input: { description?: string; translations?: Record<string, any> }) {
  const out: { description?: string; translations?: Record<string, any> } = {};
  if (input.description !== undefined) out.description = cleanRichText(input.description);
  if (input.translations)
    out.translations = Object.fromEntries(
      Object.entries(input.translations).map(([l, v]) => [l, v && typeof v === 'object' && typeof v.description === 'string' ? { ...v, description: cleanRichText(v.description) } : v]),
    );
  return out;
}
import type { Ctx } from '../context.ts';
import { makeCrud } from '../crud.ts';
import { AppError, invalid, notFound, type FieldError } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId } from '../ids.ts';
import { exec, json, listPage, many, must, one, updateSql, type ListParams } from '../sql.ts';
import { slugify } from '../tenancy/index.ts';
import type { FeeRule, PriceRule, PriceStructure } from '../pricing/engine.ts';
import { imagesFor } from './images.ts';

export { relationsOf, setRelations, relationsToApi, computeOftenRentedWith, type RelationKind } from './relations.ts';

export * from './images.ts';

// ---------------------------------------------------------------------------
// Price structures, tax profiles, categories, coupons (generic CRUD)
// ---------------------------------------------------------------------------

export function priceStructureToApi(r: any) {
  return {
    id: r.id, object: 'price_structure', name: r.name, kind: r.kind, period_unit: r.period_unit, amount: Number(r.amount),
    currency: r.currency?.trim(), rounding: r.rounding, charge_day_rules: r.charge_day_rules, tiers: r.tiers, cap: r.cap,
    price_table: r.price_table, extra_per_period: Number(r.extra_per_period), created_at: r.created_at, updated_at: r.updated_at,
  };
}

export function toEngineStructure(r: any): PriceStructure | null {
  if (!r) return null;
  return {
    id: r.id, kind: r.kind, period_unit: r.period_unit, amount: Number(r.amount), rounding: r.rounding,
    charge_day_rules: r.charge_day_rules, tiers: r.tiers, cap: r.cap, price_table: r.price_table, extra_per_period: Number(r.extra_per_period ?? 0),
  };
}

export const priceStructures = makeCrud({
  table: 'price_structures',
  prefix: 'prs',
  entity: 'price_structure',
  event: 'price_structure',
  softDelete: true,
  columns: {
    name: {}, kind: {}, period_unit: {}, amount: {}, rounding: {}, charge_day_rules: { json: true }, tiers: { json: true },
    cap: { json: true }, price_table: { json: true }, extra_per_period: {}, currency: {},
  },
  defaults: async (ctx) => ({ currency: (await one(ctx, `SELECT currency FROM tenants WHERE id = $1`, [ctx.tenantId]))?.currency }),
  list: { filters: { kind: 'kind' }, sorts: { name: 'name', created_at: 'created_at' }, defaultSort: 'name', search: ['name'] },
  toApi: priceStructureToApi,
});

export function taxProfileToApi(r: any) {
  return { id: r.id, object: 'tax_profile', name: r.name, rates: r.rates, rate_bp: (r.rates ?? []).reduce((a: number, x: any) => a + Number(x.rate_bp ?? 0), 0), is_default: r.is_default, created_at: r.created_at };
}

export const taxProfiles = makeCrud({
  table: 'tax_profiles',
  prefix: 'tax',
  entity: 'tax_profile',
  softDelete: true,
  columns: { name: {}, rates: { json: true }, is_default: {} },
  list: { filters: {}, sorts: { name: 'name' }, defaultSort: 'name' },
  toApi: taxProfileToApi,
  beforeWrite: async (ctx, data, existing) => {
    if (data.is_default) await exec(ctx, `UPDATE tax_profiles SET is_default = false WHERE is_default AND id <> $1`, [existing?.id ?? '']);
  },
});

export function categoryToApi(r: any) {
  return { id: r.id, object: 'category', name: r.name, slug: r.slug, parent_id: r.parent_id, position: r.position, translations: r.translations, created_at: r.created_at };
}

export const categories = makeCrud({
  table: 'categories',
  prefix: 'cat',
  entity: 'category',
  softDelete: true,
  columns: { name: {}, slug: {}, parent_id: {}, position: {}, translations: { json: true } },
  list: { filters: { parent_id: 'parent_id' }, sorts: { position: 'position', name: 'name' }, defaultSort: 'position,name', search: ['name'] },
  toApi: categoryToApi,
  beforeWrite: (_ctx, data) => {
    if (data.name && !data.slug) data.slug = slugify(data.name);
  },
});

export function couponToApi(r: any) {
  return {
    id: r.id, object: 'coupon', code: r.code, kind: r.kind, value: Number(r.value), scope: r.scope, valid_from: r.valid_from, valid_until: r.valid_until,
    max_uses: r.max_uses, max_uses_per_customer: r.max_uses_per_customer, min_order: Number(r.min_order), combinable: r.combinable,
    uses_count: r.uses_count, active: r.active, created_at: r.created_at,
  };
}

export const coupons = makeCrud({
  table: 'coupons',
  prefix: 'cpn',
  entity: 'coupon',
  event: 'coupon',
  columns: { code: {}, kind: {}, value: {}, scope: { json: true }, valid_from: {}, valid_until: {}, max_uses: {}, max_uses_per_customer: {}, min_order: {}, combinable: {}, active: {} },
  list: { filters: { active: 'active', kind: 'kind' }, sorts: { code: 'code', created_at: 'created_at' }, defaultSort: '-created_at', search: ['code'] },
  toApi: couponToApi,
  beforeWrite: (_ctx, data) => {
    if (data.kind === 'percent' && data.value > 10000) throw invalid(msg('error.percent_coupons_take_basis_points_10000_100'));
  },
});

export function priceRuleToApi(r: any) {
  return {
    id: r.id, object: 'price_rule', name: r.name, kind: r.kind, priority: r.priority, adjustment_bp: r.adjustment_bp, stackable: r.stackable,
    active: r.active, product_ids: r.product_ids ?? [], category_ids: r.category_ids ?? [], starts_on: r.starts_on, ends_on: r.ends_on,
    weekdays: r.weekdays ?? [], customer_tags: r.customer_tags ?? [], min_quantity: r.min_quantity, min_lead_days: r.min_lead_days,
    max_lead_days: r.max_lead_days, created_at: r.created_at, updated_at: r.updated_at,
  };
}

/** Each kind needs its own condition; a rule without one would never apply, so it is refused (422 per field). */
function checkPriceRule(r: Record<string, any>) {
  const errors: FieldError[] = [];
  const need = (field: string, message: string) => errors.push({ field, code: 'required', message });
  switch (r.kind) {
    case 'season':
    case 'holiday':
      if (!r.starts_on) need('starts_on', msg('error.field.price_rule_dates'));
      if (!r.ends_on) need('ends_on', msg('error.field.price_rule_dates'));
      break;
    case 'weekday':
      if (!r.weekdays?.length) need('weekdays', msg('error.field.price_rule_weekdays'));
      break;
    case 'customer_group':
      if (!r.customer_tags?.length) need('customer_tags', msg('error.field.price_rule_tags'));
      break;
    case 'volume':
      if (!(r.min_quantity >= 1)) need('min_quantity', msg('error.field.price_rule_quantity'));
      break;
    case 'lead_time':
      if (r.min_lead_days == null && r.max_lead_days == null) need('min_lead_days', msg('error.field.price_rule_lead'));
      break;
  }
  if (r.adjustment_bp === 0) errors.push({ field: 'adjustment_bp', code: 'invalid', message: msg('error.field.price_rule_adjustment') });
  if (r.starts_on && r.ends_on && r.ends_on < r.starts_on) errors.push({ field: 'ends_on', code: 'invalid_range', message: msg('error.field.price_rule_end_before_start') });
  if (errors.length) throw invalid(msg('error.price_rule_invalid'), errors);
}

export const priceRules = makeCrud({
  table: 'price_rules',
  prefix: 'prl',
  entity: 'price_rule',
  event: 'price_rule',
  softDelete: true,
  columns: {
    name: {}, kind: {}, priority: {}, adjustment_bp: {}, stackable: {}, active: {}, product_ids: {}, category_ids: {}, starts_on: {}, ends_on: {},
    weekdays: {}, customer_tags: {}, min_quantity: {}, min_lead_days: {}, max_lead_days: {},
  },
  list: { filters: { kind: 'kind', active: 'active' }, sorts: { priority: 'priority', name: 'name', created_at: 'created_at' }, defaultSort: 'priority,name', search: ['name'] },
  toApi: priceRuleToApi,
  beforeWrite: (_ctx, data, existing) => checkPriceRule({ ...(existing ? priceRuleToApi(existing) : {}), ...data }),
});

/** Active rules in the engine's shape, for quotes. */
export async function activePriceRules(ctx: Ctx): Promise<PriceRule[]> {
  const rows = await many<any>(ctx, `SELECT * FROM price_rules WHERE deleted_at IS NULL AND active`);
  return rows.map((r) => {
    const a = priceRuleToApi(r);
    return { ...a, starts_on: a.starts_on ? String(a.starts_on).slice(0, 10) : null, ends_on: a.ends_on ? String(a.ends_on).slice(0, 10) : null };
  });
}

export function feeRuleToApi(r: any) {
  return {
    id: r.id, object: 'fee_rule', name: r.name, kind: r.kind, calculation: r.calculation, amount: Number(r.amount), period_unit: r.period_unit,
    zones: (r.zones ?? []).map((z: any) => ({ postcodes: z.postcodes ?? [], amount: Number(z.amount ?? 0) })), mode: r.mode,
    product_ids: r.product_ids ?? [], category_ids: r.category_ids ?? [], tax_profile_id: r.tax_profile_id, translations: r.translations ?? {},
    description: r.description ?? '', position: r.position, active: r.active, created_at: r.created_at, updated_at: r.updated_at,
  };
}

/** What each calculation needs; extension and late fees are added by those actions, not chosen at checkout. */
function checkFeeRule(r: Record<string, any>) {
  const errors: FieldError[] = [];
  if (r.calculation === 'percent' && !(r.amount > 0 && r.amount <= 10000)) errors.push({ field: 'amount', code: 'invalid', message: msg('error.field.fee_percent') });
  if (r.calculation !== 'percent' && r.calculation !== 'zone' && !(r.amount > 0)) errors.push({ field: 'amount', code: 'invalid', message: msg('error.field.enter_an_amount') });
  if (r.calculation === 'per_period' && !r.period_unit) errors.push({ field: 'period_unit', code: 'required', message: msg('error.field.fee_period_unit') });
  if (r.calculation === 'zone' && !(r.zones ?? []).some((z: any) => z.postcodes?.length)) errors.push({ field: 'zones', code: 'required', message: msg('error.field.fee_zones') });
  if (r.calculation === 'zone' && r.kind !== 'delivery') errors.push({ field: 'calculation', code: 'invalid', message: msg('error.field.fee_zone_delivery_only') });
  if ((r.kind === 'extension' || r.kind === 'late') && r.mode === 'optional') errors.push({ field: 'mode', code: 'invalid', message: msg('error.field.fee_not_optional') });
  if (errors.length) throw invalid(msg('error.fee_rule_invalid'), errors);
}

export const feeRules = makeCrud({
  table: 'fee_rules',
  prefix: 'fee',
  entity: 'fee_rule',
  event: 'fee_rule',
  softDelete: true,
  columns: {
    name: {}, kind: {}, calculation: {}, amount: {}, period_unit: {}, zones: { json: true }, mode: {}, product_ids: {}, category_ids: {},
    tax_profile_id: {}, translations: { json: true }, description: {}, position: {}, active: {},
  },
  list: { filters: { kind: 'kind', active: 'active', mode: 'mode' }, sorts: { position: 'position', name: 'name' }, defaultSort: 'position,name', search: ['name'] },
  toApi: feeRuleToApi,
  beforeWrite: (_ctx, data, existing) => checkFeeRule({ ...(existing ? feeRuleToApi(existing) : {}), ...data }),
});

/** Active fee rules in the engine's shape, with their tax rate and the name in `locale`. */
/**
 * The tax profile a product uses at a location: a location with its own profile replaces the shop's
 * default there (a branch in another country); products with a profile of their own keep it.
 */
export async function taxProfileAt(ctx: Ctx, locationId: string | null | undefined) {
  const loc = await one<{ tax_profile_id: string | null }>(
    ctx,
    locationId ? `SELECT tax_profile_id FROM locations WHERE id = $1` : `SELECT tax_profile_id FROM locations WHERE deleted_at IS NULL ORDER BY is_default DESC, created_at LIMIT 1`,
    locationId ? [locationId] : [],
  );
  if (!loc?.tax_profile_id) return (p: string | null) => p;
  const def = (await one<{ id: string }>(ctx, `SELECT id FROM tax_profiles WHERE is_default AND deleted_at IS NULL LIMIT 1`))?.id ?? null;
  return (p: string | null) => (!p || p === def ? loc.tax_profile_id : p);
}

export async function activeFeeRules(ctx: Ctx, locale?: string | null, kinds?: string[], locationId?: string | null): Promise<(FeeRule & { description: string })[]> {
  const profileOf = await taxProfileAt(ctx, locationId);
  const rows = await many<any>(ctx, `SELECT * FROM fee_rules WHERE deleted_at IS NULL AND active AND ($1::text[] IS NULL OR kind = ANY($1)) ORDER BY position, name`, [kinds ?? null]);
  const rates = new Map<string, number>();
  const rateOf = async (profileId: string | null) => {
    const key = profileId ?? '';
    if (!rates.has(key)) {
      const p = profileId ? await one(ctx, `SELECT rates FROM tax_profiles WHERE id = $1`, [profileId]) : await one(ctx, `SELECT rates FROM tax_profiles WHERE is_default AND deleted_at IS NULL LIMIT 1`);
      rates.set(key, (p?.rates ?? []).reduce((a: number, r: any) => a + Number(r.rate_bp ?? 0), 0));
    }
    return rates.get(key)!;
  };
  const out = [];
  for (const r of rows) {
    const a = feeRuleToApi(r);
    const tr = (locale && a.translations?.[locale]) || {};
    out.push({ ...a, name: tr.name?.trim() || a.name, description: tr.description?.trim() || a.description, tax_rate_bp: await rateOf(profileOf(a.tax_profile_id)) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Products and variants
// ---------------------------------------------------------------------------

export type Tracking = 'serialized' | 'bulk' | 'none';

export interface VariantInput {
  name?: string;
  sku?: string | null;
  tracking?: Tracking;
  options?: Record<string, string>;
  translations?: Record<string, { name?: string }>;
  price_structure_id?: string | null;
  price?: Partial<PriceStructure> & { kind: PriceStructure['kind'] };
  deposit_amount?: number | null;
  is_default?: boolean;
  position?: number;
  /** Staff are told when fewer than this many are free in the coming days (FR-NOT-3). */
  low_availability_threshold?: number | null;
  /** Booking rules for this variant; null uses the product's (FR-AV-3/4). */
  buffer_before_min?: number | null;
  buffer_after_min?: number | null;
  min_duration_min?: number | null;
  max_duration_min?: number | null;
  min_notice_min?: number | null;
  increment_min?: number | null;
}

const VARIANT_RULES = ['buffer_before_min', 'buffer_after_min', 'min_duration_min', 'max_duration_min', 'min_notice_min', 'increment_min'] as const;

export interface ProductInput {
  type: 'rental' | 'sale' | 'service' | 'consumable' | 'bundle';
  name: string;
  slug?: string;
  description?: string;
  visibility?: 'public' | 'hidden' | 'archived';
  tags?: string[];
  category_ids?: string[];
  tax_profile_id?: string | null;
  deposit_amount?: number;
  buffer_before_min?: number;
  buffer_after_min?: number;
  min_duration_min?: number | null;
  max_duration_min?: number | null;
  min_notice_min?: number;
  increment_min?: number | null;
  custom_fields?: Record<string, unknown>;
  translations?: Record<string, unknown>;
  seo?: Record<string, unknown>;
  tracking?: Tracking;
  meter_unit?: string | null;
  depreciation_months?: number | null;
  residual_bp?: number;
  price?: VariantInput['price'];
  variants?: VariantInput[];
  bundle?: { pricing_mode?: 'sum' | 'fixed' | 'discount_pct'; discount_bp?: number; components: { variant_id: string; quantity: number; slot_name?: string | null }[] };
}

const PRODUCT_COLS = {
  type: {}, name: {}, slug: {}, description: {}, visibility: {}, tags: {}, tax_profile_id: {}, deposit_amount: {}, buffer_before_min: {},
  buffer_after_min: {}, min_duration_min: {}, max_duration_min: {}, min_notice_min: {}, increment_min: {}, custom_fields: { json: true },
  translations: { json: true }, seo: { json: true }, meter_unit: {}, depreciation_months: {}, residual_bp: {},
};

export function variantToApi(v: any, currency?: string) {
  return {
    id: v.id, object: 'variant', product_id: v.product_id, name: v.name, sku: v.sku, options: v.options, translations: v.translations ?? {}, tracking: v.tracking,
    price_structure_id: v.price_structure_id, price_structure: v.price_structure ? priceStructureToApi(v.price_structure) : undefined,
    deposit_amount: v.deposit_amount == null ? null : Number(v.deposit_amount), is_default: v.is_default, position: v.position,
    ...Object.fromEntries(VARIANT_RULES.map((k) => [k, v[k] ?? null])),
    low_availability_threshold: v.low_availability_threshold ?? null,
    stock: v.stock ?? undefined, currency, created_at: v.created_at, updated_at: v.updated_at,
  };
}

export function productToApi(p: any, extra: { variants?: any[]; category_ids?: string[]; bundle?: any; currency?: string; images?: any[] } = {}) {
  return {
    id: p.id, object: 'product', type: p.type, name: p.name, slug: p.slug, description: p.description, visibility: p.visibility, tags: p.tags,
    translations: p.translations, seo: p.seo, tax_profile_id: p.tax_profile_id, deposit_amount: Number(p.deposit_amount),
    buffer_before_min: p.buffer_before_min, buffer_after_min: p.buffer_after_min, min_duration_min: p.min_duration_min,
    max_duration_min: p.max_duration_min, min_notice_min: p.min_notice_min, increment_min: p.increment_min, custom_fields: p.custom_fields,
    meter_unit: p.meter_unit ?? null, depreciation_months: p.depreciation_months ?? null, residual_bp: p.residual_bp ?? 0,
    category_ids: extra.category_ids ?? [], variants: (extra.variants ?? []).map((v) => variantToApi(v, extra.currency)), bundle: extra.bundle ?? null, images: extra.images ?? [],
    created_at: p.created_at, updated_at: p.updated_at,
  };
}

async function tenantCurrency(ctx: Ctx): Promise<string> {
  return (await must<{ currency: string }>(ctx, `SELECT currency FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant')).currency.trim();
}

async function createInlineStructure(ctx: Ctx, name: string, price: NonNullable<VariantInput['price']>): Promise<string> {
  const s = await priceStructures.create(ctx, {
    name,
    kind: price.kind,
    period_unit: price.period_unit ?? 'day',
    amount: price.amount ?? 0,
    rounding: price.rounding ?? 'up',
    charge_day_rules: price.charge_day_rules ?? {},
    tiers: price.tiers ?? [],
    cap: price.cap ?? null,
    price_table: price.price_table ?? [],
    extra_per_period: price.extra_per_period ?? 0,
  });
  return s.id;
}

/** A variant may not allow a longest rental shorter than its shortest one (its own or the product's values). */
function assertDurations(v: { min_duration_min?: number | null; max_duration_min?: number | null }, fallback: { min_duration_min?: number | null; max_duration_min?: number | null }) {
  const min = v.min_duration_min ?? fallback.min_duration_min;
  const max = v.max_duration_min ?? fallback.max_duration_min;
  if (min != null && max != null && max < min)
    throw invalid(msg('error.check_the_highlighted_fields'), [{ field: 'max_duration_min', code: 'below_min', message: msg('error.field.max_below_min') }]);
}

async function insertVariant(ctx: Ctx, product: { id: string; name: string; type: string }, v: VariantInput, isDefault: boolean, position: number) {
  assertDurations(v, product as any);
  const tracking: Tracking = product.type === 'bundle' || product.type === 'service' ? 'none' : v.tracking ?? (product.type === 'rental' ? 'serialized' : 'bulk');
  const psId = v.price ? await createInlineStructure(ctx, `${product.name}${v.name ? ` – ${v.name}` : ''}`, v.price) : v.price_structure_id ?? null;
  const row = (
    await many(
      ctx,
      `INSERT INTO variants (id, tenant_id, product_id, sku, name, options, translations, tracking, price_structure_id, deposit_amount, is_default, position,
                             buffer_before_min, buffer_after_min, min_duration_min, max_duration_min, min_notice_min, increment_min)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [
        newId('var'), ctx.tenantId, product.id, v.sku ?? null, v.name ?? product.name, json(v.options ?? {}), json(v.translations ?? {}), tracking, psId, v.deposit_amount ?? null, isDefault, v.position ?? position,
        ...VARIANT_RULES.map((k) => v[k] ?? null),
      ],
    )
  )[0];
  await audit(ctx, { entity_type: 'variant', entity_id: row.id, action: 'create', after: row });
  return row;
}

async function loadProductExtras(ctx: Ctx, productIds: string[]) {
  if (productIds.length === 0) return { variants: new Map<string, any[]>(), cats: new Map<string, string[]>(), bundles: new Map<string, any>(), images: new Map<string, any[]>() };
  const vs = await many(
    ctx,
    `SELECT v.*, to_jsonb(ps.*) AS price_structure,
            CASE v.tracking
              WHEN 'serialized' THEN (SELECT jsonb_build_object('units', count(*) FILTER (WHERE s.status NOT IN ('retired','lost')), 'available_now', count(*) FILTER (WHERE s.status = 'available')) FROM stock_items s WHERE s.variant_id = v.id)
              WHEN 'bulk' THEN (SELECT jsonb_build_object('quantity', coalesce(sum(sl.quantity), 0)) FROM stock_levels sl WHERE sl.variant_id = v.id)
            END AS stock
       FROM variants v LEFT JOIN price_structures ps ON ps.id = v.price_structure_id
      WHERE v.product_id = ANY($1) AND v.deleted_at IS NULL ORDER BY v.position, v.created_at`,
    [productIds],
  );
  const cs = await many(ctx, `SELECT product_id, category_id FROM product_categories WHERE product_id = ANY($1)`, [productIds]);
  const bs = await many(
    ctx,
    `SELECT b.*, coalesce((SELECT jsonb_agg(jsonb_build_object('id', bc.id, 'variant_id', bc.variant_id, 'quantity', bc.quantity, 'slot_name', bc.slot_name,
              'name', p2.name || CASE WHEN v2.name <> p2.name THEN ' – ' || v2.name ELSE '' END) ORDER BY bc.position)
              FROM bundle_components bc JOIN variants v2 ON v2.id = bc.variant_id JOIN products p2 ON p2.id = v2.product_id WHERE bc.bundle_id = b.id), '[]') AS components
       FROM bundles b WHERE b.product_id = ANY($1)`,
    [productIds],
  );
  const variants = new Map<string, any[]>();
  for (const v of vs) variants.set(v.product_id, [...(variants.get(v.product_id) ?? []), v]);
  const cats = new Map<string, string[]>();
  for (const c of cs) cats.set(c.product_id, [...(cats.get(c.product_id) ?? []), c.category_id]);
  const bundles = new Map<string, any>();
  for (const b of bs) bundles.set(b.product_id, { id: b.id, pricing_mode: b.pricing_mode, discount_bp: b.discount_bp, components: b.components });
  return { variants, cats, bundles, images: await imagesFor(ctx, productIds) };
}

export async function getProductRow(ctx: Ctx, idOrSlug: string) {
  return must(ctx, `SELECT * FROM products WHERE (id = $1 OR slug = $1) AND deleted_at IS NULL`, [idOrSlug], 'product', idOrSlug);
}

export async function getProduct(ctx: Ctx, idOrSlug: string) {
  const p = await getProductRow(ctx, idOrSlug);
  const x = await loadProductExtras(ctx, [p.id]);
  return productToApi(p, { images: x.images.get(p.id), variants: x.variants.get(p.id), category_ids: x.cats.get(p.id), bundle: x.bundles.get(p.id), currency: await tenantCurrency(ctx) });
}

export async function listProducts(ctx: Ctx, params: ListParams & { categoryId?: string }) {
  const filters = { ...(params.filters ?? {}) };
  const baseWhere = 'deleted_at IS NULL';
  const catFilter = filters.category_id?.eq?.[0] ?? params.categoryId;
  delete filters.category_id;
  if (catFilter && !/^cat_[0-9A-Za-z]+$/.test(catFilter)) throw invalid(msg('error.unknown_category_id'));
  const page = await listPage<any>(
    ctx,
    {
      table: 'products',
      filters: { id: 'id', type: 'type', visibility: 'visibility', tag: "array_to_string(tags, ',')" },
      sorts: { name: 'name', created_at: 'created_at', updated_at: 'updated_at' },
      defaultSort: 'name',
      search: ['name', 'slug', 'description'],
      baseWhere: catFilter ? `${baseWhere} AND id IN (SELECT product_id FROM product_categories WHERE category_id = '${catFilter}')` : baseWhere,
    },
    { ...params, filters },
  );
  const x = await loadProductExtras(ctx, page.data.map((p) => p.id));
  const currency = await tenantCurrency(ctx);
  return { ...page, data: page.data.map((p) => productToApi(p, { images: x.images.get(p.id), variants: x.variants.get(p.id), category_ids: x.cats.get(p.id), bundle: x.bundles.get(p.id), currency })) };
}

async function setCategories(ctx: Ctx, productId: string, ids: string[]) {
  await exec(ctx, `DELETE FROM product_categories WHERE product_id = $1`, [productId]);
  for (const c of ids) {
    await exec(ctx, `INSERT INTO product_categories (tenant_id, product_id, category_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [ctx.tenantId, productId, c]);
  }
}

/** A product of type bundle, or a 404. */
export async function getBundle(ctx: Ctx, id: string) {
  const p = await getProduct(ctx, id);
  if (p.type !== 'bundle') throw notFound('bundle', id);
  return p;
}

async function setBundle(ctx: Ctx, productId: string, b: NonNullable<ProductInput['bundle']>) {
  if (!b.components?.length) throw invalid(msg('error.a_bundle_needs_at_least_one_component'), [{ field: 'bundle.components', code: 'required', message: msg('error.field.add_a_component') }]);
  for (const c of b.components) {
    const v = await one(ctx, `SELECT v.id, p.type FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`, [c.variant_id]);
    if (!v) throw invalid(msg('error.unknown_component_variant', { variant_id: c.variant_id }));
    if (v.type === 'bundle') throw invalid(msg('error.bundles_cannot_contain_other_bundles'));
  }
  let bundle = await one(ctx, `SELECT id FROM bundles WHERE product_id = $1`, [productId]);
  if (!bundle) {
    bundle = (await many(ctx, `INSERT INTO bundles (id, tenant_id, product_id, pricing_mode, discount_bp) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [
      newId('bun'), ctx.tenantId, productId, b.pricing_mode ?? 'sum', b.discount_bp ?? 0,
    ]))[0];
  } else {
    await exec(ctx, `UPDATE bundles SET pricing_mode = coalesce($2, pricing_mode), discount_bp = coalesce($3, discount_bp) WHERE id = $1`, [bundle.id, b.pricing_mode ?? null, b.discount_bp ?? null]);
    await exec(ctx, `DELETE FROM bundle_components WHERE bundle_id = $1`, [bundle.id]);
  }
  let pos = 0;
  for (const c of b.components) {
    await exec(ctx, `INSERT INTO bundle_components (id, tenant_id, bundle_id, slot_name, variant_id, quantity, position) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
      newId('bnc'), ctx.tenantId, bundle.id, c.slot_name ?? null, c.variant_id, c.quantity, pos++,
    ]);
  }
}

export async function createProduct(ctx: Ctx, input: ProductInput) {
  if (!input.name?.trim()) throw invalid(msg('error.name_is_required'), [{ field: 'name', code: 'required', message: msg('error.field.enter_a_name') }]);
  input = { ...input, custom_fields: await validateCustomFields(ctx, 'product', input.custom_fields), ...cleanDescriptions(input) };
  const slug = input.slug ? slugify(input.slug) : await uniqueSlug(ctx, slugify(input.name));
  const p = (
    await many(
      ctx,
      `INSERT INTO products (id, tenant_id, type, name, slug, description, visibility, tags, tax_profile_id, deposit_amount, buffer_before_min,
         buffer_after_min, min_duration_min, max_duration_min, min_notice_min, increment_min, custom_fields, translations, seo, meter_unit, depreciation_months, residual_bp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
      [
        newId('prod'), ctx.tenantId, input.type, input.name.trim(), slug, input.description ?? '', input.visibility ?? 'public', input.tags ?? [],
        input.tax_profile_id ?? (await one(ctx, `SELECT id FROM tax_profiles WHERE is_default AND deleted_at IS NULL`))?.id ?? null,
        input.deposit_amount ?? 0, input.buffer_before_min ?? 0, input.buffer_after_min ?? 0, input.min_duration_min ?? null, input.max_duration_min ?? null,
        input.min_notice_min ?? 0, input.increment_min ?? null, json(input.custom_fields ?? {}), json(input.translations ?? {}), json(input.seo ?? {}),
        input.meter_unit?.trim() || null, input.depreciation_months ?? null, input.residual_bp ?? 0,
      ],
    )
  )[0];
  // Variants listed without their own tracking or price take the product's.
  const variants = input.variants?.length ? input.variants.map((v) => ({ tracking: input.tracking, price: input.price, ...v })) : [{ name: input.name, tracking: input.tracking, price: input.price }];
  let i = 0;
  for (const v of variants) await insertVariant(ctx, p, v, i === 0, i++);
  if (input.category_ids?.length) await setCategories(ctx, p.id, input.category_ids);
  if (input.type === 'bundle') {
    if (!input.bundle) throw invalid(msg('error.bundle_products_need_components'), [{ field: 'bundle', code: 'required', message: msg('error.field.add_components') }]);
    await setBundle(ctx, p.id, input.bundle);
  }
  await audit(ctx, { entity_type: 'product', entity_id: p.id, action: 'create', after: p });
  const api = await getProduct(ctx, p.id);
  await emit(ctx, 'product.created', { type: 'product', id: p.id }, api);
  return api;
}

async function uniqueSlug(ctx: Ctx, base: string): Promise<string> {
  let slug = base;
  for (let i = 2; await one(ctx, `SELECT 1 FROM products WHERE slug = $1 AND deleted_at IS NULL`, [slug]); i++) slug = `${base}-${i}`;
  return slug;
}

export async function updateProduct(ctx: Ctx, id: string, patch: Partial<ProductInput>) {
  const before = await getProductRow(ctx, id);
  const data: Record<string, unknown> = { ...patch };
  if (patch.slug) data.slug = slugify(patch.slug);
  if (patch.meter_unit !== undefined) data.meter_unit = patch.meter_unit?.trim() || null;
  if (patch.custom_fields !== undefined) data.custom_fields = await validateCustomFields(ctx, 'product', patch.custom_fields);
  Object.assign(data, cleanDescriptions(patch));
  const q = updateSql('products', before.id, data, PRODUCT_COLS);
  if (q) await many(ctx, q.text, q.values);
  if (patch.category_ids) await setCategories(ctx, before.id, patch.category_ids);
  if (patch.bundle && before.type === 'bundle') await setBundle(ctx, before.id, patch.bundle);
  const after = await getProductRow(ctx, before.id);
  await audit(ctx, { entity_type: 'product', entity_id: before.id, action: 'update', before, after });
  const api = await getProduct(ctx, before.id);
  await emit(ctx, 'product.updated', { type: 'product', id: before.id }, api);
  return api;
}

export async function archiveProduct(ctx: Ctx, id: string) {
  const p = await updateProduct(ctx, id, { visibility: 'archived' });
  await emit(ctx, 'product.archived', { type: 'product', id: p.id }, p);
  return p;
}

export async function deleteProduct(ctx: Ctx, id: string) {
  const p = await getProductRow(ctx, id);
  const open = await one(
    ctx,
    `SELECT 1 FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE l.product_id = $1 AND o.status NOT IN ('closed','cancelled','expired') LIMIT 1`,
    [p.id],
  );
  if (open) throw new AppError('product_in_use', 409, msg('error.this_product_is_on_open_orders_archive'));
  await exec(ctx, `UPDATE products SET deleted_at = now(), slug = slug || '-deleted-' || extract(epoch from now())::bigint WHERE id = $1`, [p.id]);
  await exec(ctx, `UPDATE variants SET deleted_at = now() WHERE product_id = $1`, [p.id]);
  await audit(ctx, { entity_type: 'product', entity_id: p.id, action: 'delete', before: p });
}

export async function duplicateProduct(ctx: Ctx, id: string) {
  const src = await getProduct(ctx, id);
  return createProduct(ctx, {
    ...(src as any),
    name: `${src.name} (copy)`,
    slug: undefined,
    visibility: 'hidden',
    variants: src.variants.map((v: any) => ({ name: v.name, sku: null, tracking: v.tracking, options: v.options, price_structure_id: v.price_structure_id, deposit_amount: v.deposit_amount })),
    bundle: src.bundle ? { pricing_mode: src.bundle.pricing_mode, discount_bp: src.bundle.discount_bp, components: src.bundle.components } : undefined,
  });
}

export async function listVariants(ctx: Ctx, productId: string) {
  return (await getProduct(ctx, productId)).variants;
}

export async function createVariant(ctx: Ctx, productId: string, input: VariantInput) {
  const p = await getProductRow(ctx, productId);
  const count = (await one<{ n: number }>(ctx, `SELECT count(*)::int AS n FROM variants WHERE product_id = $1 AND deleted_at IS NULL`, [p.id]))!.n;
  const row = await insertVariant(ctx, p, input, count === 0, count);
  const api = variantToApi(row);
  await emit(ctx, 'variant.created', { type: 'variant', id: row.id }, api);
  return api;
}

export async function getVariant(ctx: Ctx, id: string) {
  const v = await must(ctx, `SELECT v.*, to_jsonb(ps.*) AS price_structure FROM variants v LEFT JOIN price_structures ps ON ps.id = v.price_structure_id WHERE v.id = $1 AND v.deleted_at IS NULL`, [id], 'variant', id);
  return variantToApi(v);
}

export async function updateVariant(ctx: Ctx, id: string, patch: VariantInput) {
  const before = await must(ctx, `SELECT * FROM variants WHERE id = $1 AND deleted_at IS NULL`, [id], 'variant', id);
  const product = await one(ctx, `SELECT min_duration_min, max_duration_min FROM products WHERE id = $1`, [before.product_id]);
  assertDurations({ min_duration_min: 'min_duration_min' in patch ? patch.min_duration_min : before.min_duration_min, max_duration_min: 'max_duration_min' in patch ? patch.max_duration_min : before.max_duration_min }, product ?? {});
  const data: Record<string, unknown> = { ...patch };
  if (patch.price) {
    if (before.price_structure_id) await priceStructures.update(ctx, before.price_structure_id, patch.price);
    else data.price_structure_id = await createInlineStructure(ctx, before.name, patch.price);
    delete data.price;
  }
  const q = updateSql('variants', id, data, {
    name: {}, sku: {}, tracking: {}, options: { json: true }, translations: { json: true }, price_structure_id: {}, deposit_amount: {}, position: {},
    ...Object.fromEntries(VARIANT_RULES.map((k) => [k, {}])),
    low_availability_threshold: {},
  });
  if (q) await many(ctx, q.text, q.values);
  const after = await one(ctx, `SELECT * FROM variants WHERE id = $1`, [id]);
  await audit(ctx, { entity_type: 'variant', entity_id: id, action: 'update', before, after });
  const api = await getVariant(ctx, id);
  await emit(ctx, 'variant.updated', { type: 'variant', id }, api);
  return api;
}

export async function deleteVariant(ctx: Ctx, id: string) {
  const v = await must(ctx, `SELECT * FROM variants WHERE id = $1 AND deleted_at IS NULL`, [id], 'variant', id);
  const busy = await one(ctx, `SELECT 1 FROM allocations WHERE variant_id = $1 AND (upper(period) IS NULL OR upper(period) > now()) LIMIT 1`, [id]);
  if (busy) throw new AppError('variant_in_use', 409, msg('error.this_variant_has_current_or_future_allocations'));
  await exec(ctx, `UPDATE variants SET deleted_at = now() WHERE id = $1`, [id]);
  await audit(ctx, { entity_type: 'variant', entity_id: id, action: 'delete', before: v });
}
