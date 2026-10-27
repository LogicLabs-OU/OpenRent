/**
 * Drizzle schema of the OpenRent database. Edit this file, then run `pnpm db:generate` to create a
 * migration and `pnpm db:migrate` to apply it. Tables up to the baseline were introspected from
 * migrations/0001_init.sql; exclusion constraints and triggers live in SQL, not here.
 */
import {
  pgTable,
  uniqueIndex,
  check,
  text,
  timestamp,
  foreignKey,
  unique,
  pgPolicy,
  jsonb,
  char,
  boolean,
  index,
  bigint,
  integer,
  date,
  primaryKey,
  doublePrecision,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { customType } from 'drizzle-orm/pg-core';

/** Range of timestamptz, written and read as Postgres range literals ("[from,to)"). */
const tstzrange = customType<{ data: string }>({ dataType: () => 'tstzrange' });

/** Raw bytes (file contents kept in the database by the built-in storage driver). */
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/** Tenant isolation policy used on every tenant-scoped table (see sql/invariants.sql). */
export const tenantPolicy = () =>
  pgPolicy('tenant_isolation', {
    as: 'permissive',
    for: 'all',
    to: ['public'],
    using: sql`openrent_tenant_ok(tenant_id)`,
    withCheck: sql`openrent_tenant_ok(tenant_id)`,
  });

export const users = pgTable(
  'users',
  {
    id: text().primaryKey().notNull(),
    email: text().notNull(),
    passwordHash: text('password_hash'),
    name: text().default('').notNull(),
    locale: text().default('en').notNull(),
    totpSecret: text('totp_secret'),
    /** The last authenticator step used to sign in: each code works once. */
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    totpPending: text('totp_pending'),
    status: text().default('active').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  () => [
    uniqueIndex('users_email').using('btree', sql`lower(email)`),
    check('users_status_check', sql`status = ANY (ARRAY['active'::text, 'invited'::text, 'disabled'::text])`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text().primaryKey().notNull(),
    userId: text('user_id').notNull(),
    tenantId: text('tenant_id'),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    ip: text(),
    userAgent: text('user_agent'),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'sessions_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'sessions_tenant_id_fkey',
    }),
    unique('sessions_token_hash_key').on(table.tokenHash),
  ],
);

export const loginTokens = pgTable(
  'login_tokens',
  {
    id: text().primaryKey().notNull(),
    userId: text('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'login_tokens_user_id_fkey',
    }).onDelete('cascade'),
    unique('login_tokens_token_hash_key').on(table.tokenHash),
  ],
);

