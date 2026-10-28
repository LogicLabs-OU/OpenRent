import type { Ctx } from '../context.ts';
import { AppError, invalid, type FieldError } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { t } from '../i18n/index.ts';
import { newId } from '../ids.ts';
import { exec, json, many, one } from '../sql.ts';
import { checkTaxId } from './tax-id.ts';
import type { Address } from './index.ts';

/**
 * Billing details and delivery addresses a customer keeps for checkout (ADR 0012). Each belongs to one
 * customer; the first one saved is the default, and deleting the default makes the oldest left the default.
 */
export interface BillingProfileInput {
  kind?: 'private' | 'company';
  name?: string;
  company_name?: string | null;
  tax_id?: string | null;
  address?: Address | null;
  /** E-invoices for these details (FR-DOC-6): a format a plugin offers, and the Peppol ID when it needs one. */
  einvoice?: { format: string; endpoint?: string | null } | null;
  is_default?: boolean;
}
export interface AddressInput {
  label?: string | null;
  recipient?: string | null;
  phone?: string | null;
  address?: Address | null;
  is_default?: boolean;
}

/** What an order keeps of the billing details chosen (`orders.billing`). */
export interface BillingSnapshot {
  kind: 'private' | 'company';
  name: string;
  company_name: string | null;
  tax_id: string | null;
  tax_id_check: unknown;
  address: Address;
  einvoice?: { format: string; endpoint: string | null } | null;
}

const ADDRESS_KEYS = ['line1', 'line2', 'postal_code', 'city', 'region', 'country'] as const;

/** Only the known address fields, trimmed; the country as an upper-case code. */
export function cleanAddress(a: Address | null | undefined): Address {
  const out: Record<string, string> = {};
  for (const k of ADDRESS_KEYS) {
    const v = typeof a?.[k] === 'string' ? a[k]!.trim().slice(0, 200) : '';
    if (v) out[k] = k === 'country' ? v.toUpperCase() : v;
  }
  return out;
}

export function profileToApi(r: any) {
  return {
    id: r.id, object: 'billing_profile', customer_id: r.customer_id, kind: r.kind, name: r.name, company_name: r.company_name, tax_id: r.tax_id,
    tax_id_check: r.tax_id_check ?? null, address: r.address ?? {}, einvoice: r.einvoice ?? null, is_default: r.is_default, created_at: r.created_at, updated_at: r.updated_at,
  };
}

export function addressToApi(r: any) {
  return { id: r.id, object: 'customer_address', customer_id: r.customer_id, label: r.label, recipient: r.recipient, phone: r.phone, address: r.address ?? {}, is_default: r.is_default, created_at: r.created_at, updated_at: r.updated_at };
}

export function snapshotOf(p: { kind: string; name: string; company_name?: string | null; tax_id?: string | null; tax_id_check?: unknown; address?: Address | null; einvoice?: BillingSnapshot['einvoice'] }): BillingSnapshot {
  return {
    kind: p.kind === 'company' ? 'company' : 'private', name: p.name, company_name: p.company_name || null, tax_id: p.tax_id || null, tax_id_check: p.tax_id_check ?? null, address: cleanAddress(p.address),
    ...(p.einvoice ? { einvoice: p.einvoice } : {}),
  };
}

/** The e-invoice choice checked: a format a plugin this shop has on offers, with a Peppol ID where it needs one. */
async function checkedEInvoice(ctx: Ctx, input: BillingProfileInput['einvoice'], errors: FieldError[]): Promise<BillingSnapshot['einvoice']> {
  if (!input?.format) return null;
  const { einvoiceFormat } = await import('../documents/einvoice.ts');
  const f = await einvoiceFormat(ctx, input.format);
  if (!f) {
    errors.push({ field: 'einvoice.format', code: 'invalid', message: t('billing.field.einvoice_format') });
    return null;
  }
  const endpoint = input.endpoint?.trim() || null;
  if (f.endpoint && !endpoint) errors.push({ field: 'einvoice.endpoint', code: 'required', message: t('billing.field.einvoice_endpoint') });
  else if (endpoint && !/^\d{4}:[^\s:]{1,50}$/.test(endpoint)) errors.push({ field: 'einvoice.endpoint', code: 'invalid', message: t('billing.field.einvoice_endpoint') });
  return { format: input.format, endpoint };
}

export async function listProfiles(ctx: Ctx, customerId: string) {
  return (await many(ctx, `SELECT * FROM customer_billing_profiles WHERE customer_id = $1 ORDER BY is_default DESC, created_at`, [customerId])).map(profileToApi);
}

export async function listAddresses(ctx: Ctx, customerId: string) {
  return (await many(ctx, `SELECT * FROM customer_addresses WHERE customer_id = $1 ORDER BY is_default DESC, created_at`, [customerId])).map(addressToApi);
}

