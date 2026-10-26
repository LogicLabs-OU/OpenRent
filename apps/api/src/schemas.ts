import { Type, type Static, type TSchema } from 'typebox';
import { LOCALES } from '@openrent/i18n';

export { Type };

export const Id = Type.String({ minLength: 1, maxLength: 64 });
export const IdParams = Type.Object({ id: Id });
/** One of the languages OpenRent ships in (en, de, fr, es, et, ja). */
export const Locale = Type.Union(LOCALES.map((l) => Type.Literal(l)));
export const DateTime = Type.String({ format: 'date-time', description: 'ISO 8601 with offset' });
const orNull = (s: any) => (typeof s.type === 'string' && !s.$id ? { ...s, type: [s.type, 'null'] } : s);
/**
 * `t` or null. Written as a type list (OpenAPI 3.1), not `anyOf`: with type coercion on, Ajv tries the
 * first branch of an `anyOf` and turns a null into "" or 0 before the null branch is reached. Unions get
 * the same on each member, with a plain null last for members that are constants.
 */
export const Nullable = <T extends TSchema>(t: T) => {
  const s = t as any;
  if (typeof s.type === 'string' && !s.$id) return Type.Unsafe<Static<T> | null>(orNull(s));
  if (Array.isArray(s.anyOf)) return Type.Unsafe<Static<T> | null>({ anyOf: [...s.anyOf.map(orNull), { type: 'null' }] });
  return Type.Union([t, Type.Null()]);
};
export const Money = Type.Object({ amount: Type.Integer({ description: 'Minor units' }), currency: Type.String({ minLength: 3, maxLength: 3 }) }, { $id: 'Money' });
export const Json = Type.Record(Type.String(), Type.Unknown());

export const Problem = Type.Object(
  {
    type: Type.String(),
    title: Type.String(),
    status: Type.Integer(),
    code: Type.String(),
    detail: Type.String(),
    errors: Type.Optional(Type.Array(Type.Object({ field: Type.String(), code: Type.String(), message: Type.String() }))),
    request_id: Type.String(),
  },
  { additionalProperties: true, description: 'RFC 9457 problem details' },
);

export const ListQuery = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
    cursor: Type.Optional(Type.String()),
    sort: Type.Optional(Type.String({ description: 'Comma separated; prefix with - for descending' })),
    q: Type.Optional(Type.String({ description: 'Full-text search' })),
    expand: Type.Optional(Type.String()),
  },
  { additionalProperties: true, description: 'Also accepts filter[field]=a,b and filter[field][gte|lte|gt|lt]=value' },
);

/** A list's filters and search, for spreadsheet downloads of the whole list (FR-INT-2). */
export const ExportQuery = Type.Object(
  {
    sort: Type.Optional(Type.String()),
    q: Type.Optional(Type.String()),
    format: Type.Optional(Type.Union([Type.Literal('csv'), Type.Literal('xlsx')], { default: 'csv' })),
  },
  { additionalProperties: true, description: 'Same filter[field] parameters as the list; at most 10,000 rows' },
);

/** Documentation shape for a resource; serialisation does not strip unknown fields. */
export const Resource = (object: string, props: Record<string, TSchema> = {}) =>
  Type.Object({ id: Type.String(), object: Type.Literal(object), ...props }, { additionalProperties: true });

export const Page = (item: TSchema) => Type.Object({ data: Type.Array(item), next_cursor: Nullable(Type.String()), has_more: Type.Boolean() });

export const ok = (schema: TSchema, status = 200) => ({ [status]: schema, '4xx': Problem });