export const tenants = pgTable(
  'tenants',
  {
    id: text().primaryKey().notNull(),
    slug: text().notNull(),
    name: text().notNull(),
    legalName: text('legal_name'),
    address: jsonb().default({}).notNull(),
    taxIds: jsonb('tax_ids').default([]).notNull(),
    currency: char({ length: 3 }).notNull(),
    timezone: text().notNull(),
    locale: text().default('en').notNull(),
    settings: jsonb().default({}).notNull(),
    branding: jsonb().default({}).notNull(),
    invoiceNumbering: jsonb('invoice_numbering').default({}).notNull(),
    /** Managed cloud: `suspended` shops answer neither admin nor storefront; their data stays. */
    status: text().default('active').notNull(),
    suspendedReason: text('suspended_reason'),
    suspendedAt: timestamp('suspended_at', { withTimezone: true, mode: 'string' }),
    /** Per-shop limits the operator sets (orders a month, storage, plugins); empty is unlimited. */
    limits: jsonb().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    unique('tenants_slug_key').on(table.slug),
    check('tenants_status_check', sql`${table.status} IN ('active', 'suspended')`),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(id)`,
      withCheck: sql`openrent_tenant_ok(id)`,
    }),
  ],
);

export const locations = pgTable(
  'locations',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    name: text().notNull(),
    address: jsonb().default({}).notNull(),
    timezone: text().notNull(),
    openingHours: jsonb('opening_hours').default({}).notNull(),
    // Times customers may choose for a delivery or collection, per weekday like opening_hours.
    deliveryWindows: jsonb('delivery_windows').default({}).notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    phone: text(),
    email: text(),
    // Shown on documents in place of the shop's tax ids, for a branch registered on its own.
    taxIds: jsonb('tax_ids').default([]).notNull(),
    // Replaces the shop's default tax profile for orders here; products with their own profile keep it.
    taxProfileId: text('tax_profile_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    foreignKey({
      columns: [table.taxProfileId],
      foreignColumns: [taxProfiles.id],
      name: 'locations_tax_profile_id_fkey',
    }),
    uniqueIndex('locations_one_default')
      .using('btree', table.tenantId.asc().nullsLast().op('text_ops'))
      .where(sql`(is_default AND (deleted_at IS NULL))`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'locations_tenant_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
  ],
);

export const locationBlackouts = pgTable(
  'location_blackouts',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    locationId: text('location_id').notNull(),
    period: tstzrange('period').notNull(),
    reason: text(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('location_blackouts_period').using(
      'gist',
      table.tenantId.asc().nullsLast().op('gist_text_ops'),
      table.locationId.asc().nullsLast().op('range_ops'),
      table.period.asc().nullsLast().op('gist_text_ops'),
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'location_blackouts_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.locationId],
      foreignColumns: [locations.id],
      name: 'location_blackouts_location_id_fkey',
    }).onDelete('cascade'),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
  ],
);

export const memberships = pgTable(
  'memberships',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    role: text().notNull(),
    /** With role 'custom': the shop's own role whose permissions apply (FR-USR-3). */
    roleId: text('role_id'),
    /** Set while the member may not use this shop (the user keeps other shops). */
    disabledAt: timestamp('disabled_at', { withTimezone: true, mode: 'string' }),
    /** Per kind of staff notice: { in_app: bool, email: bool } (FR-NOT-3). */
    notificationPrefs: jsonb('notification_prefs').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'memberships_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'memberships_user_id_fkey',
    }).onDelete('cascade'),
    unique('memberships_user_id_tenant_id_key').on(table.tenantId, table.userId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check(
      'memberships_role_check',
      sql`role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text, 'warehouse'::text, 'read_only'::text, 'custom'::text])`,
    ),
    check('memberships_custom_role_check', sql`(role = 'custom') = (role_id IS NOT NULL)`),
    foreignKey({ columns: [table.roleId], foreignColumns: [roles.id], name: 'memberships_role_id_fkey' }),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    name: text().notNull(),
    kind: text().notNull(),
    keyHash: text('key_hash').notNull(),
    prefix: text().notNull(),
    scopes: text().array().default(['']).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'string' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'api_keys_tenant_id_fkey',
    }),
    unique('api_keys_key_hash_key').on(table.keyHash),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check('api_keys_kind_check', sql`kind = ANY (ARRAY['secret'::text, 'publishable'::text])`),
  ],
);

export const taxProfiles = pgTable(
  'tax_profiles',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    name: text().notNull(),
    rates: jsonb().default([]).notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'tax_profiles_tenant_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
  ],
);

export const priceStructures = pgTable(
  'price_structures',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    name: text().notNull(),
    kind: text().notNull(),
    periodUnit: text('period_unit').default('day').notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    amount: bigint({ mode: 'number' }).default(0).notNull(),
    rounding: text().default('up').notNull(),
    chargeDayRules: jsonb('charge_day_rules').default({}).notNull(),
    tiers: jsonb().default([]).notNull(),
    cap: jsonb(),
    priceTable: jsonb('price_table').default([]).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    extraPerPeriod: bigint('extra_per_period', { mode: 'number' }).default(0).notNull(),
    currency: char({ length: 3 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'price_structures_tenant_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check(
      'price_structures_kind_check',
      sql`kind = ANY (ARRAY['fixed'::text, 'per_period'::text, 'tiered'::text, 'table'::text])`,
    ),
    check(
      'price_structures_period_unit_check',
      sql`period_unit = ANY (ARRAY['hour'::text, 'day'::text, 'week'::text, 'month'::text])`,
    ),
    check('price_structures_amount_check', sql`amount >= 0`),
    check(
      'price_structures_rounding_check',
      sql`rounding = ANY (ARRAY['up'::text, 'nearest'::text, 'down'::text])`,
    ),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    name: text().notNull(),
    slug: text().notNull(),
    parentId: text('parent_id'),
    position: integer().default(0).notNull(),
    translations: jsonb().default({}).notNull(),
    // Search engine title and description ({title, description}); other languages in `translations`.
    seo: jsonb().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    uniqueIndex('categories_slug')
      .using(
        'btree',
        table.tenantId.asc().nullsLast().op('text_ops'),
        table.slug.asc().nullsLast().op('text_ops'),
      )
      .where(sql`(deleted_at IS NULL)`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'categories_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: 'categories_parent_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
  ],
);

// The shop's own storefront pages (about, contact, FAQ): a text in every language and, per theme,
// sections like the home page's. Drafts are seen only in a theme preview.
export const storefrontPages = pgTable(
  'storefront_pages',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    slug: text().notNull(),
    status: text().default('draft').notNull(),
    title: text().notNull(),
    body: text().default('').notNull(),
    seo: jsonb().default({}).notNull(),
    translations: jsonb().default({}).notNull(),
    // theme id → sections; theme id → locale → section texts (as the home page's translations).
    sections: jsonb().default({}).notNull(),
    contentTranslations: jsonb('content_translations').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    uniqueIndex('storefront_pages_slug')
      .using(
        'btree',
        table.tenantId.asc().nullsLast().op('text_ops'),
        table.slug.asc().nullsLast().op('text_ops'),
      )
      .where(sql`(deleted_at IS NULL)`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'storefront_pages_tenant_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check('storefront_pages_status_check', sql`status = ANY (ARRAY['draft'::text, 'published'::text])`),
  ],
);

export const products = pgTable(
  'products',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    type: text().notNull(),
    name: text().notNull(),
    slug: text().notNull(),
    description: text().default('').notNull(),
    translations: jsonb().default({}).notNull(),
    visibility: text().default('public').notNull(),
    seo: jsonb().default({}).notNull(),
    tags: text().array().default(['']).notNull(),
    taxProfileId: text('tax_profile_id'),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    depositAmount: bigint('deposit_amount', { mode: 'number' }).default(0).notNull(),
    bufferBeforeMin: integer('buffer_before_min').default(0).notNull(),
    bufferAfterMin: integer('buffer_after_min').default(0).notNull(),
    minDurationMin: integer('min_duration_min'),
    maxDurationMin: integer('max_duration_min'),
    minNoticeMin: integer('min_notice_min').default(0).notNull(),
    incrementMin: integer('increment_min'),
    customFields: jsonb('custom_fields').default({}).notNull(),
    /** What the units' meter counts (hours, km, …); null when they have none (FR-CAT-10). */
    meterUnit: text('meter_unit'),
    /** Straight-line depreciation of each unit over this many months, down to the residual share. */
    depreciationMonths: integer('depreciation_months'),
    residualBp: integer('residual_bp').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    index('products_name_trgm').using('gin', table.name.asc().nullsLast().op('gin_trgm_ops')),
    uniqueIndex('products_slug')
      .using(
        'btree',
        table.tenantId.asc().nullsLast().op('text_ops'),
        table.slug.asc().nullsLast().op('text_ops'),
      )
      .where(sql`(deleted_at IS NULL)`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'products_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.taxProfileId],
      foreignColumns: [taxProfiles.id],
      name: 'products_tax_profile_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check(
      'products_type_check',
      sql`type = ANY (ARRAY['rental'::text, 'sale'::text, 'service'::text, 'consumable'::text, 'bundle'::text])`,
    ),
    check(
      'products_visibility_check',
      sql`visibility = ANY (ARRAY['public'::text, 'hidden'::text, 'archived'::text])`,
    ),
    check('products_deposit_amount_check', sql`deposit_amount >= 0`),
    check('products_buffer_before_min_check', sql`buffer_before_min >= 0`),
    check('products_buffer_after_min_check', sql`buffer_after_min >= 0`),
  ],
);

export const variants = pgTable(
  'variants',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    productId: text('product_id').notNull(),
    sku: text(),
    name: text().notNull(),
    options: jsonb().default({}).notNull(),
    /** Variant name per storefront language: { de: { name } }. */
    translations: jsonb().default({}).notNull(),
    tracking: text().notNull(),
    priceStructureId: text('price_structure_id'),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    depositAmount: bigint('deposit_amount', { mode: 'number' }),
    isDefault: boolean('is_default').default(false).notNull(),
    position: integer().default(0).notNull(),
    /** Staff are told when fewer than this many are free in the coming days (FR-NOT-3). */
    lowAvailabilityThreshold: integer('low_availability_threshold'),
    /** Booking rules for this variant; NULL means the product's rule applies (FR-AV-3/4). */
    bufferBeforeMin: integer('buffer_before_min'),
    bufferAfterMin: integer('buffer_after_min'),
    minDurationMin: integer('min_duration_min'),
    maxDurationMin: integer('max_duration_min'),
    minNoticeMin: integer('min_notice_min'),
    incrementMin: integer('increment_min'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    index('variants_product').using(
      'btree',
      table.tenantId.asc().nullsLast().op('text_ops'),
      table.productId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('variants_sku')
      .using(
        'btree',
        table.tenantId.asc().nullsLast().op('text_ops'),
        table.sku.asc().nullsLast().op('text_ops'),
      )
      .where(sql`((sku IS NOT NULL) AND (deleted_at IS NULL))`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'variants_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.productId],
      foreignColumns: [products.id],
      name: 'variants_product_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.priceStructureId],
      foreignColumns: [priceStructures.id],
      name: 'variants_price_structure_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check(
      'variants_tracking_check',
      sql`tracking = ANY (ARRAY['serialized'::text, 'bulk'::text, 'none'::text])`,
    ),
    check('variants_deposit_amount_check', sql`deposit_amount >= 0`),
    check('variants_buffer_before_min_check', sql`buffer_before_min >= 0`),
    check('variants_low_availability_threshold_check', sql`low_availability_threshold >= 0`),
    check('variants_buffer_after_min_check', sql`buffer_after_min >= 0`),
    check('variants_min_duration_min_check', sql`min_duration_min > 0`),
    check('variants_max_duration_min_check', sql`max_duration_min > 0 AND max_duration_min >= coalesce(min_duration_min, 0)`),
    check('variants_min_notice_min_check', sql`min_notice_min >= 0`),
    check('variants_increment_min_check', sql`increment_min > 0`),
  ],
);

export const stockItems = pgTable(
  'stock_items',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    variantId: text('variant_id').notNull(),
    locationId: text('location_id').notNull(),
    barcode: text().notNull(),
    serial: text(),
    status: text().default('available').notNull(),
    condition: text().default('good').notNull(),
    purchaseDate: date('purchase_date'),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    purchasePrice: bigint('purchase_price', { mode: 'number' }),
    notes: text().default('').notNull(),
    /** Shelf or bin inside the location, used to group pick lists (FR-OR-4). */
    bin: text(),
    customFields: jsonb('custom_fields').default({}).notNull(),
    /** The latest meter reading. */
    meterValue: doublePrecision('meter_value'),
    retiredAt: timestamp('retired_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('stock_items_barcode').using(
      'btree',
      table.tenantId.asc().nullsLast().op('text_ops'),
      table.barcode.asc().nullsLast().op('text_ops'),
    ),
    index('stock_items_variant').using(
      'btree',
      table.tenantId.asc().nullsLast().op('text_ops'),
      table.variantId.asc().nullsLast().op('text_ops'),
      table.locationId.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'stock_items_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.variantId],
      foreignColumns: [variants.id],
      name: 'stock_items_variant_id_fkey',
    }),
    foreignKey({
      columns: [table.locationId],
      foreignColumns: [locations.id],
      name: 'stock_items_location_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check(
      'stock_items_status_check',
      sql`status = ANY (ARRAY['available'::text, 'reserved'::text, 'out'::text, 'needs_inspection'::text, 'soft_down'::text, 'hard_down'::text, 'retired'::text, 'lost'::text, 'in_transit'::text])`,
    ),
  ],
);

export const stockAdjustments = pgTable(
  'stock_adjustments',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    variantId: text('variant_id').notNull(),
    locationId: text('location_id').notNull(),
    delta: integer().notNull(),
    reason: text().notNull(),
    reference: text(),
    actorId: text('actor_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'stock_adjustments_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.variantId],
      foreignColumns: [variants.id],
      name: 'stock_adjustments_variant_id_fkey',
    }),
    foreignKey({
      columns: [table.locationId],
      foreignColumns: [locations.id],
      name: 'stock_adjustments_location_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
  ],
);

export const bundles = pgTable(
  'bundles',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    productId: text('product_id').notNull(),
    pricingMode: text('pricing_mode').default('sum').notNull(),
    discountBp: integer('discount_bp').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'bundles_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.productId],
      foreignColumns: [products.id],
      name: 'bundles_product_id_fkey',
    }).onDelete('cascade'),
    unique('bundles_product_id_key').on(table.productId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check(
      'bundles_pricing_mode_check',
      sql`pricing_mode = ANY (ARRAY['sum'::text, 'fixed'::text, 'discount_pct'::text])`,
    ),
    check('bundles_discount_bp_check', sql`(discount_bp >= 0) AND (discount_bp <= 10000)`),
  ],
);

export const bundleComponents = pgTable(
  'bundle_components',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    bundleId: text('bundle_id').notNull(),
    slotName: text('slot_name'),
    variantId: text('variant_id').notNull(),
    quantity: integer().notNull(),
    position: integer().default(0).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'bundle_components_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.bundleId],
      foreignColumns: [bundles.id],
      name: 'bundle_components_bundle_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.variantId],
      foreignColumns: [variants.id],
      name: 'bundle_components_variant_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check('bundle_components_quantity_check', sql`quantity > 0`),
  ],
);

export const customers = pgTable(
  'customers',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    type: text().default('person').notNull(),
    name: text().notNull(),
    email: text(),
    phone: text(),
    companyName: text('company_name'),
    taxId: text('tax_id'),
    addresses: jsonb().default({}).notNull(),
    locale: text(),
    tags: text().array().default(['']).notNull(),
    flags: jsonb().default({}).notNull(),
    marketingConsent: boolean('marketing_consent').default(false).notNull(),
    /** Booking updates by text message or WhatsApp, which the customer asked for (FR-NOT-4). */
    smsOptIn: boolean('sms_opt_in').default(false).notNull(),
    whatsappOptIn: boolean('whatsapp_opt_in').default(false).notNull(),
    /** The tax plugin's last check of `tax_id` (VIES for EU VAT numbers), or null. */
    taxIdCheck: jsonb('tax_id_check'),
    notes: text().default('').notNull(),
    customFields: jsonb('custom_fields').default({}).notNull(),
    providerRefs: jsonb('provider_refs').default({}).notNull(),
    /** B2B (FR-CUS-7): books on account and pays invoices within `payment_terms_days`. */
    onAccount: boolean('on_account').default(false).notNull(),
    paymentTermsDays: integer('payment_terms_days'),
    /** Most the customer may owe at once (minor units); null means no limit. */
    creditLimit: bigint('credit_limit', { mode: 'number' }),
    poRequired: boolean('po_required').default(false).notNull(),
    /** per_order: each booking is invoiced; monthly: finished bookings go on one invoice a month. */
    invoiceSchedule: text('invoice_schedule').default('per_order').notNull(),
    mergedIntoId: text('merged_into_id'),
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    index('customers_email').using('btree', sql`tenant_id`, sql`lower(email)`),
    index('customers_name_trgm').using('gin', table.name.asc().nullsLast().op('gin_trgm_ops')),
    index('customers_phone').using(
      'btree',
      table.tenantId.asc().nullsLast().op('text_ops'),
      table.phone.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'customers_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.mergedIntoId],
      foreignColumns: [table.id],
      name: 'customers_merged_into_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check('customers_type_check', sql`type = ANY (ARRAY['person'::text, 'company'::text])`),
  ],
);

export const coupons = pgTable(
  'coupons',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    code: text().notNull(),
    kind: text().notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    value: bigint({ mode: 'number' }).notNull(),
    scope: jsonb().default({ type: 'order' }).notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true, mode: 'string' }),
    validUntil: timestamp('valid_until', { withTimezone: true, mode: 'string' }),
    maxUses: integer('max_uses'),
    maxUsesPerCustomer: integer('max_uses_per_customer'),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    minOrder: bigint('min_order', { mode: 'number' }).default(0).notNull(),
    combinable: boolean().default(false).notNull(),
    usesCount: integer('uses_count').default(0).notNull(),
    active: boolean().default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('coupons_code').using('btree', sql`tenant_id`, sql`lower(code)`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'coupons_tenant_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check('coupons_kind_check', sql`kind = ANY (ARRAY['percent'::text, 'fixed'::text])`),
    check('coupons_value_check', sql`value >= 0`),
  ],
);

export const orderSequences = pgTable(
  'order_sequences',
  {
    tenantId: text('tenant_id').primaryKey().notNull(),
    nextValue: integer('next_value').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'order_sequences_tenant_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    number: integer().notNull(),
    status: text().default('draft').notNull(),
    customerId: text('customer_id'),
    locationId: text('location_id').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'string' }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'string' }).notNull(),
    timezone: text().notNull(),
    currency: char({ length: 3 }).notNull(),
    totals: jsonb().default({}).notNull(),
    paymentStatus: text('payment_status').default('unpaid').notNull(),
    depositPolicy: jsonb('deposit_policy').default({ mode: 'auto' }).notNull(),
    /** The customer's choices: optional fees by rule id and the delivery postcode (FR-PR-8). */
    options: jsonb().default({}).notNull(),
    couponCodes: text('coupon_codes').array().default(['']).notNull(),
    termsAcceptance: jsonb('terms_acceptance'),
    source: text().default('admin').notNull(),
    publicToken: text('public_token').notNull(),
    quoteExpiresAt: timestamp('quote_expires_at', { withTimezone: true, mode: 'string' }),
    notes: jsonb().default({}).notNull(),
    tags: text().array().default(['']).notNull(),
    customFields: jsonb('custom_fields').default({}).notNull(),
    /** The booking's id in the system it was imported from (FR-MIG-2), so it is not imported twice. */
    externalRef: text('external_ref'),
    /** The customer's purchase order number (FR-CUS-7). */
    poNumber: text('po_number'),
    // The billing details chosen at checkout (ADR 0012); null uses the customer's.
    billing: jsonb(),
    /** The monthly invoice this booking is on, for customers invoiced monthly. */
    invoiceId: text('invoice_id'),
    /** Long rentals billed per period while out (FR-OR-11): weekly or monthly; null bills once. */
    billingCycle: text('billing_cycle'),
    /** The end of the last period invoiced. */
    billedUntil: timestamp('billed_until', { withTimezone: true, mode: 'string' }),
    version: integer().default(1).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'string' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'string' }),
    cancelReason: text('cancel_reason'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('orders_customer').using(
      'btree',
      table.tenantId.asc().nullsLast().op('text_ops'),
      table.customerId.asc().nullsLast().op('text_ops'),
    ),
    index('orders_period').using(
      'btree',
      table.tenantId.asc().nullsLast().op('timestamptz_ops'),
      table.startsAt.asc().nullsLast().op('timestamptz_ops'),
      table.endsAt.asc().nullsLast().op('text_ops'),
    ),
    index('orders_status').using(
      'btree',
      table.tenantId.asc().nullsLast().op('text_ops'),
      table.status.asc().nullsLast().op('timestamptz_ops'),
      table.startsAt.asc().nullsLast().op('timestamptz_ops'),
    ),
    uniqueIndex('orders_external_ref').on(table.tenantId, table.externalRef).where(sql`external_ref IS NOT NULL`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'orders_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.id],
      name: 'orders_customer_id_fkey',
    }),
    foreignKey({
      columns: [table.locationId],
      foreignColumns: [locations.id],
      name: 'orders_location_id_fkey',
    }),
    unique('orders_public_token_key').on(table.publicToken),
    unique('orders_tenant_id_number_key').on(table.number, table.tenantId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check(
      'orders_status_check',
      sql`status = ANY (ARRAY['draft'::text, 'quote'::text, 'reserved'::text, 'prepared'::text, 'out'::text, 'returned_partial'::text, 'returned'::text, 'inspected'::text, 'closed'::text, 'cancelled'::text, 'expired'::text])`,
    ),
    check(
      'orders_payment_status_check',
      sql`payment_status = ANY (ARRAY['unpaid'::text, 'partially_paid'::text, 'paid'::text, 'refunded'::text, 'overdue'::text])`,
    ),
    check('orders_source_check', sql`source = ANY (ARRAY['storefront'::text, 'admin'::text, 'api'::text, 'import'::text])`),
    check('orders_check', sql`ends_at > starts_at`),
  ],
);

export const orderLines = pgTable(
  'order_lines',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    orderId: text('order_id').notNull(),
    type: text().notNull(),
    productId: text('product_id'),
    variantId: text('variant_id'),
    bundleId: text('bundle_id'),
    parentLineId: text('parent_line_id'),
    quantity: integer().default(1).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'string' }),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'string' }),
    bufferBeforeMin: integer('buffer_before_min').default(0).notNull(),
    bufferAfterMin: integer('buffer_after_min').default(0).notNull(),
    description: text().default('').notNull(),
    priceSnapshot: jsonb('price_snapshot').default({}).notNull(),
    /** Plugin data for the line (FR-PLG-5), keyed by plugin id; never priced. */
    metadata: jsonb().default({}).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    unitPrice: bigint('unit_price', { mode: 'number' }).default(0).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    subtotal: bigint({ mode: 'number' }).default(0).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    discount: bigint({ mode: 'number' }).default(0).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    tax: bigint({ mode: 'number' }).default(0).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    total: bigint({ mode: 'number' }).default(0).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    deposit: bigint({ mode: 'number' }).default(0).notNull(),
    pickedUpQty: integer('picked_up_qty').default(0).notNull(),
    returnedQty: integer('returned_qty').default(0).notNull(),
    lostQty: integer('lost_qty').default(0).notNull(),
    position: integer().default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('order_lines_order').using(
      'btree',
      table.tenantId.asc().nullsLast().op('text_ops'),
      table.orderId.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'order_lines_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [orders.id],
      name: 'order_lines_order_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.productId],
      foreignColumns: [products.id],
      name: 'order_lines_product_id_fkey',
    }),
    foreignKey({
      columns: [table.variantId],
      foreignColumns: [variants.id],
      name: 'order_lines_variant_id_fkey',
    }),
    foreignKey({
      columns: [table.bundleId],
      foreignColumns: [bundles.id],
      name: 'order_lines_bundle_id_fkey',
    }),
    foreignKey({
      columns: [table.parentLineId],
      foreignColumns: [table.id],
      name: 'order_lines_parent_line_id_fkey',
    }).onDelete('cascade'),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check(
      'order_lines_type_check',
      sql`type = ANY (ARRAY['rental'::text, 'sale'::text, 'service'::text, 'fee'::text, 'discount'::text])`,
    ),
    check('order_lines_quantity_check', sql`quantity > 0`),
  ],
);

export const orderEvents = pgTable(
  'order_events',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    orderId: text('order_id').notNull(),
    type: text().notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    payload: jsonb().default({}).notNull(),
    actor: jsonb().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('order_events_order').using(
      'btree',
      table.tenantId.asc().nullsLast().op('timestamptz_ops'),
      table.orderId.asc().nullsLast().op('text_ops'),
      table.createdAt.asc().nullsLast().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'order_events_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [orders.id],
      name: 'order_events_order_id_fkey',
    }).onDelete('cascade'),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
  ],
);

export const downtimes = pgTable(
  'downtimes',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    locationId: text('location_id').notNull(),
    variantId: text('variant_id').notNull(),
    stockItemId: text('stock_item_id'),
    quantity: integer().default(1).notNull(),
    period: tstzrange('period').notNull(),
    reason: text().default('').notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'downtimes_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.locationId],
      foreignColumns: [locations.id],
      name: 'downtimes_location_id_fkey',
    }),
    foreignKey({
      columns: [table.variantId],
      foreignColumns: [variants.id],
      name: 'downtimes_variant_id_fkey',
    }),
    foreignKey({
      columns: [table.stockItemId],
      foreignColumns: [stockItems.id],
      name: 'downtimes_stock_item_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check('downtimes_quantity_check', sql`quantity > 0`),
  ],
);

export const allocations = pgTable(
  'allocations',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    variantId: text('variant_id').notNull(),
    locationId: text('location_id').notNull(),
    stockItemId: text('stock_item_id'),
    quantity: integer().notNull(),
    period: tstzrange('period').notNull(),
    kind: text().notNull(),
    orderId: text('order_id'),
    orderLineId: text('order_line_id'),
    downtimeId: text('downtime_id'),
    /** Set on the part of a booking staff placed over capacity on purpose (FR-AV-8). */
    overbookingId: text('overbooking_id'),
    /** Stock held for a transfer at the source, or on its way to the destination (FR-LOC-2). */
    transferLineId: text('transfer_line_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('allocations_lookup').using(
      'gist',
      table.tenantId.asc().nullsLast().op('gist_text_ops'),
      table.variantId.asc().nullsLast().op('gist_text_ops'),
      table.locationId.asc().nullsLast().op('gist_text_ops'),
      table.period.asc().nullsLast().op('range_ops'),
    ),
    index('allocations_order_line').using('btree', table.orderLineId.asc().nullsLast().op('text_ops')),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'allocations_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.variantId],
      foreignColumns: [variants.id],
      name: 'allocations_variant_id_fkey',
    }),
    foreignKey({
      columns: [table.locationId],
      foreignColumns: [locations.id],
      name: 'allocations_location_id_fkey',
    }),
    foreignKey({
      columns: [table.stockItemId],
      foreignColumns: [stockItems.id],
      name: 'allocations_stock_item_id_fkey',
    }),
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [orders.id],
      name: 'allocations_order_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.orderLineId],
      foreignColumns: [orderLines.id],
      name: 'allocations_order_line_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.downtimeId],
      foreignColumns: [downtimes.id],
      name: 'allocations_downtime_id_fkey',
    }).onDelete('cascade'),
    foreignKey({ columns: [table.transferLineId], foreignColumns: [transferLines.id], name: 'allocations_transfer_line_id_fkey' }).onDelete('cascade'),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check('allocations_quantity_check', sql`quantity > 0`),
    check('allocations_period_check', sql`NOT isempty(period)`),
    check(
      'allocations_kind_check',
      sql`kind = ANY (ARRAY['reservation'::text, 'downtime'::text, 'buffer'::text, 'transfer'::text])`,
    ),
    check('allocations_check', sql`(stock_item_id IS NULL) OR (quantity = 1)`),
  ],
);

export const orderLineUnits = pgTable(
  'order_line_units',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    orderLineId: text('order_line_id').notNull(),
    stockItemId: text('stock_item_id').notNull(),
    allocationId: text('allocation_id'),
    checkedOutAt: timestamp('checked_out_at', { withTimezone: true, mode: 'string' }),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true, mode: 'string' }),
    checkInOutcome: text('check_in_outcome'),
    /** A unit swapped out mid-rental (FR-OR-10) points to the unit row that replaced it. */
    replacedById: text('replaced_by_id'),
    swappedAt: timestamp('swapped_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'order_line_units_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.orderLineId],
      foreignColumns: [orderLines.id],
      name: 'order_line_units_order_line_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.stockItemId],
      foreignColumns: [stockItems.id],
      name: 'order_line_units_stock_item_id_fkey',
    }),
    foreignKey({
      columns: [table.allocationId],
      foreignColumns: [allocations.id],
      name: 'order_line_units_allocation_id_fkey',
    }).onDelete('set null'),
    unique('order_line_units_order_line_id_stock_item_id_key').on(table.orderLineId, table.stockItemId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check(
      'order_line_units_check_in_outcome_check',
      sql`check_in_outcome = ANY (ARRAY['ok'::text, 'needs_inspection'::text, 'damaged'::text, 'lost'::text, 'swapped'::text])`,
    ),
  ],
);

export const documentTemplates = pgTable(
  'document_templates',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    type: text().notNull(),
    name: text().notNull(),
    locale: text().default('en').notNull(),
    body: text().notNull(),
    css: text().default('').notNull(),
    version: integer().default(1).notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'document_templates_tenant_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    orderId: text('order_id'),
    customerId: text('customer_id'),
    type: text().notNull(),
    number: text(),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'string' }),
    status: text().default('issued').notNull(),
    html: text().notNull(),
    data: jsonb().default({}).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    total: bigint({ mode: 'number' }),
    currency: char({ length: 3 }),
    templateId: text('template_id'),
    templateVersion: integer('template_version'),
    voidedById: text('voided_by_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('documents_number')
      .using(
        'btree',
        table.tenantId.asc().nullsLast().op('text_ops'),
        table.type.asc().nullsLast().op('text_ops'),
        table.number.asc().nullsLast().op('text_ops'),
      )
      .where(sql`(number IS NOT NULL)`),
    index('documents_order').using(
      'btree',
      table.tenantId.asc().nullsLast().op('text_ops'),
      table.orderId.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'documents_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [orders.id],
      name: 'documents_order_id_fkey',
    }),
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.id],
      name: 'documents_customer_id_fkey',
    }),
    foreignKey({
      columns: [table.voidedById],
      foreignColumns: [table.id],
      name: 'documents_voided_by_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check(
      'documents_type_check',
      sql`type = ANY (ARRAY['quote'::text, 'confirmation'::text, 'contract'::text, 'pick_list'::text, 'delivery_note'::text, 'invoice'::text, 'credit_note'::text, 'receipt'::text, 'deposit_receipt'::text])`,
    ),
    check(
      'documents_status_check',
      sql`status = ANY (ARRAY['draft'::text, 'issued'::text, 'sent'::text, 'voided'::text])`,
    ),
  ],
);

export const paymentProviders = pgTable(
  'payment_providers',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    pluginId: text('plugin_id').notNull(),
    configEncrypted: text('config_encrypted'),
    mode: text().default('test').notNull(),
    enabled: boolean().default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'payment_providers_tenant_id_fkey',
    }),
    unique('payment_providers_tenant_id_plugin_id_key').on(table.pluginId, table.tenantId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check('payment_providers_mode_check', sql`mode = ANY (ARRAY['test'::text, 'live'::text])`),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    orderId: text('order_id').notNull(),
    provider: text().notNull(),
    kind: text().notNull(),
    purpose: text().default('rental').notNull(),
    method: text().default('card').notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    amount: bigint({ mode: 'number' }).notNull(),
    currency: char({ length: 3 }).notNull(),
    status: text().notNull(),
    providerRef: text('provider_ref'),
    idempotencyKey: text('idempotency_key'),
    parentPaymentId: text('parent_payment_id'),
    note: text(),
    metadata: jsonb().default({}).notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('payments_order').using(
      'btree',
      table.tenantId.asc().nullsLast().op('text_ops'),
      table.orderId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('payments_provider_ref')
      .using(
        'btree',
        table.provider.asc().nullsLast().op('text_ops'),
        table.providerRef.asc().nullsLast().op('text_ops'),
      )
      .where(sql`((provider_ref IS NOT NULL) AND (kind <> 'refund'::text))`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'payments_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [orders.id],
      name: 'payments_order_id_fkey',
    }),
    foreignKey({
      columns: [table.parentPaymentId],
      foreignColumns: [table.id],
      name: 'payments_parent_payment_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check(
      'payments_kind_check',
      sql`kind = ANY (ARRAY['charge'::text, 'authorization'::text, 'refund'::text, 'manual'::text])`,
    ),
    check(
      'payments_purpose_check',
      sql`purpose = ANY (ARRAY['rental'::text, 'deposit'::text, 'damage'::text, 'late_fee'::text])`,
    ),
    check('payments_amount_check', sql`amount >= 0`),
    check(
      'payments_status_check',
      sql`status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text])`,
    ),
  ],
);

export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    orderId: text('order_id').notNull(),
    provider: text().notNull(),
    purpose: text().default('rental').notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    amount: bigint({ mode: 'number' }).notNull(),
    currency: char({ length: 3 }).notNull(),
    status: text().default('requires_payment').notNull(),
    providerRef: text('provider_ref'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('payment_intents_ref')
      .using(
        'btree',
        table.provider.asc().nullsLast().op('text_ops'),
        table.providerRef.asc().nullsLast().op('text_ops'),
      )
      .where(sql`(provider_ref IS NOT NULL)`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'payment_intents_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [orders.id],
      name: 'payment_intents_order_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
  ],
);

export const providerEvents = pgTable(
  'provider_events',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    provider: text().notNull(),
    eventId: text('event_id').notNull(),
    type: text().notNull(),
    payload: jsonb().default({}).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'string' }),
    error: text(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'provider_events_tenant_id_fkey',
    }),
    unique('provider_events_provider_event_id_key').on(table.eventId, table.provider),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
  ],
);

export const deposits = pgTable(
  'deposits',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    orderId: text('order_id').notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    amount: bigint({ mode: 'number' }).notNull(),
    currency: char({ length: 3 }).notNull(),
    method: text().notNull(),
    status: text().default('pending').notNull(),
    provider: text(),
    providerRef: text('provider_ref'),
    paymentId: text('payment_id'),
    authorizedAt: timestamp('authorized_at', { withTimezone: true, mode: 'string' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    capturedAmount: bigint('captured_amount', { mode: 'number' }).default(0).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true, mode: 'string' }),
    expiringNotifiedAt: timestamp('expiring_notified_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('deposits_order').using(
      'btree',
      table.tenantId.asc().nullsLast().op('text_ops'),
      table.orderId.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'deposits_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [orders.id],
      name: 'deposits_order_id_fkey',
    }),
    foreignKey({
      columns: [table.paymentId],
      foreignColumns: [payments.id],
      name: 'deposits_payment_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check('deposits_amount_check', sql`amount >= 0`),
    check(
      'deposits_method_check',
      sql`method = ANY (ARRAY['card_auth'::text, 'charge'::text, 'cash'::text, 'waived'::text])`,
    ),
    check(
      'deposits_status_check',
      sql`status = ANY (ARRAY['pending'::text, 'held'::text, 'partially_captured'::text, 'captured'::text, 'released'::text, 'expired'::text, 'failed'::text])`,
    ),
    check('deposits_check', sql`captured_amount <= amount`),
  ],
);

export const damageCharges = pgTable(
  'damage_charges',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    orderId: text('order_id').notNull(),
    stockItemId: text('stock_item_id'),
    description: text().notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    amount: bigint({ mode: 'number' }).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    tax: bigint({ mode: 'number' }).default(0).notNull(),
    /** Part the damage waiver pays (FR-PAY-8); the customer owes `amount − covered_amount`. */
    coveredAmount: bigint('covered_amount', { mode: 'number' }).default(0).notNull(),
    status: text().default('open').notNull(),
    depositId: text('deposit_id'),
    documentId: text('document_id'),
    notes: text().default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'damage_charges_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [orders.id],
      name: 'damage_charges_order_id_fkey',
    }),
    foreignKey({
      columns: [table.stockItemId],
      foreignColumns: [stockItems.id],
      name: 'damage_charges_stock_item_id_fkey',
    }),
    foreignKey({
      columns: [table.depositId],
      foreignColumns: [deposits.id],
      name: 'damage_charges_deposit_id_fkey',
    }),
    foreignKey({
      columns: [table.documentId],
      foreignColumns: [documents.id],
      name: 'damage_charges_document_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check('damage_charges_amount_check', sql`amount >= 0`),
    check(
      'damage_charges_status_check',
      sql`status = ANY (ARRAY['open'::text, 'captured'::text, 'invoiced'::text, 'waived'::text, 'paid'::text])`,
    ),
  ],
);

export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    event: text().notNull(),
    channel: text().default('email').notNull(),
    locale: text().default('en').notNull(),
    subject: text().notNull(),
    body: text().notNull(),
    enabled: boolean().default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'notification_templates_tenant_id_fkey',
    }),
    unique('notification_templates_tenant_id_event_channel_locale_key').on(
      table.channel,
      table.event,
      table.locale,
      table.tenantId,
    ),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    channel: text().default('email').notNull(),
    templateKey: text('template_key').notNull(),
    recipient: text().notNull(),
    audience: text().default('customer').notNull(),
    subject: text().notNull(),
    bodyHtml: text('body_html').notNull(),
    /** The message of a text (SMS or WhatsApp); email keeps it in `body_html`. */
    bodyText: text('body_text'),
    orderId: text('order_id'),
    dedupeKey: text('dedupe_key'),
    /** Document ids whose PDFs are attached when the message is sent. */
    attachments: jsonb().default([]).notNull(),
    status: text().default('queued').notNull(),
    /** Delivery attempts so far; the worker backs off between them and gives up after a limit. */
    attempts: integer().default(0).notNull(),
    /** Earliest time of the next attempt; NULL means as soon as possible. */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'string' }),
    /** The email plugin that sent it; its delivery callbacks match on `provider_ref` (FR-NOT-5). */
    provider: text(),
    providerRef: text('provider_ref'),
    error: text(),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('notifications_dedupe')
      .using(
        'btree',
        table.tenantId.asc().nullsLast().op('text_ops'),
        table.dedupeKey.asc().nullsLast().op('text_ops'),
      )
      .where(sql`(dedupe_key IS NOT NULL)`),
    index('notifications_order').using(
      'btree',
      table.tenantId.asc().nullsLast().op('text_ops'),
      table.orderId.asc().nullsLast().op('text_ops'),
    ),
    index('notifications_provider_ref').on(table.provider, table.providerRef).where(sql`provider_ref IS NOT NULL`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'notifications_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [orders.id],
      name: 'notifications_order_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check('notifications_audience_check', sql`audience = ANY (ARRAY['customer'::text, 'staff'::text])`),
    check(
      'notifications_status_check',
      sql`status = ANY (ARRAY['queued'::text, 'sent'::text, 'delivered'::text, 'bounced'::text, 'failed'::text, 'cancelled'::text])`,
    ),
    index('notifications_due').on(table.nextAttemptAt).where(sql`status = 'queued'`),
  ],
);

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    url: text().notNull(),
    description: text().default('').notNull(),
    events: text().array().default(['*']).notNull(),
    secretEncrypted: text('secret_encrypted').notNull(),
    previousSecretEncrypted: text('previous_secret_encrypted'),
    secretRotatedAt: timestamp('secret_rotated_at', { withTimezone: true, mode: 'string' }),
    status: text().default('enabled').notNull(),
    apiVersion: text('api_version').default('2026-10-01').notNull(),
    failingSince: timestamp('failing_since', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'webhook_endpoints_tenant_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check(
      'webhook_endpoints_status_check',
      sql`status = ANY (ARRAY['enabled'::text, 'disabled_by_user'::text, 'disabled_failures'::text])`,
    ),
  ],
);

export const outbox = pgTable(
  'outbox',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('outbox_unpublished')
      .using('btree', table.createdAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(published_at IS NULL)`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'outbox_tenant_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
  ],
);

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    type: text().notNull(),
    payload: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('webhook_events_created').using(
      'btree',
      table.tenantId.asc().nullsLast().op('text_ops'),
      table.createdAt.desc().nullsFirst().op('text_ops'),
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'webhook_events_tenant_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
  ],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    endpointId: text('endpoint_id').notNull(),
    eventId: text('event_id').notNull(),
    attempt: integer().default(0).notNull(),
    status: text().default('pending').notNull(),
    responseCode: integer('response_code'),
    responseBody: text('response_body'),
    error: text(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'string' }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('webhook_deliveries_due')
      .using('btree', table.nextAttemptAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(status = 'pending'::text)`),
    index('webhook_deliveries_endpoint').using(
      'btree',
      table.tenantId.asc().nullsLast().op('text_ops'),
      table.endpointId.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.desc().nullsFirst().op('text_ops'),
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'webhook_deliveries_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.endpointId],
      foreignColumns: [webhookEndpoints.id],
      name: 'webhook_deliveries_endpoint_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [webhookEvents.id],
      name: 'webhook_deliveries_event_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check(
      'webhook_deliveries_status_check',
      sql`status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text])`,
    ),
  ],
);

export const checkoutSessions = pgTable(
  'checkout_sessions',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    status: text().default('open').notNull(),
    locationId: text('location_id').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'string' }),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'string' }),
    lines: jsonb().default([]).notNull(),
    customer: jsonb().default({}).notNull(),
    couponCodes: text('coupon_codes').array().default(['']).notNull(),
    options: jsonb().default({}).notNull(),
    orderId: text('order_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    /** When the abandoned-cart reminder went out (FR-SF-9); one per cart. */
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'checkout_sessions_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.locationId],
      foreignColumns: [locations.id],
      name: 'checkout_sessions_location_id_fkey',
    }),
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [orders.id],
      name: 'checkout_sessions_order_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check(
      'checkout_sessions_status_check',
      sql`status = ANY (ARRAY['open'::text, 'completed'::text, 'expired'::text])`,
    ),
  ],
);

export const plugins = pgTable(
  'plugins',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    pluginId: text('plugin_id').notNull(),
    version: text().notNull(),
    enabled: boolean().default(true).notNull(),
    config: jsonb().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'plugins_tenant_id_fkey',
    }),
    unique('plugins_tenant_id_plugin_id_key').on(table.pluginId, table.tenantId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    action: text().notNull(),
    diff: jsonb().default({}).notNull(),
    ip: text(),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_log_created').using(
      'btree',
      table.tenantId.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.desc().nullsFirst().op('text_ops'),
    ),
    index('audit_log_entity').using(
      'btree',
      table.tenantId.asc().nullsLast().op('text_ops'),
      table.entityType.asc().nullsLast().op('timestamptz_ops'),
      table.entityId.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'audit_log_tenant_id_fkey',
    }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
  ],
);

export const productCategories = pgTable(
  'product_categories',
  {
    tenantId: text('tenant_id').notNull(),
    productId: text('product_id').notNull(),
    categoryId: text('category_id').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'product_categories_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.productId],
      foreignColumns: [products.id],
      name: 'product_categories_product_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.categoryId],
      foreignColumns: [categories.id],
      name: 'product_categories_category_id_fkey',
    }).onDelete('cascade'),
    primaryKey({ columns: [table.categoryId, table.productId], name: 'product_categories_pkey' }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
  ],
);

export const documentSequences = pgTable(
  'document_sequences',
  {
    tenantId: text('tenant_id').notNull(),
    type: text().notNull(),
    year: integer().notNull(),
    prefix: text().notNull(),
    nextValue: integer('next_value').default(1).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'document_sequences_tenant_id_fkey',
    }),
    primaryKey({ columns: [table.tenantId, table.type, table.year], name: 'document_sequences_pkey' }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
  ],
);

export const stockLevels = pgTable(
  'stock_levels',
  {
    tenantId: text('tenant_id').notNull(),
    variantId: text('variant_id').notNull(),
    locationId: text('location_id').notNull(),
    quantity: integer().default(0).notNull(),
    barcode: text(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('stock_levels_barcode')
      .using(
        'btree',
        table.tenantId.asc().nullsLast().op('text_ops'),
        table.barcode.asc().nullsLast().op('text_ops'),
      )
      .where(sql`(barcode IS NOT NULL)`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'stock_levels_tenant_id_fkey',
    }),
    foreignKey({
      columns: [table.variantId],
      foreignColumns: [variants.id],
      name: 'stock_levels_variant_id_fkey',
    }),
    foreignKey({
      columns: [table.locationId],
      foreignColumns: [locations.id],
      name: 'stock_levels_location_id_fkey',
    }),
    primaryKey({ columns: [table.locationId, table.variantId], name: 'stock_levels_pkey' }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
    check('stock_levels_quantity_check', sql`quantity >= 0`),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    tenantId: text('tenant_id').notNull(),
    key: text().notNull(),
    method: text().notNull(),
    path: text().notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'idempotency_keys_tenant_id_fkey',
    }),
    primaryKey({ columns: [table.key, table.tenantId], name: 'idempotency_keys_pkey' }),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`openrent_tenant_ok(tenant_id)`,
      withCheck: sql`openrent_tenant_ok(tenant_id)`,
    }),
  ],
);

/**
 * Stored files (PRD §8.1): rendered document PDFs, uploaded theme and plugin packages, images.
 * The built-in driver keeps bytes in `data`; a StorageProvider plugin stores them elsewhere under `key`.
 */
export const files = pgTable(
  'files',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    kind: text().notNull(),
    ownerType: text('owner_type'),
    ownerId: text('owner_id'),
    filename: text().notNull(),
    contentType: text('content_type').notNull(),
    size: integer().notNull(),
    sha256: text().notNull(),
    /** Pixel size for images (originals and variants). */
    width: integer(),
    height: integer(),
    storage: text().default('database').notNull(),
    key: text(),
    data: bytea(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'files_tenant_id_fkey' }),
    // One rendered PDF per document; images and uploads may have many files per owner.
    uniqueIndex('files_owner_kind').on(table.tenantId, table.ownerType, table.ownerId, table.kind).where(sql`kind = 'pdf'`),
    index('files_owner').on(table.tenantId, table.ownerType, table.ownerId),
    check('files_storage_check', sql`(storage = 'database') = (data IS NOT NULL)`),
    tenantPolicy(),
  ],
);

/**
 * In-app notices for staff (FR-NOT-3): one row per recipient. Only the kind and its parameters are
 * stored; the admin writes the text in the reader's language.
 */
export const staffNotifications = pgTable(
  'staff_notifications',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    kind: text().notNull(),
    params: jsonb().default({}).notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    dedupeKey: text('dedupe_key'),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'staff_notifications_tenant_id_fkey' }),
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: 'staff_notifications_user_id_fkey' }).onDelete('cascade'),
    index('staff_notifications_inbox').on(table.tenantId, table.userId, table.readAt),
    uniqueIndex('staff_notifications_dedupe').on(table.tenantId, table.userId, table.dedupeKey).where(sql`dedupe_key IS NOT NULL`),
    tenantPolicy(),
  ],
);

/**
 * A shop's own storefront hostnames (FR-SF-1). A domain serves the storefront once DNS proves the shop
 * controls it (a TXT record with the token, or a CNAME to the installation). Hostnames are unique
 * across all shops; Caddy asks /system/domain_check before issuing a certificate.
 */
export const storefrontDomains = pgTable(
  'storefront_domains',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    hostname: text().notNull(),
    status: text().default('pending').notNull(),
    verificationToken: text('verification_token').notNull(),
    isPrimary: boolean('is_primary').default(false).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'string' }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true, mode: 'string' }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'storefront_domains_tenant_id_fkey' }),
    uniqueIndex('storefront_domains_hostname').on(table.hostname),
    uniqueIndex('storefront_domains_primary').on(table.tenantId).where(sql`is_primary`),
    check('storefront_domains_status_check', sql`status IN ('pending', 'verified', 'failed')`),
    check('storefront_domains_hostname_check', sql`hostname = lower(hostname) AND hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$'`),
    tenantPolicy(),
  ],
);