export async function getProfile(ctx: Ctx, customerId: string, id: string) {
  const r = await one(ctx, `SELECT * FROM customer_billing_profiles WHERE id = $1 AND customer_id = $2`, [id, customerId]);
  if (!r) throw new AppError('not_found', 404, t('billing.profile_not_found'));
  return profileToApi(r);
}

export async function getAddress(ctx: Ctx, customerId: string, id: string) {
  const r = await one(ctx, `SELECT * FROM customer_addresses WHERE id = $1 AND customer_id = $2`, [id, customerId]);
  if (!r) throw new AppError('not_found', 404, t('billing.address_not_found'));
  return addressToApi(r);
}

function checkAddress(a: Address, errors: FieldError[], prefix: string, required: boolean) {
  if (!required && !Object.keys(a).length) return;
  for (const k of ['line1', 'city', 'country'] as const) if (!a[k]) errors.push({ field: `${prefix}.${k}`, code: 'required', message: t(`billing.field.${k}_required`) });
  if (a.country && !/^[A-Z]{2}$/.test(a.country)) errors.push({ field: `${prefix}.country`, code: 'invalid', message: t('billing.field.country_invalid') });
}

/**
 * Billing details checked field by field: a company needs its name and an address for the invoice. A
 * tax number the register calls invalid is refused; one it cannot check now is kept as unchecked.
 * `previous` keeps the check of a number that did not change.
 */
export async function checkedBilling(ctx: Ctx, input: BillingProfileInput, previous?: any): Promise<BillingSnapshot> {
  const kind = input.kind ?? previous?.kind ?? 'private';
  const name = (input.name ?? previous?.name ?? '').trim().slice(0, 200);
  const company = kind === 'company' ? (input.company_name !== undefined ? input.company_name : previous?.company_name)?.trim().slice(0, 200) || null : null;
  const taxId = kind === 'company' ? (input.tax_id !== undefined ? input.tax_id : previous?.tax_id)?.replace(/\s+/g, '').toUpperCase().slice(0, 40) || null : null;
  const address = cleanAddress(input.address !== undefined ? input.address : previous?.address);
  const errors: FieldError[] = [];
  if (!['private', 'company'].includes(kind)) errors.push({ field: 'kind', code: 'invalid', message: t('billing.field.kind_invalid') });
  if (!name) errors.push({ field: 'name', code: 'required', message: t('billing.field.name_required') });
  if (kind === 'company' && !company) errors.push({ field: 'company_name', code: 'required', message: t('billing.field.company_required') });
  checkAddress(address, errors, 'address', kind === 'company');
  const einvoice = kind === 'company' ? await checkedEInvoice(ctx, input.einvoice !== undefined ? input.einvoice : previous?.einvoice, errors) : null;
  if (errors.length) throw invalid(t('billing.invalid'), errors);
  let check = previous && previous.tax_id === taxId ? previous.tax_id_check : null;
  if (taxId && !check) {
    check = await checkTaxId(ctx, taxId);
    if (check?.status === 'invalid') throw invalid(t('billing.invalid'), [{ field: 'tax_id', code: 'invalid', message: t('checkout.tax_id_invalid') }]);
  }
  return { kind: kind as BillingSnapshot['kind'], name, company_name: company, tax_id: taxId, tax_id_check: check ?? null, address, ...(einvoice ? { einvoice } : {}) };
}