const PriceStructureFields = {
  name: Type.Optional(Type.String()),
  kind: Type.Union([Type.Literal('fixed'), Type.Literal('per_period'), Type.Literal('tiered'), Type.Literal('table')]),
  period_unit: Type.Optional(Type.Union([Type.Literal('hour'), Type.Literal('day'), Type.Literal('week'), Type.Literal('month')])),
  amount: Type.Optional(Type.Integer({ minimum: 0 })),
  rounding: Type.Optional(Type.Union([Type.Literal('up'), Type.Literal('nearest'), Type.Literal('down')])),
  charge_day_rules: Type.Optional(
    Type.Object({
      non_billable_weekdays: Type.Optional(Type.Array(Type.Integer({ minimum: 0, maximum: 6 }))),
      free_pickup_day: Type.Optional(Type.Boolean({ description: 'Do not charge the pickup day (day prices only).' })),
      pickup_after: Type.Optional(Nullable(Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'The pickup day is free only when pickup is at or after this time (HH:MM, shop time).' }))),
      free_return_day: Type.Optional(Type.Boolean({ description: 'Do not charge the return day (day prices only).' })),
      return_before: Type.Optional(Nullable(Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'The return day is free only when the return is at or before this time (HH:MM, shop time).' }))),
    }),
  ),
  tiers: Type.Optional(Type.Array(Type.Object({ from: Type.Integer({ minimum: 1 }), pct_bp: Type.Integer({ minimum: 0 }) }))),
  cap: Type.Optional(Nullable(Type.Object({ every: Type.Integer({ minimum: 1 }), charge: Type.Number({ minimum: 0 }) }))),
  price_table: Type.Optional(Type.Array(Type.Object({ periods: Type.Integer({ minimum: 1 }), amount: Type.Integer({ minimum: 0 }) }))),
  extra_per_period: Type.Optional(Type.Integer({ minimum: 0 })),
};

export const PriceStructureInput = Type.Object(PriceStructureFields, { additionalProperties: false });

export const Tracking = Type.Union([Type.Literal('serialized'), Type.Literal('bulk'), Type.Literal('none')]);

export const VariantInput = Type.Object(
  {
    name: Type.Optional(Type.String()),
    sku: Type.Optional(Nullable(Type.String())),
    tracking: Type.Optional(Tracking),
    options: Type.Optional(Type.Record(Type.String(), Type.String())),
    /** Name per storefront language: { de: { name: "Groß" } }. */
    translations: Type.Optional(Type.Record(Type.String(), Type.Object({ name: Type.Optional(Type.String({ maxLength: 200 })) }))),
    price_structure_id: Type.Optional(Nullable(Id)),
    price: Type.Optional(PriceStructureInput),
    deposit_amount: Type.Optional(Nullable(Type.Integer({ minimum: 0 }))),
    position: Type.Optional(Type.Integer()),
    low_availability_threshold: Type.Optional(Nullable(Type.Integer({ minimum: 0, description: 'Tell staff when fewer than this many are free in the coming days; null turns it off.' }))),
    buffer_before_min: Type.Optional(Nullable(Type.Integer({ minimum: 0, description: 'Overrides the product; null uses it.' }))),
    buffer_after_min: Type.Optional(Nullable(Type.Integer({ minimum: 0, description: 'Overrides the product; null uses it.' }))),
    min_duration_min: Type.Optional(Nullable(Type.Integer({ minimum: 1, description: 'Overrides the product; null uses it.' }))),
    max_duration_min: Type.Optional(Nullable(Type.Integer({ minimum: 1, description: 'Overrides the product; null uses it.' }))),
    min_notice_min: Type.Optional(Nullable(Type.Integer({ minimum: 0, description: 'Overrides the product; null uses it.' }))),
    increment_min: Type.Optional(Nullable(Type.Integer({ minimum: 1, description: 'Overrides the product; null uses it.' }))),
  },
  { additionalProperties: false },
);