/**
 * Background work a member started (FR-MIG-1, FR-REP-2): full data exports and report downloads.
 * The worker claims queued rows with SKIP LOCKED; the result is a stored file.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    kind: text().notNull(),
    status: text().default('queued').notNull(),
    progress: integer().default(0).notNull(),
    params: jsonb().default({}).notNull(),
    resultFileId: text('result_file_id'),
    error: text(),
    attempts: integer().default(0).notNull(),
    createdBy: text('created_by'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'jobs_tenant_id_fkey' }),
    foreignKey({ columns: [table.resultFileId], foreignColumns: [files.id], name: 'jobs_result_file_id_fkey' }).onDelete('set null'),
    index('jobs_queued').on(table.createdAt).where(sql`status = 'queued'`),
    index('jobs_tenant_recent').on(table.tenantId, table.createdAt),
    check('jobs_status_check', sql`status IN ('queued', 'running', 'succeeded', 'failed')`),
    check('jobs_progress_check', sql`progress BETWEEN 0 AND 100`),
    tenantPolicy(),
  ],
);

/**
 * Custom fields a shop defines for products, units, customers and orders (FR-CAT-1, FR-PLG-4).
 * Values live in each record's `custom_fields`; labels and options are translated per locale.
 */
export const customFieldDefinitions = pgTable(
  'custom_field_definitions',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    entity: text().notNull(),
    key: text().notNull(),
    type: text().notNull(),
    required: boolean().default(false).notNull(),
    /** [{ value, labels: { locale: text } }] for select and multiselect. */
    options: jsonb().default([]).notNull(),
    labels: jsonb().default({}).notNull(),
    help: jsonb().default({}).notNull(),
    position: integer().default(0).notNull(),
    visibility: text().default('internal').notNull(),
    pluginId: text('plugin_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'custom_field_definitions_tenant_id_fkey' }),
    uniqueIndex('custom_field_definitions_key').on(table.tenantId, table.entity, table.key).where(sql`deleted_at IS NULL`),
    check('custom_field_definitions_entity_check', sql`entity = ANY (ARRAY['product'::text, 'stock_item'::text, 'customer'::text, 'order'::text])`),
    check(
      'custom_field_definitions_type_check',
      sql`type = ANY (ARRAY['text'::text, 'textarea'::text, 'number'::text, 'boolean'::text, 'date'::text, 'select'::text, 'multiselect'::text, 'url'::text])`,
    ),
    check('custom_field_definitions_visibility_check', sql`visibility = ANY (ARRAY['internal'::text, 'storefront'::text, 'portal'::text])`),
    check('custom_field_definitions_key_check', sql`key ~ '^[a-z][a-z0-9_]{0,39}$'`),
    tenantPolicy(),
  ],
);

