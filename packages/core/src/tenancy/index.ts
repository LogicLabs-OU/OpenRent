import { t as msg } from '../i18n/index.ts';
import { isLocale } from '@openrent/i18n';
import type { Ctx, Queryable } from '../context.ts';
import { t as tr } from '../i18n/index.ts';
import { AppError, invalid, type FieldError } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId, sha256 } from '../ids.ts';
import { exec, json, many, must, one, updateSql } from '../sql.ts';
import { generateApiKey, hashPassword } from '../auth/index.ts';
import { isValidTimeZone } from '../time.ts';
import { ACCOUNT_KEYS, DEFAULT_OPENING_HOURS, deepMerge, resolveSettings, type TenantSettings } from './settings.ts';

export * from './settings.ts';

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  address: Record<string, unknown>;
  tax_ids: unknown[];
  currency: string;
  timezone: string;
  locale: string;
  settings: Partial<TenantSettings>;
  branding: Record<string, unknown>;
  invoice_numbering: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export async function getTenant(ctx: Ctx): Promise<TenantRow> {
  return must<TenantRow>(ctx, `SELECT * FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
}

export async function getSettings(ctx: Ctx): Promise<TenantSettings> {
  const t = await getTenant(ctx);
  return resolveSettings(t.settings);
}

export function tenantToApi(t: TenantRow) {
  return {
    id: t.id,
    object: 'tenant',
    slug: t.slug,
    name: t.name,
    legal_name: t.legal_name,
    address: t.address,
    tax_ids: t.tax_ids,
    currency: t.currency.trim(),
    timezone: t.timezone,
    locale: t.locale,
    branding: t.branding,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

const TENANT_COLS = {
  name: {}, legal_name: {}, address: { json: true }, tax_ids: { json: true }, timezone: {}, locale: {},
  branding: { json: true }, invoice_numbering: { json: true }, currency: {},
};

export async function updateTenant(ctx: Ctx, patch: Record<string, unknown>) {
  const before = await getTenant(ctx);
  if (patch.timezone && !isValidTimeZone(String(patch.timezone))) throw invalid(msg('error.unknown_time_zone'), [{ field: 'timezone', code: 'invalid', message: msg('error.field.unknown_iana_time_zone') }]);
  if (patch.currency && patch.currency !== before.currency.trim()) {
    const used = await one(ctx, `SELECT 1 FROM orders LIMIT 1`);
    if (used) throw new AppError('currency_locked', 409, msg('error.the_base_currency_cannot_change_once_orders'));
  }
  const q = updateSql('tenants', ctx.tenantId, patch, TENANT_COLS);
  if (!q) return before;
  const after = (await many<TenantRow>(ctx, q.text, q.values))[0]!;
  await audit(ctx, { entity_type: 'tenant', entity_id: ctx.tenantId, action: 'update', before, after });
  return after;
}

function validateSettings(s: TenantSettings) {
  const errors: { field: string; code: string; message: string }[] = [];
  const pt = s.payment_terms;
  if (!['full', 'percent', 'fixed'].includes(pt.upfront)) errors.push({ field: 'payment_terms.upfront', code: 'invalid', message: tr('settings.invalid_upfront') });
  if (!Number.isInteger(pt.percent_bp) || pt.percent_bp < 100 || pt.percent_bp > 10000) errors.push({ field: 'payment_terms.percent_bp', code: 'out_of_range', message: tr('settings.invalid_percent') });
  if (!Number.isInteger(pt.fixed_amount) || pt.fixed_amount < 0) errors.push({ field: 'payment_terms.fixed_amount', code: 'invalid', message: tr('settings.invalid_amount') });
  if (!Number.isInteger(pt.balance_due_days_before) || pt.balance_due_days_before < 0 || pt.balance_due_days_before > 60) errors.push({ field: 'payment_terms.balance_due_days_before', code: 'out_of_range', message: tr('settings.invalid_days') });
  if (!Number.isInteger(s.damage_waiver_excess) || s.damage_waiver_excess < 0) errors.push({ field: 'damage_waiver_excess', code: 'invalid', message: tr('settings.invalid_amount') });
  if (typeof s.requires_waiver_or_insurance !== 'boolean') errors.push({ field: 'requires_waiver_or_insurance', code: 'invalid', message: tr('settings.invalid') });
  for (const [k, v] of Object.entries(s.accounting?.accounts ?? {}))
    if (!(ACCOUNT_KEYS as readonly string[]).includes(k) || typeof v !== 'string' || !v.trim() || v.length > 40) errors.push({ field: `accounting.accounts.${k}`, code: 'invalid', message: tr('error.field.account_code') });
  const lock = s.accounting.locked_until;
  if (lock !== null && (typeof lock !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(lock) || Number.isNaN(Date.parse(lock)) || lock > new Date().toISOString().slice(0, 10)))
    errors.push({ field: 'accounting.locked_until', code: 'invalid', message: tr('error.field.lock_date') });
  if (!['manual', 'reserved', 'checked_out', 'closed'].includes(s.accounting.invoice_when)) errors.push({ field: 'accounting.invoice_when', code: 'invalid', message: tr('settings.invalid') });
  if (typeof s.require_inspection_on_return !== 'boolean') errors.push({ field: 'require_inspection_on_return', code: 'invalid', message: tr('settings.invalid') });
  if (!['notify', 'reauthorize', 'convert_to_charge'].includes(s.deposit_expiry_policy)) errors.push({ field: 'deposit_expiry_policy', code: 'invalid', message: tr('settings.invalid_deposit_expiry_policy') });
  if (s.email_channel !== null && (typeof s.email_channel !== 'string' || !/^[a-z0-9-]{1,64}$/.test(s.email_channel))) errors.push({ field: 'email_channel', code: 'invalid', message: tr('settings.invalid_email_channel') });
  if (!Array.isArray(s.widget_origins) || s.widget_origins.length > 20) errors.push({ field: 'widget_origins', code: 'invalid', message: tr('settings.invalid_widget_origin') });
  else s.widget_origins.forEach((o, i) => {
    if (typeof o !== 'string' || !/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(o)) errors.push({ field: `widget_origins.${i}`, code: 'invalid', message: tr('settings.invalid_widget_origin') });
  });
  const sf = s.storefront;
  if (!Array.isArray(sf.locales) || !sf.locales.length || !sf.locales.every(isLocale)) errors.push({ field: 'storefront.locales', code: 'invalid', message: tr('settings.invalid_locales') });
  else if (!(sf.locales as string[]).includes(sf.default_locale)) errors.push({ field: 'storefront.default_locale', code: 'not_enabled', message: tr('settings.default_locale_not_enabled') });
  for (const l of Object.keys(s.terms.translations ?? {})) if (!isLocale(l)) errors.push({ field: `terms.translations.${l}`, code: 'invalid', message: tr('settings.invalid_locales') });
  if (errors.length) throw invalid(tr('settings.invalid'), errors);
}

export async function updateSettings(ctx: Ctx, patch: Record<string, unknown>): Promise<TenantSettings> {
  const t = await getTenant(ctx);
  const merged = deepMerge(t.settings ?? {}, patch);
  validateSettings(resolveSettings(merged));
  // The shop's own language (emails, documents, staff messages) follows the storefront default.
  const resolved = resolveSettings(merged);
  await exec(ctx, `UPDATE tenants SET settings = $2, locale = $3 WHERE id = $1`, [ctx.tenantId, json(merged), resolved.storefront.default_locale]);
  await audit(ctx, { entity_type: 'tenant_settings', entity_id: ctx.tenantId, action: 'update', before: t.settings, after: merged });
  return resolved;
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/** Open locations; with `archived`, the archived ones follow (they can be restored). */
export async function listLocations(ctx: Ctx, opts: { archived?: boolean } = {}) {
  return many(ctx, `SELECT * FROM locations WHERE $1 OR deleted_at IS NULL ORDER BY deleted_at IS NOT NULL, is_default DESC, name`, [!!opts.archived]);
}

export async function getLocation(ctx: Ctx, id?: string | null) {
  if (id) return must(ctx, `SELECT * FROM locations WHERE id = $1 AND deleted_at IS NULL`, [id], 'location', id);
  const def = await one(ctx, `SELECT * FROM locations WHERE deleted_at IS NULL ORDER BY is_default DESC, created_at LIMIT 1`);
  if (!def) throw new AppError('no_location', 409, msg('error.create_a_location_first'));
  return def;
}

const LOCATION_COLS = { name: {}, address: { json: true }, timezone: {}, opening_hours: { json: true }, is_default: {}, phone: {}, email: {}, tax_ids: { json: true }, tax_profile_id: {} };

/** Field-by-field checks for a location's time zone, email and tax profile. */
async function checkLocation(ctx: Ctx, input: Record<string, any>) {
  const errors: FieldError[] = [];
  if (input.timezone != null && !isValidTimeZone(input.timezone)) errors.push({ field: 'timezone', code: 'invalid', message: msg('error.field.unknown_iana_time_zone') });
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) errors.push({ field: 'email', code: 'invalid', message: msg('error.field.invalid_email') });
  if (input.tax_profile_id && !(await one(ctx, `SELECT 1 FROM tax_profiles WHERE id = $1 AND deleted_at IS NULL`, [input.tax_profile_id])))
    errors.push({ field: 'tax_profile_id', code: 'not_found', message: msg('error.field.unknown_tax_profile') });
  if (errors.length) throw invalid(msg('error.check_the_location'), errors);
}

/** Empty contact fields are stored as null. */
function cleanLocation<T extends Record<string, any>>(input: T): T {
  const out: Record<string, any> = { ...input };
  for (const k of ['phone', 'email', 'tax_profile_id']) if (k in out) out[k] = typeof out[k] === 'string' && out[k].trim() ? out[k].trim() : null;
  if ('tax_ids' in out) out.tax_ids = (out.tax_ids ?? []).filter((x: any) => x && String(x.value ?? '').trim());
  return out as T;
}

export async function createLocation(ctx: Ctx, raw: Record<string, any>) {
  const tenant = await getTenant(ctx);
  const input = cleanLocation(raw);
  const tz = input.timezone ?? tenant.timezone;
  await checkLocation(ctx, { ...input, timezone: tz });
  const first = !(await one(ctx, `SELECT 1 FROM locations WHERE deleted_at IS NULL`));
  const isDefault = first || !!input.is_default;
  if (isDefault) await exec(ctx, `UPDATE locations SET is_default = false WHERE is_default`);
  const row = (
    await many(
      ctx,
      `INSERT INTO locations (id, tenant_id, name, address, timezone, opening_hours, is_default, phone, email, tax_ids, tax_profile_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [newId('loc'), ctx.tenantId, input.name, json(input.address ?? {}), tz, json(input.opening_hours ?? DEFAULT_OPENING_HOURS), isDefault, input.phone ?? null, input.email ?? null, json(input.tax_ids ?? []), input.tax_profile_id ?? null],
    )
  )[0];
  await audit(ctx, { entity_type: 'location', entity_id: row.id, action: 'create', after: row });
  return row;
}