const ProductFields = {
  type: Type.Union([Type.Literal('rental'), Type.Literal('sale'), Type.Literal('service'), Type.Literal('consumable'), Type.Literal('bundle')]),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  slug: Type.Optional(Type.String({ maxLength: 120 })),
  description: Type.Optional(Type.String()),
  visibility: Type.Optional(Type.Union([Type.Literal('public'), Type.Literal('hidden'), Type.Literal('archived')])),
  tags: Type.Optional(Type.Array(Type.String())),
  category_ids: Type.Optional(Type.Array(Id)),
  tax_profile_id: Type.Optional(Nullable(Id)),
  deposit_amount: Type.Optional(Type.Integer({ minimum: 0 })),
  buffer_before_min: Type.Optional(Type.Integer({ minimum: 0 })),
  buffer_after_min: Type.Optional(Type.Integer({ minimum: 0 })),
  min_duration_min: Type.Optional(Nullable(Type.Integer({ minimum: 1 }))),
  max_duration_min: Type.Optional(Nullable(Type.Integer({ minimum: 1 }))),
  min_notice_min: Type.Optional(Type.Integer({ minimum: 0 })),
  increment_min: Type.Optional(Nullable(Type.Integer({ minimum: 1 }))),
  custom_fields: Type.Optional(Json),
  translations: Type.Optional(Json),
  seo: Type.Optional(Json),
  tracking: Type.Optional(Tracking),
  meter_unit: Type.Optional(Nullable(Type.String({ maxLength: 20, description: 'What the units’ meter counts (hours, km); null for none' }))),
  depreciation_months: Type.Optional(Nullable(Type.Integer({ minimum: 1, maximum: 600 }))),
  residual_bp: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000, description: 'Value left at the end of the life, in basis points of the price' })),
  price: Type.Optional(PriceStructureInput),
  variants: Type.Optional(Type.Array(VariantInput)),
  bundle: Type.Optional(
    Type.Object({
      pricing_mode: Type.Optional(Type.Union([Type.Literal('sum'), Type.Literal('fixed'), Type.Literal('discount_pct')])),
      discount_bp: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
      components: Type.Array(Type.Object({ variant_id: Id, quantity: Type.Integer({ minimum: 1 }), slot_name: Type.Optional(Type.String()) }), { minItems: 1 }),
    }),
  ),
};

export const ProductInput = Type.Object(ProductFields, { additionalProperties: false });
export const ProductPatch = Type.Partial(Type.Object(ProductFields), { additionalProperties: false });