/**
 * Files attached to an order, a customer or a unit (FR-OR-13): contracts, delivery notes, ID scans,
 * insurance certificates. `customer` visibility shows them in the customer's account and order page.
 */
export const attachments = pgTable(
  'attachments',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    ownerType: text('owner_type').notNull(),
    ownerId: text('owner_id').notNull(),
    fileId: text('file_id').notNull(),
    label: text().default('').notNull(),
    visibility: text().default('internal').notNull(),
    kind: text().default('attachment').notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'attachments_tenant_id_fkey' }),
    foreignKey({ columns: [table.fileId], foreignColumns: [files.id], name: 'attachments_file_id_fkey' }).onDelete('cascade'),
    uniqueIndex('attachments_file').on(table.fileId),
    index('attachments_owner').on(table.tenantId, table.ownerType, table.ownerId),
    check('attachments_owner_type_check', sql`owner_type = ANY (ARRAY['order'::text, 'customer'::text, 'stock_item'::text])`),
    check('attachments_visibility_check', sql`visibility = ANY (ARRAY['internal'::text, 'customer'::text])`),
    check('attachments_kind_check', sql`kind = ANY (ARRAY['attachment'::text, 'insurance'::text, 'id_document'::text])`),
    check('attachments_label_check', sql`char_length(label) <= 200`),
    tenantPolicy(),
  ],
);