/** Saves billing details for checkout (see `checkedBilling`). */
export async function saveProfile(ctx: Ctx, customerId: string, input: BillingProfileInput, id?: string) {
  const before = id ? await one<any>(ctx, `SELECT * FROM customer_billing_profiles WHERE id = $1 AND customer_id = $2 FOR UPDATE`, [id, customerId]) : null;
  if (id && !before) throw new AppError('not_found', 404, t('billing.profile_not_found'));
  const b = await checkedBilling(ctx, input, before);
  const count = Number((await one<{ n: string }>(ctx, `SELECT count(*) AS n FROM customer_billing_profiles WHERE customer_id = $1`, [customerId]))!.n);
  if (!before && count >= 20) throw invalid(t('billing.too_many'), [{ field: 'name', code: 'too_many', message: t('billing.too_many') }]);
  const makeDefault = input.is_default === true || (!before && count === 0) || (before?.is_default && input.is_default !== false);
  if (makeDefault) await exec(ctx, `UPDATE customer_billing_profiles SET is_default = false WHERE customer_id = $1 AND is_default AND id IS DISTINCT FROM $2`, [customerId, id ?? null]);
  const vals = [b.kind, b.name, b.company_name, b.tax_id, json(b.tax_id_check), json(b.address), !!makeDefault, b.einvoice ? json(b.einvoice) : null];
  const row = before
    ? (await many(ctx, `UPDATE customer_billing_profiles SET kind = $3, name = $4, company_name = $5, tax_id = $6, tax_id_check = $7, address = $8, is_default = $9, einvoice = $10 WHERE id = $1 AND customer_id = $2 RETURNING *`, [id, customerId, ...vals]))[0]
    : (await many(ctx, `INSERT INTO customer_billing_profiles (id, tenant_id, customer_id, kind, name, company_name, tax_id, tax_id_check, address, is_default, einvoice) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [newId('bpr'), ctx.tenantId, customerId, ...vals]))[0];
  const api = profileToApi(row);
  await audit(ctx, { entity_type: 'customer', entity_id: customerId, action: before ? 'update_billing_profile' : 'add_billing_profile', before: before ?? null, after: row, extra: { billing_profile_id: row.id } });
  await emit(ctx, before ? 'billing_profile.updated' : 'billing_profile.created', { type: 'customer', id: customerId }, api);
  return api;
}

export async function deleteProfile(ctx: Ctx, customerId: string, id: string) {
  const r = await one<any>(ctx, `DELETE FROM customer_billing_profiles WHERE id = $1 AND customer_id = $2 RETURNING *`, [id, customerId]);
  if (!r) throw new AppError('not_found', 404, t('billing.profile_not_found'));
  if (r.is_default) await exec(ctx, `UPDATE customer_billing_profiles SET is_default = true WHERE id = (SELECT id FROM customer_billing_profiles WHERE customer_id = $1 ORDER BY created_at LIMIT 1)`, [customerId]);
  await audit(ctx, { entity_type: 'customer', entity_id: customerId, action: 'delete_billing_profile', before: r, extra: { billing_profile_id: id } });
  await emit(ctx, 'billing_profile.deleted', { type: 'customer', id: customerId }, { id, object: 'billing_profile', deleted: true });
}

export async function saveAddress(ctx: Ctx, customerId: string, input: AddressInput, id?: string) {
  const before = id ? await one<any>(ctx, `SELECT * FROM customer_addresses WHERE id = $1 AND customer_id = $2 FOR UPDATE`, [id, customerId]) : null;
  if (id && !before) throw new AppError('not_found', 404, t('billing.address_not_found'));
  const text = (v: string | null | undefined, old: string | null | undefined, max: number) => ((v !== undefined ? v : old) ?? '').trim().slice(0, max) || null;
  const label = text(input.label, before?.label, 80);
  const recipient = text(input.recipient, before?.recipient, 200);
  const phone = text(input.phone, before?.phone, 40);
  const address = cleanAddress(input.address !== undefined ? input.address : before?.address);
  const errors: FieldError[] = [];
  checkAddress(address, errors, 'address', true);
  if (errors.length) throw invalid(t('billing.invalid'), errors);
  const count = Number((await one<{ n: string }>(ctx, `SELECT count(*) AS n FROM customer_addresses WHERE customer_id = $1`, [customerId]))!.n);
  if (!before && count >= 20) throw invalid(t('billing.too_many'), [{ field: 'address.line1', code: 'too_many', message: t('billing.too_many') }]);
  const makeDefault = input.is_default === true || (!before && count === 0) || (before?.is_default && input.is_default !== false);
  if (makeDefault) await exec(ctx, `UPDATE customer_addresses SET is_default = false WHERE customer_id = $1 AND is_default AND id IS DISTINCT FROM $2`, [customerId, id ?? null]);
  const row = before
    ? (await many(ctx, `UPDATE customer_addresses SET label = $3, recipient = $4, phone = $5, address = $6, is_default = $7 WHERE id = $1 AND customer_id = $2 RETURNING *`, [id, customerId, label, recipient, phone, json(address), !!makeDefault]))[0]
    : (await many(ctx, `INSERT INTO customer_addresses (id, tenant_id, customer_id, label, recipient, phone, address, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [newId('cad'), ctx.tenantId, customerId, label, recipient, phone, json(address), !!makeDefault]))[0];
  const api = addressToApi(row);
  await audit(ctx, { entity_type: 'customer', entity_id: customerId, action: before ? 'update_address' : 'add_address', before: before ?? null, after: row, extra: { address_id: row.id } });
  await emit(ctx, before ? 'customer_address.updated' : 'customer_address.created', { type: 'customer', id: customerId }, api);
  return api;
}

export async function deleteAddress(ctx: Ctx, customerId: string, id: string) {
  const r = await one<any>(ctx, `DELETE FROM customer_addresses WHERE id = $1 AND customer_id = $2 RETURNING *`, [id, customerId]);
  if (!r) throw new AppError('not_found', 404, t('billing.address_not_found'));
  if (r.is_default) await exec(ctx, `UPDATE customer_addresses SET is_default = true WHERE id = (SELECT id FROM customer_addresses WHERE customer_id = $1 ORDER BY created_at LIMIT 1)`, [customerId]);
  await audit(ctx, { entity_type: 'customer', entity_id: customerId, action: 'delete_address', before: r, extra: { address_id: id } });
  await emit(ctx, 'customer_address.deleted', { type: 'customer', id: customerId }, { id, object: 'customer_address', deleted: true });
}