export const LineInput = Type.Object(
  {
    type: Type.Optional(Type.Union([Type.Literal('rental'), Type.Literal('sale'), Type.Literal('service'), Type.Literal('fee'), Type.Literal('discount')])),
    variant_id: Type.Optional(Nullable(Id)),
    product_id: Type.Optional(Nullable(Id)),
    quantity: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
    amount: Type.Optional(Nullable(Type.Integer({ minimum: 0, description: 'Fee lines: the price. Discount lines: the amount taken off.' }))),
    percent_bp: Type.Optional(Nullable(Type.Integer({ minimum: 0, maximum: 10000, description: 'Discount lines: share of the rental, sale and service lines in basis points (instead of amount).' }))),
    description: Type.Optional(Type.String()),
    stock_item_ids: Type.Optional(Type.Array(Id, { maxItems: 100 })),
    buffer_before_min: Type.Optional(Type.Integer({ minimum: 0 })),
    buffer_after_min: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const DepositPolicy = Type.Object({
  mode: Type.Union([Type.Literal('auto'), Type.Literal('none'), Type.Literal('fixed'), Type.Literal('percent')]),
  amount: Type.Optional(Type.Integer({ minimum: 0 })),
  pct_bp: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
});

/** The customer's choices (FR-PR-8): optional fee rules by id, and the delivery postcode. */
export const QuoteOptions = Type.Object(
  { fees: Type.Optional(Type.Array(Id, { maxItems: 20 })), postcode: Type.Optional(Nullable(Type.String({ maxLength: 20 }))), address: Type.Optional(Nullable(Type.String({ maxLength: 300 }))) },
  { additionalProperties: false },
);

export const OrderInput = Type.Object(
  {
    customer_id: Type.Optional(Nullable(Id)),
    location_id: Type.Optional(Nullable(Id)),
    starts_at: DateTime,
    ends_at: DateTime,
    lines: Type.Optional(Type.Array(LineInput, { maxItems: 200 })),
    coupon_codes: Type.Optional(Type.Array(Type.String())),
    deposit: Type.Optional(Nullable(DepositPolicy)),
    notes: Type.Optional(Type.Object({ internal: Type.Optional(Type.String()), customer: Type.Optional(Type.String()) })),
    tags: Type.Optional(Type.Array(Type.String())),
    custom_fields: Type.Optional(Json),
    options: Type.Optional(QuoteOptions),
  },
  { additionalProperties: false },
);

export const QuoteInput = Type.Object(
  {
    location_id: Type.Optional(Nullable(Id)),
    starts_at: DateTime,
    ends_at: DateTime,
    customer_id: Type.Optional(Nullable(Id)),
    lines: Type.Array(LineInput, { minItems: 1, maxItems: 200 }),
    coupon_codes: Type.Optional(Type.Array(Type.String())),
    deposit: Type.Optional(Nullable(DepositPolicy)),
    options: Type.Optional(QuoteOptions),
  },
  { additionalProperties: false },
);

export const Address = Type.Object(
  { line1: Type.Optional(Type.String({ maxLength: 200 })), line2: Type.Optional(Type.String({ maxLength: 200 })), postal_code: Type.Optional(Type.String({ maxLength: 20 })), city: Type.Optional(Type.String({ maxLength: 100 })), region: Type.Optional(Type.String({ maxLength: 100 })), country: Type.Optional(Type.String({ maxLength: 2, description: 'ISO 3166-1 alpha-2' })) },
  { additionalProperties: false },
);

export const CustomerFields = {
  type: Type.Optional(Type.Union([Type.Literal('person'), Type.Literal('company')])),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  email: Type.Optional(Nullable(Type.String({ format: 'email' }))),
  phone: Type.Optional(Nullable(Type.String({ maxLength: 40 }))),
  company_name: Type.Optional(Nullable(Type.String())),
  tax_id: Type.Optional(Nullable(Type.String())),
  addresses: Type.Optional(Type.Object({ billing: Type.Optional(Nullable(Address)), shipping: Type.Optional(Nullable(Address)) }, { additionalProperties: false })),
  locale: Type.Optional(Nullable(Type.String({ pattern: '^[a-z]{2}(-[A-Z]{2})?$' }))),
  tags: Type.Optional(Type.Array(Type.String())),
  flags: Type.Optional(Type.Object({ blocked: Type.Optional(Type.Boolean()), deposit_waived: Type.Optional(Type.Boolean()), requires_id_check: Type.Optional(Type.Boolean()), id_verified: Type.Optional(Type.Boolean()) })),
  marketing_consent: Type.Optional(Type.Boolean()),
  notes: Type.Optional(Type.String()),
  custom_fields: Type.Optional(Json),
};
export const CustomerInput = Type.Object(CustomerFields, { additionalProperties: false });
export const CustomerPatch = Type.Partial(Type.Object(CustomerFields), { additionalProperties: false });

export const UnitsBody = Type.Object(
  { line_id: Type.Optional(Id), stock_item_ids: Type.Optional(Type.Array(Id, { maxItems: 100 })), barcodes: Type.Optional(Type.Array(Type.String(), { maxItems: 100 })) },
  { additionalProperties: false },
);

export const Order = Resource('order', { number: Type.Integer(), status: Type.String(), payment_status: Type.String(), totals: Type.Object({}, { additionalProperties: true }), lines: Type.Array(Resource('order_line')) });
export const Product = Resource('product', { name: Type.String(), slug: Type.String(), type: Type.String(), variants: Type.Array(Resource('variant')) });
export const Customer = Resource('customer', { name: Type.String() });
export const StockItem = Resource('stock_item', { barcode: Type.String(), status: Type.String() });
export const Availability = Type.Object(
  { variant_id: Type.String(), location_id: Type.String(), from: Type.String(), to: Type.String(), tracking: Type.String(), capacity: Nullable(Type.Number()), allocated: Type.Number(), available: Nullable(Type.Number()), shortage: Type.Boolean() },
  { additionalProperties: true },
);
export const PriceQuote = Type.Object({ object: Type.Literal('price_quote'), currency: Type.String(), lines: Type.Array(Type.Object({}, { additionalProperties: true })), subtotal: Money, discount: Money, tax: Money, total: Money, deposit: Money }, { additionalProperties: true });