/** Product photos in display order (FR-CAT-1). `alt` holds alt text per locale. */
export const productImages = pgTable(
  'product_images',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    productId: text('product_id').notNull(),
    fileId: text('file_id').notNull(),
    position: integer().default(0).notNull(),
    alt: jsonb().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'product_images_tenant_id_fkey' }),
    foreignKey({ columns: [table.productId], foreignColumns: [products.id], name: 'product_images_product_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [table.fileId], foreignColumns: [files.id], name: 'product_images_file_id_fkey' }),
    index('product_images_product').on(table.productId, table.position),
    tenantPolicy(),
  ],
);

/** CSV/XLSX imports (FR-CAT-8): validated first (dry run), applied on request. */
export const imports = pgTable(
  'imports',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    entity: text().notNull(),
    status: text().default('validated').notNull(),
    filename: text().notNull(),
    fileId: text('file_id'),
    report: jsonb().default({}).notNull(),
    rowCount: integer('row_count').default(0).notNull(),
    errorCount: integer('error_count').default(0).notNull(),
    /** Where the rows came from (FR-MIG-2): a file, or a system an import batch read them from. */
    source: text().default('file').notNull(),
    batchId: text('batch_id'),
    /** File column → OpenRent column, as the shop mapped it; empty uses the built-in names. */
    mapping: jsonb().default({}).notNull(),
    createdBy: text('created_by'),
    appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'imports_tenant_id_fkey' }),
    check('imports_status_check', sql`status = ANY (ARRAY['validated'::text, 'applied'::text, 'failed'::text])`),
    check('imports_entity_check', sql`entity = ANY (ARRAY['products'::text, 'stock_items'::text, 'prices'::text, 'customers'::text, 'orders'::text])`),
    index('imports_batch').on(table.tenantId, table.batchId),
    tenantPolicy(),
  ],
);

/**
 * A move from another system (FR-MIG-2): the imports read from it, checked together and applied in
 * one go, customers and products before stock and bookings.
 */
export const importBatches = pgTable(
  'import_batches',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    source: text().notNull(),
    status: text().default('fetching').notNull(),
    error: text(),
    jobId: text('job_id'),
    createdBy: text('created_by'),
    appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'import_batches_tenant_id_fkey' }),
    check('import_batches_source_check', sql`source = ANY (ARRAY['shelf'::text, 'booqable'::text, 'snipeit'::text])`),
    check('import_batches_status_check', sql`status = ANY (ARRAY['fetching'::text, 'validated'::text, 'applying'::text, 'applied'::text, 'failed'::text])`),
    tenantPolicy(),
  ],
);

/** Column mappings the shop chose, kept per kind of file so the same export maps by itself next time. */
export const importMappings = pgTable(
  'import_mappings',
  {
    tenantId: text('tenant_id').notNull(),
    entity: text().notNull(),
    /** The file's normalised headers, joined: the same export gives the same signature. */
    signature: text().notNull(),
    mapping: jsonb().default({}).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'import_mappings_tenant_id_fkey' }),
    primaryKey({ columns: [table.tenantId, table.entity, table.signature], name: 'import_mappings_pkey' }),
    tenantPolicy(),
  ],
);

/** Amounts asked of a customer: storefront down payments, balances and staff payment links (FR-PAY-2). */
export const paymentRequests = pgTable(
  'payment_requests',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    orderId: text('order_id').notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    currency: char({ length: 3 }).notNull(),
    kind: text().default('custom').notNull(),
    status: text().default('open').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'string' }),
    message: text(),
    paymentId: text('payment_id'),
    createdBy: text('created_by'),
    paidAt: timestamp('paid_at', { withTimezone: true, mode: 'string' }),
    /** A monthly invoice paid as a whole (ADR 0012): the payment is shared out over its bookings. */
    invoiceId: text('invoice_id'),
    /** A provider-hosted payment link (FR-PAY-1), when the provider makes one. */
    provider: text(),
    providerRef: text('provider_ref'),
    url: text(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'payment_requests_tenant_id_fkey' }),
    foreignKey({ columns: [table.orderId], foreignColumns: [orders.id], name: 'payment_requests_order_id_fkey' }),
    index('payment_requests_order').on(table.orderId),
    check('payment_requests_amount_check', sql`amount > 0`),
    check('payment_requests_status_check', sql`status = ANY (ARRAY['open'::text, 'paid'::text, 'cancelled'::text, 'expired'::text])`),
    check('payment_requests_kind_check', sql`kind = ANY (ARRAY['upfront'::text, 'balance'::text, 'custom'::text, 'invoice'::text])`),
    tenantPolicy(),
  ],
);

/**
 * Differences between our ledger and the payment provider, found by the nightly check (FR-PAY-7).
 * One open issue per payment and kind; staff resolve them.
 */
export const paymentReconciliationIssues = pgTable(
  'payment_reconciliation_issues',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    paymentId: text('payment_id'),
    orderId: text('order_id'),
    provider: text().notNull(),
    providerRef: text('provider_ref').notNull(),
    kind: text().notNull(),
    details: jsonb().default({}).notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'string' }),
    resolvedBy: text('resolved_by'),
    resolution: text(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'payment_reconciliation_issues_tenant_id_fkey' }),
    uniqueIndex('payment_reconciliation_issues_open').on(table.tenantId, table.provider, table.providerRef, table.kind).where(sql`resolved_at IS NULL`),
    check('payment_reconciliation_issues_kind_check', sql`kind = ANY (ARRAY['status_mismatch'::text, 'amount_mismatch'::text, 'missing_at_provider'::text])`),
    tenantPolicy(),
  ],
);

/** People at a company customer (FR-CUS-1). */
export const customerContacts = pgTable(
  'customer_contacts',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    customerId: text('customer_id').notNull(),
    name: text().notNull(),
    email: text(),
    phone: text(),
    role: text(),
    isPrimary: boolean('is_primary').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'customer_contacts_tenant_id_fkey' }),
    foreignKey({ columns: [table.customerId], foreignColumns: [customers.id], name: 'customer_contacts_customer_id_fkey' }).onDelete('cascade'),
    index('customer_contacts_customer').on(table.customerId),
    tenantPolicy(),
  ],
);

/**
 * Billing details a customer keeps for checkout (ADR 0012): private, or a company with its tax number.
 * Orders copy the one chosen (`orders.billing`), so changing a profile never changes an order.
 */
export const customerBillingProfiles = pgTable(
  'customer_billing_profiles',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    customerId: text('customer_id').notNull(),
    kind: text().default('private').notNull(),
    name: text().notNull(),
    companyName: text('company_name'),
    taxId: text('tax_id'),
    taxIdCheck: jsonb('tax_id_check'),
    address: jsonb().default({}).notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'customer_billing_profiles_tenant_id_fkey' }),
    foreignKey({ columns: [table.customerId], foreignColumns: [customers.id], name: 'customer_billing_profiles_customer_id_fkey' }).onDelete('cascade'),
    index('customer_billing_profiles_customer').on(table.customerId),
    uniqueIndex('customer_billing_profiles_one_default').on(table.customerId).where(sql`is_default`),
    check('customer_billing_profiles_kind_check', sql`kind = ANY (ARRAY['private'::text, 'company'::text])`),
    tenantPolicy(),
  ],
);

/** Delivery addresses a customer keeps for checkout. */
export const customerAddresses = pgTable(
  'customer_addresses',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    customerId: text('customer_id').notNull(),
    label: text(),
    recipient: text(),
    phone: text(),
    address: jsonb().default({}).notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'customer_addresses_tenant_id_fkey' }),
    foreignKey({ columns: [table.customerId], foreignColumns: [customers.id], name: 'customer_addresses_customer_id_fkey' }).onDelete('cascade'),
    index('customer_addresses_customer').on(table.customerId),
    uniqueIndex('customer_addresses_one_default').on(table.customerId).where(sql`is_default`),
    tenantPolicy(),
  ],
);

/** Repair work on a unit taken out of service (FR-OR-7, §3.11). Closing the ticket ends its downtime. */
export const maintenanceTickets = pgTable(
  'maintenance_tickets',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    stockItemId: text('stock_item_id').notNull(),
    status: text().default('open').notNull(),
    title: text().notNull(),
    notes: text().default('').notNull(),
    severity: text().default('soft_down').notNull(),
    createdFromOrderId: text('created_from_order_id'),
    createdBy: text('created_by'),
    priority: text().default('normal').notNull(),
    assigneeId: text('assignee_id'),
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'string' }),
    /** Repair cost in minor units, besides the parts. */
    cost: bigint({ mode: 'number' }).default(0).notNull(),
    /** [{ name, quantity, unit_cost }] */
    parts: jsonb().default([]).notNull(),
    resolution: text().default('').notNull(),
    /** Opened for a service that came due (FR-MNT-4); resolving it records the service. */
    serviceIntervalId: text('service_interval_id'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'maintenance_tickets_tenant_id_fkey' }),
    foreignKey({ columns: [table.stockItemId], foreignColumns: [stockItems.id], name: 'maintenance_tickets_stock_item_id_fkey' }),
    foreignKey({ columns: [table.assigneeId], foreignColumns: [users.id], name: 'maintenance_tickets_assignee_id_fkey' }),
    index('maintenance_tickets_open').on(table.tenantId, table.status),
    index('maintenance_tickets_assignee').on(table.tenantId, table.assigneeId),
    uniqueIndex('maintenance_tickets_one_open').on(table.stockItemId).where(sql`status NOT IN ('done', 'cancelled')`),
    check('maintenance_tickets_status_check', sql`status = ANY (ARRAY['open'::text, 'in_progress'::text, 'done'::text, 'cancelled'::text])`),
    check('maintenance_tickets_priority_check', sql`priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])`),
    check('maintenance_tickets_cost_check', sql`cost >= 0`),
    check('maintenance_tickets_severity_check', sql`severity = ANY (ARRAY['soft_down'::text, 'hard_down'::text])`),
    tenantPolicy(),
  ],
);