export async function updateLocation(ctx: Ctx, id: string, raw: Record<string, any>) {
  const before = await getLocation(ctx, id);
  const patch = cleanLocation(raw);
  await checkLocation(ctx, patch);
  if (patch.is_default) await exec(ctx, `UPDATE locations SET is_default = false WHERE is_default AND id <> $1`, [id]);
  const q = updateSql('locations', id, patch, LOCATION_COLS);
  if (!q) return before;
  const after = (await many(ctx, q.text, q.values))[0];
  await audit(ctx, { entity_type: 'location', entity_id: id, action: 'update', before, after });
  return after;
}

/** Archives a location. Its history stays; open orders and stock must move first, and one location always remains. */
export async function deleteLocation(ctx: Ctx, id: string) {
  const before = await getLocation(ctx, id);
  const others = await many<{ id: string }>(ctx, `SELECT id FROM locations WHERE deleted_at IS NULL AND id <> $1 ORDER BY created_at`, [id]);
  if (!others.length) throw new AppError('last_location', 409, msg('error.a_shop_needs_at_least_one_location'));
  const used = await one(ctx, `SELECT 1 FROM orders WHERE location_id = $1 AND status NOT IN ('closed','cancelled','expired') LIMIT 1`, [id]);
  if (used) throw new AppError('location_in_use', 409, msg('error.this_location_has_open_orders'));
  const moving = await one(ctx, `SELECT 1 FROM transfers WHERE status IN ('planned','in_transit') AND $1 IN (from_location_id, to_location_id) LIMIT 1`, [id]);
  if (moving) throw new AppError('location_has_transfers', 409, msg('error.location_has_open_transfers'));
  const stock = await one(
    ctx,
    `SELECT 1 FROM stock_items WHERE location_id = $1 AND status NOT IN ('retired','lost')
     UNION ALL SELECT 1 FROM stock_levels WHERE location_id = $1 AND quantity > 0 LIMIT 1`,
    [id],
  );
  if (stock) throw new AppError('location_has_stock', 409, msg('error.move_the_stock_before_archiving_this_location'));
  await exec(ctx, `UPDATE locations SET deleted_at = now(), is_default = false WHERE id = $1`, [id]);
  // Another location takes over as the default.
  if (before.is_default) await exec(ctx, `UPDATE locations SET is_default = true WHERE id = $1`, [others[0]!.id]);
  await audit(ctx, { entity_type: 'location', entity_id: id, action: 'delete', before });
}