/**
 * The units a ticket covers besides its main unit (`maintenance_tickets.stock_item_id`). A unit is on at
 * most one open ticket: the row is released when the ticket is done or cancelled.
 */
export const maintenanceTicketUnits = pgTable(
  'maintenance_ticket_units',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    ticketId: text('ticket_id').notNull(),
    stockItemId: text('stock_item_id').notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'maintenance_ticket_units_tenant_id_fkey' }),
    foreignKey({ columns: [table.ticketId], foreignColumns: [maintenanceTickets.id], name: 'maintenance_ticket_units_ticket_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [table.stockItemId], foreignColumns: [stockItems.id], name: 'maintenance_ticket_units_stock_item_id_fkey' }),
    index('maintenance_ticket_units_ticket').on(table.ticketId),
    uniqueIndex('maintenance_ticket_units_one_open').on(table.stockItemId).where(sql`released_at IS NULL`),
    tenantPolicy(),
  ],
);

/** A count of the units at one location (FR-SCAN-3 stock take). */
export const stockTakes = pgTable(
  'stock_takes',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    locationId: text('location_id').notNull(),
    status: text().default('open').notNull(),
    startedBy: text('started_by'),
    summary: jsonb().default({}).notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'stock_takes_tenant_id_fkey' }),
    foreignKey({ columns: [table.locationId], foreignColumns: [locations.id], name: 'stock_takes_location_id_fkey' }),
    check('stock_takes_status_check', sql`status = ANY (ARRAY['open'::text, 'applied'::text, 'cancelled'::text])`),
    tenantPolicy(),
  ],
);

export const stockTakeScans = pgTable(
  'stock_take_scans',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    stockTakeId: text('stock_take_id').notNull(),
    stockItemId: text('stock_item_id'),
    code: text().notNull(),
    scannedAt: timestamp('scanned_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'stock_take_scans_tenant_id_fkey' }),
    foreignKey({ columns: [table.stockTakeId], foreignColumns: [stockTakes.id], name: 'stock_take_scans_stock_take_id_fkey' }).onDelete('cascade'),
    uniqueIndex('stock_take_scans_code').on(table.stockTakeId, table.code),
    tenantPolicy(),
  ],
);

/** One-time sign-in links for storefront customers (an account is a tenant plus an email). */
export const customerLoginTokens = pgTable(
  'customer_login_tokens',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    email: text().notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'customer_login_tokens_tenant_id_fkey' }),
    unique('customer_login_tokens_token_hash_key').on(table.tokenHash),
    index('customer_login_tokens_email').on(table.tenantId, table.email),
    tenantPolicy(),
  ],
);

export const customerSessions = pgTable(
  'customer_sessions',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    email: text().notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' }),
    ip: text(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'customer_sessions_tenant_id_fkey' }),
    unique('customer_sessions_token_hash_key').on(table.tokenHash),
    index('customer_sessions_email').on(table.tenantId, table.email),
    tenantPolicy(),
  ],
);

/**
 * Products that go with a product (FR-CAT-7): accessories offered with it, related products, and those
 * often rented with it (worked out weekly from bookings, `score` = bookings with both).
 */
export const productRelations = pgTable(
  'product_relations',
  {
    tenantId: text('tenant_id').notNull(),
    productId: text('product_id').notNull(),
    relatedProductId: text('related_product_id').notNull(),
    kind: text().notNull(),
    position: integer().default(0).notNull(),
    score: integer().default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'product_relations_tenant_id_fkey' }),
    foreignKey({ columns: [table.productId], foreignColumns: [products.id], name: 'product_relations_product_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [table.relatedProductId], foreignColumns: [products.id], name: 'product_relations_related_product_id_fkey' }).onDelete('cascade'),
    primaryKey({ columns: [table.productId, table.relatedProductId, table.kind], name: 'product_relations_pkey' }),
    index('product_relations_tenant').on(table.tenantId, table.productId),
    check('product_relations_kind_check', sql`kind = ANY (ARRAY['accessory'::text, 'related'::text, 'often_rented_with'::text])`),
    check('product_relations_not_self', sql`product_id <> related_product_id`),
    tenantPolicy(),
  ],
);

/**
 * Stock rented in from a supplier for a while (FR-CAT-9): it raises a variant's capacity at a location
 * during `period` only. What it costs is kept for the product's return (reports); the supplier's own
 * invoice is what the books record.
 */
export const externalStock = pgTable(
  'external_stock',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    variantId: text('variant_id').notNull(),
    locationId: text('location_id').notNull(),
    supplier: text().notNull(),
    quantity: integer().notNull(),
    period: tstzrange('period').notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    unitCost: bigint('unit_cost', { mode: 'number' }).default(0).notNull(),
    currency: char({ length: 3 }).notNull(),
    reference: text(),
    note: text().default('').notNull(),
    status: text().default('booked').notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'external_stock_tenant_id_fkey' }),
    foreignKey({ columns: [table.variantId], foreignColumns: [variants.id], name: 'external_stock_variant_id_fkey' }),
    foreignKey({ columns: [table.locationId], foreignColumns: [locations.id], name: 'external_stock_location_id_fkey' }),
    index('external_stock_pool').on(table.tenantId, table.variantId, table.locationId),
    check('external_stock_quantity_check', sql`quantity > 0`),
    check('external_stock_status_check', sql`status = ANY (ARRAY['booked'::text, 'cancelled'::text])`),
    tenantPolicy(),
  ],
);

/** Emails that asked not to get a kind of message (abandoned-cart reminders, FR-SF-9). */
export const emailOptouts = pgTable(
  'email_optouts',
  {
    tenantId: text('tenant_id').notNull(),
    email: text().notNull(),
    kind: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'email_optouts_tenant_id_fkey' }),
    primaryKey({ columns: [table.tenantId, table.email, table.kind], name: 'email_optouts_pkey' }),
    tenantPolicy(),
  ],
);

/** A customer's request to cancel a booking; staff approve (the order is cancelled) or decline it. */
export const cancellationRequests = pgTable(
  'cancellation_requests',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    orderId: text('order_id').notNull(),
    customerId: text('customer_id'),
    reason: text().default('').notNull(),
    status: text().default('pending').notNull(),
    decisionNote: text('decision_note'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'cancellation_requests_tenant_id_fkey' }),
    foreignKey({ columns: [table.orderId], foreignColumns: [orders.id], name: 'cancellation_requests_order_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [table.customerId], foreignColumns: [customers.id], name: 'cancellation_requests_customer_id_fkey' }),
    uniqueIndex('cancellation_requests_one_pending').on(table.orderId).where(sql`status = 'pending'`),
    index('cancellation_requests_status').on(table.tenantId, table.status),
    check('cancellation_requests_status_check', sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text, 'withdrawn'::text])`),
    tenantPolicy(),
  ],
);

/** Secret iCal feed URLs for staff calendars (FR-INT-2). */
export const calendarFeeds = pgTable(
  'calendar_feeds',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    name: text().notNull(),
    locationId: text('location_id'),
    /** A feed of one unit's bookings and downtime instead of the shop's pickups and returns. */
    stockItemId: text('stock_item_id'),
    tokenHash: text('token_hash').notNull(),
    createdBy: text('created_by'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'string' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'calendar_feeds_tenant_id_fkey' }),
    foreignKey({ columns: [table.locationId], foreignColumns: [locations.id], name: 'calendar_feeds_location_id_fkey' }),
    foreignKey({ columns: [table.stockItemId], foreignColumns: [stockItems.id], name: 'calendar_feeds_stock_item_id_fkey' }).onDelete('cascade'),
    unique('calendar_feeds_token_hash_key').on(table.tokenHash),
    tenantPolicy(),
  ],
);

/**
 * SQL migrations of plugins (FR-PLG-9), applied after OpenRent's own and recorded here. Plugins may only
 * create their own `plg_<id>_` tables; the checksum shows when an applied file was changed afterwards.
 */
export const pluginMigrations = pgTable(
  'plugin_migrations',
  {
    pluginId: text('plugin_id').notNull(),
    name: text().notNull(),
    checksum: text().notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.pluginId, table.name], name: 'plugin_migrations_pkey' })],
);

/**
 * Child themes a shop installed (FR-THM-8): a theme that `extends` an installed code theme and brings
 * only data (default settings, home layout, texts, CSS, assets), so it works without a storefront build.
 */
export const customThemes = pgTable(
  'custom_themes',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    themeId: text('theme_id').notNull(),
    parentId: text('parent_id').notNull(),
    version: text().notNull(),
    manifest: jsonb().default({}).notNull(),
    settingsData: jsonb('settings_data').default({}).notNull(),
    sectionsData: jsonb('sections_data'),
    locales: jsonb().default({}).notNull(),
    css: text().default('').notNull(),
    /** Asset path → file id (files of kind theme_asset). */
    assets: jsonb().default({}).notNull(),
    /** sha256 of every file in the installed package, for the diff shown on update. */
    fileHashes: jsonb('file_hashes').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'custom_themes_tenant_id_fkey' }),
    uniqueIndex('custom_themes_theme').on(table.tenantId, table.themeId),
    tenantPolicy(),
  ],
);

/**
 * A shop's own wording (FR-I18N-6): one row per namespace (storefront, theme:<id>, plugin:<id>, email,
 * documents), language and key. Placeholders must match the built-in text.
 */
export const stringOverrides = pgTable(
  'string_overrides',
  {
    tenantId: text('tenant_id').notNull(),
    namespace: text().notNull(),
    locale: text().notNull(),
    key: text().notNull(),
    value: text().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.namespace, table.locale, table.key], name: 'string_overrides_pkey' }),
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'string_overrides_tenant_id_fkey' }),
    tenantPolicy(),
  ],
);

/**
 * Price rules (FR-PR-7): seasonal, weekday, holiday, customer-group, volume and lead-time adjustments to
 * rental prices, applied after the base price and before coupons. `adjustment_bp` is a percentage in
 * basis points: −1000 is 10 % off, 2500 is 25 % more. Empty `product_ids` and `category_ids` mean every
 * rental product. Rules are only ever soft-deleted so old quotes can still name them.
 */
export const priceRules = pgTable(
  'price_rules',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    name: text().notNull(),
    kind: text().notNull(),
    priority: integer().default(100).notNull(),
    adjustmentBp: integer('adjustment_bp').notNull(),
    stackable: boolean().default(false).notNull(),
    active: boolean().default(true).notNull(),
    productIds: text('product_ids').array().default(sql`'{}'::text[]`).notNull(),
    categoryIds: text('category_ids').array().default(sql`'{}'::text[]`).notNull(),
    /** season, holiday: local dates, both inclusive. */
    startsOn: date('starts_on', { mode: 'string' }),
    endsOn: date('ends_on', { mode: 'string' }),
    /** weekday: 0 = Sunday … 6 = Saturday. */
    weekdays: integer().array().default(sql`'{}'::integer[]`).notNull(),
    /** customer_group: applies when the customer has any of these tags. */
    customerTags: text('customer_tags').array().default(sql`'{}'::text[]`).notNull(),
    /** volume: applies from this quantity on a line. */
    minQuantity: integer('min_quantity'),
    /** lead_time: days between booking and pickup; min for early-bird, max for last-minute. */
    minLeadDays: integer('min_lead_days'),
    maxLeadDays: integer('max_lead_days'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'price_rules_tenant_id_fkey' }),
    index('price_rules_tenant_active').on(table.tenantId).where(sql`deleted_at IS NULL AND active`),
    check('price_rules_kind_check', sql`kind = ANY (ARRAY['season'::text, 'weekday'::text, 'holiday'::text, 'customer_group'::text, 'volume'::text, 'lead_time'::text])`),
    check('price_rules_adjustment_check', sql`adjustment_bp >= '-10000'::integer AND adjustment_bp <= 100000`),
    check('price_rules_dates_check', sql`starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on`),
    tenantPolicy(),
  ],
);

/**
 * Fees added to orders by rule (FR-PR-8): delivery, cleaning and damage waiver in quotes; extension and
 * late fees when a rental is extended or returned late. `amount` is minor units, or basis points for
 * `percent`. `zones` prices delivery by postcode prefix. `optional` fees are chosen by the customer.
 */
export const feeRules = pgTable(
  'fee_rules',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    name: text().notNull(),
    kind: text().notNull(),
    calculation: text().notNull(),
    amount: bigint({ mode: 'number' }).default(0).notNull(),
    periodUnit: text('period_unit'),
    /** [{ postcodes: ['101', '102'], amount }] for `zone`. */
    zones: jsonb().default([]).notNull(),
    /** [{ up_to_km, amount }] for `per_km` (FR-PR-8): the first band the distance fits; null `up_to_km` is any distance. */
    distanceBands: jsonb('distance_bands').default([]).notNull(),
    mode: text().default('auto').notNull(),
    productIds: text('product_ids').array().default(sql`'{}'::text[]`).notNull(),
    categoryIds: text('category_ids').array().default(sql`'{}'::text[]`).notNull(),
    taxProfileId: text('tax_profile_id'),
    /** { locale: { name, description } } for the storefront. */
    translations: jsonb().default({}).notNull(),
    description: text().default('').notNull(),
    position: integer().default(0).notNull(),
    active: boolean().default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'fee_rules_tenant_id_fkey' }),
    check('fee_rules_kind_check', sql`kind = ANY (ARRAY['delivery'::text, 'cleaning'::text, 'damage_waiver'::text, 'extension'::text, 'late'::text])`),
    check('fee_rules_calculation_check', sql`calculation = ANY (ARRAY['flat'::text, 'per_unit'::text, 'percent'::text, 'per_period'::text, 'zone'::text, 'per_km'::text])`),
    check('fee_rules_mode_check', sql`mode = ANY (ARRAY['auto'::text, 'optional'::text])`),
    check('fee_rules_amount_check', sql`amount >= 0`),
    check('fee_rules_period_unit_check', sql`period_unit IS NULL OR period_unit = ANY (ARRAY['hour'::text, 'day'::text, 'week'::text, 'month'::text])`),
    tenantPolicy(),
  ],
);

/**
 * A customer asking to keep a rental longer (FR-CUS-6, FR-OR-9). Staff approve (the order is extended
 * and repriced) or decline; one pending request per order.
 */
export const extensionRequests = pgTable(
  'extension_requests',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    orderId: text('order_id').notNull(),
    customerId: text('customer_id'),
    requestedEndsAt: timestamp('requested_ends_at', { withTimezone: true, mode: 'string' }).notNull(),
    // Set when the customer asks for other dates altogether (a date change), not only a later return.
    requestedStartsAt: timestamp('requested_starts_at', { withTimezone: true, mode: 'string' }),
    reason: text().default('').notNull(),
    status: text().default('pending').notNull(),
    decisionNote: text('decision_note'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'extension_requests_tenant_id_fkey' }),
    foreignKey({ columns: [table.orderId], foreignColumns: [orders.id], name: 'extension_requests_order_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [table.customerId], foreignColumns: [customers.id], name: 'extension_requests_customer_id_fkey' }),
    uniqueIndex('extension_requests_one_pending').on(table.orderId).where(sql`status = 'pending'`),
    index('extension_requests_status').on(table.tenantId, table.status),
    check('extension_requests_status_check', sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text, 'withdrawn'::text])`),
    tenantPolicy(),
  ],
);

/**
 * Delivering an order to the customer or collecting it (FR-OR-12). The time window may reach outside
 * the rental; the order's bookings are stretched to cover it. One active delivery and one active
 * collection per order. `route_date` and `position` order a driver's run.
 */
export const deliveries = pgTable(
  'deliveries',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    orderId: text('order_id').notNull(),
    kind: text().notNull(),
    status: text().default('scheduled').notNull(),
    address: jsonb().default({}).notNull(),
    /** Where the address is on the map (geocoded), for route exports (FR-PR-8). */
    lat: doublePrecision(),
    lon: doublePrecision(),
    contact: jsonb().default({}).notNull(),
    windowStart: timestamp('window_start', { withTimezone: true, mode: 'string' }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true, mode: 'string' }).notNull(),
    routeDate: date('route_date', { mode: 'string' }).notNull(),
    position: integer().default(0).notNull(),
    driverUserId: text('driver_user_id'),
    notes: text().default('').notNull(),
    signedName: text('signed_name'),
    signatureFileId: text('signature_file_id'),
    failureReason: text('failure_reason'),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true, mode: 'string' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'deliveries_tenant_id_fkey' }),
    foreignKey({ columns: [table.orderId], foreignColumns: [orders.id], name: 'deliveries_order_id_fkey' }).onDelete('cascade'),
    uniqueIndex('deliveries_one_active').on(table.orderId, table.kind).where(sql`status IN ('scheduled', 'dispatched')`),
    index('deliveries_route').on(table.tenantId, table.routeDate, table.position),
    check('deliveries_kind_check', sql`kind = ANY (ARRAY['delivery'::text, 'collection'::text])`),
    check('deliveries_status_check', sql`status = ANY (ARRAY['scheduled'::text, 'dispatched'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])`),
    check('deliveries_window_check', sql`window_end > window_start`),
    tenantPolicy(),
  ],
);

/**
 * Staff booking more than is in stock on purpose (FR-AV-8), with the reason. Only unassigned quantity can be
 * overbooked; specific units stay protected by the exclusion constraint. The allocations over capacity
 * carry `overbooking_id`, so checks can tell an overbooking from an unexplained shortage.
 */
export const overbookings = pgTable(
  'overbookings',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    orderId: text('order_id').notNull(),
    variantId: text('variant_id').notNull(),
    locationId: text('location_id').notNull(),
    quantity: integer().notNull(),
    reason: text().notNull(),
    createdBy: text('created_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'overbookings_tenant_id_fkey' }),
    foreignKey({ columns: [table.orderId], foreignColumns: [orders.id], name: 'overbookings_order_id_fkey' }).onDelete('cascade'),
    index('overbookings_pool').on(table.tenantId, table.variantId, table.locationId),
    check('overbookings_quantity_check', sql`quantity > 0`),
    tenantPolicy(),
  ],
);

/** Stock moved between locations (FR-LOC-2, ADR 0007): planned, in transit, received or cancelled. */
export const transfers = pgTable(
  'transfers',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    number: integer().notNull(),
    fromLocationId: text('from_location_id').notNull(),
    toLocationId: text('to_location_id').notNull(),
    status: text().default('planned').notNull(),
    shipsAt: timestamp('ships_at', { withTimezone: true, mode: 'string' }).notNull(),
    eta: timestamp({ withTimezone: true, mode: 'string' }),
    notes: text().default('').notNull(),
    createdBy: text('created_by'),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true, mode: 'string' }),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'string' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'transfers_tenant_id_fkey' }),
    foreignKey({ columns: [table.fromLocationId], foreignColumns: [locations.id], name: 'transfers_from_location_id_fkey' }),
    foreignKey({ columns: [table.toLocationId], foreignColumns: [locations.id], name: 'transfers_to_location_id_fkey' }),
    uniqueIndex('transfers_number').on(table.tenantId, table.number),
    index('transfers_status').on(table.tenantId, table.status),
    check('transfers_status_check', sql`status = ANY (ARRAY['planned'::text, 'in_transit'::text, 'received'::text, 'cancelled'::text])`),
    check('transfers_locations_check', sql`from_location_id <> to_location_id`),
    tenantPolicy(),
  ],
);

/** One unit, or a quantity of a bulk variant, on a transfer. */
export const transferLines = pgTable(
  'transfer_lines',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    transferId: text('transfer_id').notNull(),
    variantId: text('variant_id').notNull(),
    stockItemId: text('stock_item_id'),
    quantity: integer().notNull(),
    receivedQuantity: integer('received_quantity').default(0).notNull(),
    lostQuantity: integer('lost_quantity').default(0).notNull(),
    position: integer().default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'transfer_lines_tenant_id_fkey' }),
    foreignKey({ columns: [table.transferId], foreignColumns: [transfers.id], name: 'transfer_lines_transfer_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [table.variantId], foreignColumns: [variants.id], name: 'transfer_lines_variant_id_fkey' }),
    foreignKey({ columns: [table.stockItemId], foreignColumns: [stockItems.id], name: 'transfer_lines_stock_item_id_fkey' }),
    index('transfer_lines_transfer').on(table.transferId),
    check('transfer_lines_quantity_check', sql`quantity > 0 AND (stock_item_id IS NULL OR quantity = 1)`),
    check('transfer_lines_received_check', sql`received_quantity >= 0 AND lost_quantity >= 0 AND received_quantity + lost_quantity <= quantity`),
    tenantPolicy(),
  ],
);

/**
 * A checklist for the units of some categories (FR-MNT-3), e.g. e-bikes: brakes, battery, lights.
 * Items carry their label in every shop language. Changing the items raises the version; inspections
 * keep a copy of the version they used.
 */
export const inspectionTemplates = pgTable(
  'inspection_templates',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    name: text().notNull(),
    /** [{ key, label: { en, de, … }, kind: 'check' | 'number' | 'text', required, fail_status }] */
    items: jsonb().default([]).notNull(),
    categoryIds: text('category_ids').array().default(sql`'{}'::text[]`).notNull(),
    version: integer().default(1).notNull(),
    active: boolean().default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'inspection_templates_tenant_id_fkey' }),
    tenantPolicy(),
  ],
);

/** One checklist run on one unit. Never changed afterwards. */
export const inspections = pgTable(
  'inspections',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    stockItemId: text('stock_item_id').notNull(),
    templateId: text('template_id').notNull(),
    templateVersion: integer('template_version').notNull(),
    /** The template's name and items as they were. */
    template: jsonb().notNull(),
    /** [{ key, passed, value, note }] */
    results: jsonb().default([]).notNull(),
    passed: boolean().notNull(),
    orderId: text('order_id'),
    ticketId: text('ticket_id'),
    performedBy: text('performed_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'inspections_tenant_id_fkey' }),
    foreignKey({ columns: [table.stockItemId], foreignColumns: [stockItems.id], name: 'inspections_stock_item_id_fkey' }),
    foreignKey({ columns: [table.templateId], foreignColumns: [inspectionTemplates.id], name: 'inspections_template_id_fkey' }),
    foreignKey({ columns: [table.orderId], foreignColumns: [orders.id], name: 'inspections_order_id_fkey' }),
    index('inspections_unit').on(table.stockItemId, table.createdAt),
    tenantPolicy(),
  ],
);

/** A unit's meter over time (FR-CAT-10). Readings never go down (sql/invariants.sql). */
export const meterReadings = pgTable(
  'meter_readings',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    stockItemId: text('stock_item_id').notNull(),
    value: doublePrecision().notNull(),
    source: text().default('manual').notNull(),
    orderId: text('order_id'),
    recordedBy: text('recorded_by'),
    recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'meter_readings_tenant_id_fkey' }),
    foreignKey({ columns: [table.stockItemId], foreignColumns: [stockItems.id], name: 'meter_readings_stock_item_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [table.orderId], foreignColumns: [orders.id], name: 'meter_readings_order_id_fkey' }),
    index('meter_readings_unit').on(table.stockItemId, table.recordedAt),
    check('meter_readings_value_check', sql`value >= 0`),
    check('meter_readings_source_check', sql`source = ANY (ARRAY['manual'::text, 'check_out'::text, 'check_in'::text, 'service'::text])`),
    tenantPolicy(),
  ],
);

/** How often units need a service: every so many days, rentals or meter units (FR-MNT-4). */
export const serviceIntervals = pgTable(
  'service_intervals',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    name: text().notNull(),
    /** One product, or a category; neither means every unit. */
    productId: text('product_id'),
    categoryId: text('category_id'),
    everyDays: integer('every_days'),
    everyRentals: integer('every_rentals'),
    everyMeter: doublePrecision('every_meter'),
    /** Opens a repair ticket (the unit stays in service) once the service is overdue. */
    opensTicket: boolean('opens_ticket').default(true).notNull(),
    active: boolean().default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'service_intervals_tenant_id_fkey' }),
    foreignKey({ columns: [table.productId], foreignColumns: [products.id], name: 'service_intervals_product_id_fkey' }),
    foreignKey({ columns: [table.categoryId], foreignColumns: [categories.id], name: 'service_intervals_category_id_fkey' }),
    check('service_intervals_some_check', sql`every_days > 0 OR every_rentals > 0 OR every_meter > 0`),
    tenantPolicy(),
  ],
);