/** Brings an archived location back. It does not become the default. */
export async function restoreLocation(ctx: Ctx, id: string) {
  const before = await must<any>(ctx, `SELECT * FROM locations WHERE id = $1`, [id], 'location', id);
  if (!before.deleted_at) return before;
  const after = (await many(ctx, `UPDATE locations SET deleted_at = NULL WHERE id = $1 RETURNING *`, [id]))[0];
  await audit(ctx, { entity_type: 'location', entity_id: id, action: 'restore', before, after });
  return after;
}

export async function addBlackout(ctx: Ctx, locationId: string, input: { starts_at: string; ends_at: string; reason?: string }) {
  await getLocation(ctx, locationId);
  const row = (
    await many(
      ctx,
      `INSERT INTO location_blackouts (id, tenant_id, location_id, period, reason)
       VALUES ($1, $2, $3, tstzrange($4, $5, '[)'), $6) RETURNING id, location_id, lower(period) AS starts_at, upper(period) AS ends_at, reason`,
      [newId('blk'), ctx.tenantId, locationId, input.starts_at, input.ends_at, input.reason ?? null],
    )
  )[0];
  await audit(ctx, { entity_type: 'location_blackout', entity_id: row.id, action: 'create', after: row });
  return row;
}

export async function listBlackouts(ctx: Ctx, locationId: string) {
  return many(
    ctx,
    `SELECT id, location_id, lower(period) AS starts_at, upper(period) AS ends_at, reason
       FROM location_blackouts WHERE location_id = $1 AND upper(period) > now() ORDER BY lower(period)`,
    [locationId],
  );
}