/** A service done on a unit; the next one is due from here. */
export const serviceEvents = pgTable(
  'service_events',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    stockItemId: text('stock_item_id').notNull(),
    intervalId: text('interval_id').notNull(),
    performedAt: timestamp('performed_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    meterValue: doublePrecision('meter_value'),
    ticketId: text('ticket_id'),
    notes: text().default('').notNull(),
    performedBy: text('performed_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'service_events_tenant_id_fkey' }),
    foreignKey({ columns: [table.stockItemId], foreignColumns: [stockItems.id], name: 'service_events_stock_item_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [table.intervalId], foreignColumns: [serviceIntervals.id], name: 'service_events_interval_id_fkey' }),
    index('service_events_unit').on(table.stockItemId, table.intervalId, table.performedAt),
    tenantPolicy(),
  ],
);

/** Scans made offline and sent later (FR-SCAN-5); the client id makes a resent batch harmless. */
export const scanReplays = pgTable(
  'scan_replays',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    clientId: text('client_id').notNull(),
    mode: text().notNull(),
    code: text().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }).notNull(),
    result: jsonb().notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'scan_replays_tenant_id_fkey' }),
    uniqueIndex('scan_replays_client').on(table.tenantId, table.clientId),
    tenantPolicy(),
  ],
);

/**
 * A request for a customer to sign an issued document (FR-DOC-5). The link token and the emailed code
 * are stored hashed; five wrong codes lock the request.
 */
export const signatureRequests = pgTable(
  'signature_requests',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    documentId: text('document_id').notNull(),
    orderId: text('order_id'),
    signerName: text('signer_name').notNull(),
    signerEmail: text('signer_email').notNull(),
    tokenHash: text('token_hash').notNull(),
    codeHash: text('code_hash'),
    codeExpiresAt: timestamp('code_expires_at', { withTimezone: true, mode: 'string' }),
    codeSends: integer('code_sends').default(0).notNull(),
    attempts: integer().default(0).notNull(),
    status: text().default('pending').notNull(),
    /** 'builtin', or the id of a signature plugin that handles the signing. */
    provider: text().default('builtin').notNull(),
    providerRef: text('provider_ref'),
    providerUrl: text('provider_url'),
    viewedAt: timestamp('viewed_at', { withTimezone: true, mode: 'string' }),
    signedAt: timestamp('signed_at', { withTimezone: true, mode: 'string' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'signature_requests_tenant_id_fkey' }),
    foreignKey({ columns: [table.documentId], foreignColumns: [documents.id], name: 'signature_requests_document_id_fkey' }),
    foreignKey({ columns: [table.orderId], foreignColumns: [orders.id], name: 'signature_requests_order_id_fkey' }),
    uniqueIndex('signature_requests_token').on(table.tokenHash),
    uniqueIndex('signature_requests_one_pending').on(table.documentId).where(sql`status = 'pending'`),
    check('signature_requests_status_check', sql`status = ANY (ARRAY['pending'::text, 'signed'::text, 'cancelled'::text, 'expired'::text])`),
    tenantPolicy(),
  ],
);

/** A signed document: who, how, and hashes of exactly what was signed. Never changed afterwards. */
export const signatures = pgTable(
  'signatures',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    requestId: text('request_id').notNull(),
    documentId: text('document_id').notNull(),
    signerName: text('signer_name').notNull(),
    signerEmail: text('signer_email').notNull(),
    method: text().notNull(),
    imageFileId: text('image_file_id'),
    ip: text(),
    userAgent: text('user_agent'),
    htmlSha256: text('html_sha256').notNull(),
    pdfSha256: text('pdf_sha256'),
    pdfFileId: text('pdf_file_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'signatures_tenant_id_fkey' }),
    foreignKey({ columns: [table.requestId], foreignColumns: [signatureRequests.id], name: 'signatures_request_id_fkey' }),
    foreignKey({ columns: [table.documentId], foreignColumns: [documents.id], name: 'signatures_document_id_fkey' }),
    index('signatures_document').on(table.documentId),
    check('signatures_method_check', sql`method = ANY (ARRAY['typed'::text, 'drawn'::text])`),
    tenantPolicy(),
  ],
);

/** A shop's own role: a name and a set of permissions (FR-USR-3). The five fixed roles stay in code. */
export const roles = pgTable(
  'roles',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    name: text().notNull(),
    description: text().default('').notNull(),
    permissions: text().array().default(sql`'{}'::text[]`).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'roles_tenant_id_fkey' }),
    uniqueIndex('roles_name').on(table.tenantId, sql`lower(name)`).where(sql`deleted_at IS NULL`),
    tenantPolicy(),
  ],
);

/** OpenID Connect single sign-on for staff (FR-USR-4). The client secret is sealed. */
export const ssoProviders = pgTable(
  'sso_providers',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    /** Shown on the sign-in button: "Sign in with {name}". */
    name: text().notNull(),
    issuer: text().notNull(),
    clientId: text('client_id').notNull(),
    clientSecretEncrypted: text('client_secret_encrypted'),
    /** Email domains whose people may sign in this way (and join the shop). */
    allowedDomains: text('allowed_domains').array().default(sql`'{}'::text[]`).notNull(),
    /** Role for someone who signs in for the first time: a built-in role key or a role id. */
    defaultRole: text('default_role').default('read_only').notNull(),
    /** People of these domains may only sign in this way. */
    enforceSso: boolean('enforce_sso').default(false).notNull(),
    active: boolean().default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'sso_providers_tenant_id_fkey' }),
    tenantPolicy(),
  ],
);

/**
 * A shop's connection to another system through an integration plugin (accounting, calendars, CRM…).
 * Credentials are sealed. One live connection per integration and shop.
 */
export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    providerId: text('provider_id').notNull(),
    /** pending (OAuth under way), connected, error (needs attention), disconnected. */
    status: text().default('pending').notNull(),
    accountName: text('account_name'),
    /** What the integration keeps about the other side (organisation ids…). */
    account: jsonb().default({}).notNull(),
    credentialsEncrypted: text('credentials_encrypted'),
    settings: jsonb().default({}).notNull(),
    oauthStateHash: text('oauth_state_hash'),
    oauthVerifierEncrypted: text('oauth_verifier_encrypted'),
    /** Only events from this moment on are brought across, unless staff run a catch-up. */
    syncFrom: timestamp('sync_from', { withTimezone: true, mode: 'string' }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true, mode: 'string' }),
    lastError: text('last_error'),
    connectedBy: text('connected_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'integration_connections_tenant_id_fkey' }),
    uniqueIndex('integration_connections_live').on(table.tenantId, table.providerId).where(sql`status <> 'disconnected'`),
    uniqueIndex('integration_connections_state').on(table.oauthStateHash).where(sql`oauth_state_hash IS NOT NULL`),
    check('integration_connections_status_check', sql`status = ANY (ARRAY['pending'::text, 'connected'::text, 'error'::text, 'disconnected'::text])`),
    tenantPolicy(),
  ],
);

/** One event to bring across one connection, retried with backoff until it succeeds or gives up. */
export const integrationTasks = pgTable(
  'integration_tasks',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    connectionId: text('connection_id').notNull(),
    /** The outbox event, or a catch-up key; the same one is never queued twice. */
    sourceKey: text('source_key').notNull(),
    event: text().notNull(),
    objectType: text('object_type').notNull(),
    objectId: text('object_id').notNull(),
    status: text().default('pending').notNull(),
    attempts: integer().default(0).notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    message: text(),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'integration_tasks_tenant_id_fkey' }),
    foreignKey({ columns: [table.connectionId], foreignColumns: [integrationConnections.id], name: 'integration_tasks_connection_id_fkey' }).onDelete('cascade'),
    uniqueIndex('integration_tasks_source').on(table.connectionId, table.sourceKey),
    index('integration_tasks_due').on(table.status, table.nextAttemptAt),
    check('integration_tasks_status_check', sql`status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'skipped'::text, 'failed'::text])`),
    tenantPolicy(),
  ],
);

/** Which record in the other system an OpenRent record became, per connection. */
export const integrationLinks = pgTable(
  'integration_links',
  {
    tenantId: text('tenant_id').notNull(),
    connectionId: text('connection_id').notNull(),
    localType: text('local_type').notNull(),
    localId: text('local_id').notNull(),
    remoteId: text('remote_id').notNull(),
    extra: jsonb().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.connectionId, table.localType, table.localId], name: 'integration_links_pkey' }),
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'integration_links_tenant_id_fkey' }),
    foreignKey({ columns: [table.connectionId], foreignColumns: [integrationConnections.id], name: 'integration_links_connection_id_fkey' }).onDelete('cascade'),
    tenantPolicy(),
  ],
);

/**
 * Money movements waiting to become accounting entries. Database triggers add a row in the same
 * transaction as the invoice, credit note, void or payment, so no code path can skip the books.
 */
export const accountingQueue = pgTable(
  'accounting_queue',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    event: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'accounting_queue_tenant_id_fkey' }),
    uniqueIndex('accounting_queue_source').on(table.tenantId, table.sourceType, table.sourceId, table.event),
    check('accounting_queue_source_type_check', sql`source_type = ANY (ARRAY['document'::text, 'payment'::text])`),
    tenantPolicy(),
  ],
);

/** A balanced, numbered accounting entry. Never changed: a correction is a new entry that reverses it. */
export const accountingEntries = pgTable(
  'accounting_entries',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    number: integer().notNull(),
    kind: text().notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    entryDate: date('entry_date', { mode: 'string' }).notNull(),
    /** The date the movement happened, when a lock date moved the entry later. */
    originalDate: date('original_date', { mode: 'string' }),
    currency: char({ length: 3 }).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    total: bigint({ mode: 'number' }).notNull(),
    reference: text().notNull(),
    orderId: text('order_id'),
    customerId: text('customer_id'),
    reversalOf: text('reversal_of'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'accounting_entries_tenant_id_fkey' }),
    uniqueIndex('accounting_entries_number').on(table.tenantId, table.number),
    uniqueIndex('accounting_entries_source').on(table.tenantId, table.kind, table.sourceType, table.sourceId),
    index('accounting_entries_date').on(table.tenantId, table.entryDate),
    check(
      'accounting_entries_kind_check',
      sql`kind = ANY (ARRAY['invoice'::text, 'credit_note'::text, 'invoice_void'::text, 'payment'::text, 'refund'::text, 'deposit_received'::text, 'deposit_returned'::text, 'deposit_applied'::text, 'damage_revenue'::text])`,
    ),
    tenantPolicy(),
  ],
);

export const accountingEntryLines = pgTable(
  'accounting_entry_lines',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    entryId: text('entry_id').notNull(),
    position: integer().notNull(),
    accountKey: text('account_key').notNull(),
    /** The shop's account code when the entry was posted; later changes apply to new entries only. */
    accountCode: text('account_code').notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    debit: bigint({ mode: 'number' }).default(0).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    credit: bigint({ mode: 'number' }).default(0).notNull(),
    taxRateBp: integer('tax_rate_bp'),
    description: text().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'accounting_entry_lines_tenant_id_fkey' }),
    foreignKey({ columns: [table.entryId], foreignColumns: [accountingEntries.id], name: 'accounting_entry_lines_entry_id_fkey' }),
    index('accounting_entry_lines_entry').on(table.entryId),
    check('accounting_entry_lines_amounts_check', sql`debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0)`),
    tenantPolicy(),
  ],
);

/**
 * A report with its filters, saved under a name (FR-REP-4). With a schedule it is emailed as CSV or
 * XLSX to its recipients; `params.range` keeps the period relative (last month, the last 7 days…).
 */
export const savedReports = pgTable(
  'saved_reports',
  {
    id: text().primaryKey().notNull(),
    tenantId: text('tenant_id').notNull(),
    name: text().notNull(),
    report: text().notNull(),
    params: jsonb().default({}).notNull(),
    format: text().default('csv').notNull(),
    schedule: text(),
    recipients: jsonb().default([]).notNull(),
    nextRunAt: timestamp('next_run_at', { withTimezone: true, mode: 'string' }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true, mode: 'string' }),
    lastError: text('last_error'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'saved_reports_tenant_id_fkey' }),
    foreignKey({ columns: [table.createdBy], foreignColumns: [users.id], name: 'saved_reports_created_by_fkey' }).onDelete('set null'),
    index('saved_reports_tenant').on(table.tenantId, table.name),
    index('saved_reports_due').on(table.nextRunAt).where(sql`schedule IS NOT NULL`),
    check('saved_reports_format_check', sql`format = ANY (ARRAY['csv'::text, 'xlsx'::text])`),
    check('saved_reports_schedule_check', sql`schedule IS NULL OR schedule = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text])`),
    tenantPolicy(),
  ],
);

/**
 * Addresses already looked up on the map (FR-PR-8): geocoding services ask callers to keep answers
 * instead of asking again. `lat`/`lon` are null for an address that was not found.
 */
export const geocodeCache = pgTable(
  'geocode_cache',
  {
    tenantId: text('tenant_id').notNull(),
    query: text().notNull(),
    lat: doublePrecision(),
    lon: doublePrecision(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id], name: 'geocode_cache_tenant_id_fkey' }),
    primaryKey({ columns: [table.tenantId, table.query], name: 'geocode_cache_pkey' }),
    tenantPolicy(),
  ],
);