export async function deleteBlackout(ctx: Ctx, id: string) {
  const n = await exec(ctx, `DELETE FROM location_blackouts WHERE id = $1`, [id]);
  if (!n) throw new AppError('not_found', 404, msg('error.blackout_not_found'));
  await audit(ctx, { entity_type: 'location_blackout', entity_id: id, action: 'delete' });
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export function apiKeyToApi(k: any) {
  return { id: k.id, object: 'api_key', name: k.name, kind: k.kind, prefix: k.prefix, scopes: k.scopes, last_used_at: k.last_used_at, revoked_at: k.revoked_at, created_at: k.created_at };
}

export async function listApiKeys(ctx: Ctx) {
  return (await many(ctx, `SELECT * FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC`)).map(apiKeyToApi);
}

export async function createApiKey(ctx: Ctx, input: { name: string; kind: 'secret' | 'publishable'; scopes?: string[] }) {
  const gen = generateApiKey(input.kind, ctx.config.livemode);
  const scopes = input.kind === 'publishable' ? ['storefront'] : input.scopes?.length ? input.scopes : ['*'];
  const row = (
    await many(
      ctx,
      `INSERT INTO api_keys (id, tenant_id, name, kind, key_hash, prefix, scopes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [newId('key'), ctx.tenantId, input.name, input.kind, gen.hash, gen.prefix, scopes, ctx.actor.id],
    )
  )[0];
  await audit(ctx, { entity_type: 'api_key', entity_id: row.id, action: 'create', after: row });
  return { ...apiKeyToApi(row), key: gen.key };
}

export async function revokeApiKey(ctx: Ctx, id: string) {
  const n = await exec(ctx, `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [id]);
  if (!n) throw new AppError('not_found', 404, msg('error.api_key_not_found'));
  await audit(ctx, { entity_type: 'api_key', entity_id: id, action: 'revoke' });
}

export async function rotateApiKey(ctx: Ctx, id: string) {
  const old = await must(ctx, `SELECT * FROM api_keys WHERE id = $1 AND revoked_at IS NULL`, [id], 'api_key', id);
  await revokeApiKey(ctx, id);
  return createApiKey(ctx, { name: old.name, kind: old.kind, scopes: old.scopes });
}

// ---------------------------------------------------------------------------
// Users (members of this tenant)
// ---------------------------------------------------------------------------

export function userToApi(u: any) {
  return {
    id: u.id, object: 'user', email: u.email, name: u.name, locale: u.locale, role: u.role, role_id: u.role_id ?? null, role_name: u.role_name ?? null,
    status: u.disabled_at ? 'disabled' : u.status, has_password: !!u.password_hash, totp_enabled: !!u.totp_secret, created_at: u.created_at,
  };
}

const MEMBER = `SELECT u.*, m.role, m.role_id, m.disabled_at, r.name AS role_name FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN roles r ON r.id = m.role_id`;

export async function listUsers(ctx: Ctx) {
  return (await many(ctx, `${MEMBER} ORDER BY u.created_at`)).map(userToApi);
}

export async function getUser(ctx: Ctx, id: string) {
  return userToApi(await must(ctx, `${MEMBER} WHERE u.id = $1`, [id], 'user', id));
}

/** At least one owner who can still sign in must remain. */
async function keepAnOwner(ctx: Ctx, userId: string) {
  const owners = await one<{ n: number }>(ctx, `SELECT count(*)::int AS n FROM memberships WHERE role = 'owner' AND disabled_at IS NULL AND user_id <> $1`, [userId]);
  if (!owners?.n) throw new AppError('last_owner', 409, msg('error.a_tenant_needs_at_least_one_owner'));
}

/** `role` is a system role key or the id of one of the shop's own roles. */
export async function inviteUser(ctx: Ctx, input: { email: string; name?: string; role: string; password?: string }) {
  if (input.role === 'owner' && ctx.actor.role !== 'owner' && ctx.actor.type !== 'system') {
    throw new AppError('forbidden', 403, msg('error.only_an_owner_can_add_another_owner'));
  }
  const { resolveRole } = await import('../roles/index.ts');
  const role = await resolveRole(ctx, input.role);
  let user = await one(ctx, `SELECT * FROM users WHERE lower(email) = lower($1)`, [input.email]);
  if (!user) {
    user = (
      await many(
        ctx,
        `INSERT INTO users (id, email, name, password_hash, status) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [newId('usr'), input.email, input.name ?? '', input.password ? await hashPassword(input.password) : null, 'active'],
      )
    )[0];
  }
  await exec(
    ctx,
    `INSERT INTO memberships (id, tenant_id, user_id, role, role_id) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role, role_id = EXCLUDED.role_id, disabled_at = NULL`,
    [newId('mem'), ctx.tenantId, user.id, role.role, role.role_id],
  );
  await audit(ctx, { entity_type: 'user', entity_id: user.id, action: 'invite', after: { email: user.email, role: input.role } });
  return getUser(ctx, user.id);
}

export async function updateMember(ctx: Ctx, userId: string, patch: { role?: string; name?: string; locale?: string }) {
  const before = await getUser(ctx, userId);
  if (patch.role) {
    if (patch.role === 'owner' && ctx.actor.role !== 'owner' && ctx.actor.type !== 'system') throw new AppError('forbidden', 403, msg('error.only_an_owner_can_add_another_owner'));
    if (before.role === 'owner' && patch.role !== 'owner') await keepAnOwner(ctx, userId);
    const { resolveRole } = await import('../roles/index.ts');
    const role = await resolveRole(ctx, patch.role);
    await exec(ctx, `UPDATE memberships SET role = $2, role_id = $3 WHERE user_id = $1`, [userId, role.role, role.role_id]);
  }
  if (patch.name !== undefined || patch.locale !== undefined) {
    await exec(ctx, `UPDATE users SET name = coalesce($2, name), locale = coalesce($3, locale) WHERE id = $1`, [userId, patch.name ?? null, patch.locale ?? null]);
  }
  const after = await getUser(ctx, userId);
  await audit(ctx, { entity_type: 'user', entity_id: userId, action: 'update', before, after });
  return after;
}

export async function removeMember(ctx: Ctx, userId: string) {
  const u = await getUser(ctx, userId);
  if (u.role === 'owner') await keepAnOwner(ctx, userId);
  await exec(ctx, `DELETE FROM memberships WHERE user_id = $1`, [userId]);
  await exec(ctx, `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND tenant_id = $2`, [userId, ctx.tenantId]);
  await audit(ctx, { entity_type: 'user', entity_id: userId, action: 'remove', before: u });
}

/** The member can no longer use this shop (other shops are not affected); their sessions here end. */
export async function disableMember(ctx: Ctx, userId: string) {
  const u = await getUser(ctx, userId);
  if (ctx.actor.id === userId) throw new AppError('cannot_disable_self', 409, msg('error.cannot_disable_yourself'));
  if (u.role === 'owner') await keepAnOwner(ctx, userId);
  await exec(ctx, `UPDATE memberships SET disabled_at = coalesce(disabled_at, now()) WHERE user_id = $1`, [userId]);
  await exec(ctx, `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND tenant_id = $2 AND revoked_at IS NULL`, [userId, ctx.tenantId]);
  await audit(ctx, { entity_type: 'user', entity_id: userId, action: 'disable', before: u });
  return getUser(ctx, userId);
}

export async function enableMember(ctx: Ctx, userId: string) {
  const u = await getUser(ctx, userId);
  await exec(ctx, `UPDATE memberships SET disabled_at = NULL WHERE user_id = $1`, [userId]);
  await audit(ctx, { entity_type: 'user', entity_id: userId, action: 'enable', before: u });
  return getUser(ctx, userId);
}

/** Invitations last three days; a reset link the usual 15 minutes would be too short to find in a mailbox. */
const INVITE_MINUTES = 72 * 60;

/**
 * Emails a member a one-time sign-in link: an invitation, or after a reset (the old password stops
 * working and their sessions end). Once signed in they set a new password from their profile.
 */
export async function sendAccessLink(ctx: Ctx, userId: string, kind: 'invite' | 'reset_password') {
  const u = await getUser(ctx, userId);
  if (u.status === 'disabled') throw new AppError('member_disabled', 409, msg('error.member_disabled'));
  if (kind === 'reset_password') {
    await exec(ctx, `UPDATE users SET password_hash = NULL WHERE id = $1`, [userId]);
    await exec(ctx, `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  }
  const { createLoginToken } = await import('../auth/index.ts');
  const link = await createLoginToken(ctx.db, u.email, INVITE_MINUTES);
  if (!link) throw new AppError('member_disabled', 409, msg('error.member_disabled'));
  const tenant = await getTenant(ctx);
  const { queue } = await import('../notifications/index.ts');
  await queue(ctx, {
    template: kind === 'invite' ? 'staff_invitation' : 'staff_password_reset', to: u.email, audience: 'staff',
    data: { link: `${ctx.config.adminUrl}/login?magic=${encodeURIComponent(link.token)}`, shop: tenant.name, name: u.name || u.email },
  });
  await audit(ctx, { entity_type: 'user', entity_id: userId, action: kind });
  return { object: 'result', sent_to: u.email };
}

// ---------------------------------------------------------------------------
// First-run setup (PRD §10.3): runs in system mode before any tenant exists.
// ---------------------------------------------------------------------------

export interface SetupInput {
  owner: { email: string; password: string; name: string };
  tenant: { name: string; slug?: string; currency: string; timezone: string; locale?: string };
  location: { name: string; address?: Record<string, unknown> };
  tax?: { name: string; rate_bp: number };
}

export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'shop';
}

export async function isSetupComplete(db: Queryable): Promise<boolean> {
  const r = await db.query(`SELECT 1 FROM tenants LIMIT 1`);
  return r.rows.length > 0;
}

/**
 * Creates tenant, owner, first location, a default tax profile, a default price structure and a
 * publishable key for the storefront. `db` must be a system-mode transaction.
 */
export async function runSetup(db: Queryable, input: SetupInput, opts: { livemode: boolean }) {
  if (!isValidTimeZone(input.tenant.timezone)) throw invalid(msg('error.unknown_time_zone'));
  if (!/^[A-Z]{3}$/.test(input.tenant.currency)) throw invalid(msg('error.currency_must_be_an_iso_4217_code'));
  if (input.owner.password.length < 8) throw invalid(msg('error.password_must_be_at_least_8_characters'), [{ field: 'owner.password', code: 'too_short', message: msg('error.field.use_at_least_8_characters') }]);
  const tenantId = newId('ten');
  const slug = slugify(input.tenant.slug ?? input.tenant.name);
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
  await db.query(
    `INSERT INTO tenants (id, slug, name, legal_name, currency, timezone, locale) VALUES ($1, $2, $3, $3, $4, $5, $6)`,
    [tenantId, slug, input.tenant.name, input.tenant.currency, input.tenant.timezone, input.tenant.locale ?? 'en'],
  );
  let user = (await db.query(`SELECT * FROM users WHERE lower(email) = lower($1)`, [input.owner.email])).rows[0];
  if (!user) {
    user = (
      await db.query(`INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4) RETURNING *`, [
        newId('usr'), input.owner.email, input.owner.name, await hashPassword(input.owner.password),
      ])
    ).rows[0];
  }
  await db.query(`INSERT INTO memberships (id, tenant_id, user_id, role) VALUES ($1, $2, $3, 'owner')`, [newId('mem'), tenantId, user.id]);
  const locationId = newId('loc');
  await db.query(
    `INSERT INTO locations (id, tenant_id, name, address, timezone, opening_hours, is_default) VALUES ($1,$2,$3,$4,$5,$6,true)`,
    [locationId, tenantId, input.location.name, json(input.location.address ?? {}), input.tenant.timezone, json(DEFAULT_OPENING_HOURS)],
  );
  const tax = input.tax ?? { name: 'VAT', rate_bp: 2000 };
  await db.query(
    `INSERT INTO tax_profiles (id, tenant_id, name, rates, is_default) VALUES ($1, $2, $3, $4, true)`,
    [newId('tax'), tenantId, `${tax.name} ${tax.rate_bp / 100}%`, json([{ name: tax.name, rate_bp: tax.rate_bp }])],
  );
  const pk = generateApiKey('publishable', opts.livemode);
  await db.query(
    `INSERT INTO api_keys (id, tenant_id, name, kind, key_hash, prefix, scopes) VALUES ($1,$2,'Storefront','publishable',$3,$4,'{storefront}')`,
    [newId('key'), tenantId, pk.hash, pk.prefix],
  );
  await db.query(
    `INSERT INTO audit_log (id, tenant_id, actor_type, actor_id, entity_type, entity_id, action, diff) VALUES ($1,$2,'system',$3,'tenant',$2,'setup','{}')`,
    [newId('aud'), tenantId, user.id],
  );
  return { tenantId, userId: user.id, locationId, slug, publishableKey: pk.key };
}

export async function storefrontKeyFor(db: Queryable, tenantId: string): Promise<{ id: string; hash: string } | null> {
  const r = await db.query(`SELECT id, key_hash FROM api_keys WHERE tenant_id = $1 AND kind = 'publishable' AND revoked_at IS NULL ORDER BY created_at LIMIT 1`, [tenantId]);
  return r.rows[0] ? { id: r.rows[0].id, hash: r.rows[0].key_hash } : null;
}

export async function tenantBySlug(db: Queryable, slug: string) {
  const r = await db.query(`SELECT id, slug, name FROM tenants WHERE slug = $1`, [slug]);
  return r.rows[0] ?? null;
}

export const hashKey = sha256;

export async function emitTenantEvent(ctx: Ctx, type: string, object: unknown) {
  return emit(ctx, type, { type: 'tenant', id: ctx.tenantId }, object);
}
