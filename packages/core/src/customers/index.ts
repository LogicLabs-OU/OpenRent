import { t as msg } from '../i18n/index.ts';
import { validateCustomFields } from '../customfields/index.ts';
import type { Ctx } from '../context.ts';
import { AppError, invalid } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId } from '../ids.ts';
import { allPages, exec, json, listPage, many, must, one, updateSql, type ListParams } from '../sql.ts';
import { t } from '../i18n/index.ts';
import { tenantLocale } from '../i18n/context.ts';
import { removeCustomerAttachments } from '../attachments/index.ts';
import { checkTaxId } from './tax-id.ts';
import { b2bColumns, b2bToApi, openBalance, openBalances } from './b2b.ts';

export { openBalance, accountTermsFor } from './b2b.ts';
export { invoiceNow, consolidateMonthly } from './billing.ts';
export { listProfiles, listAddresses, getProfile, getAddress, saveProfile, saveAddress, deleteProfile, deleteAddress, snapshotOf, checkedBilling, cleanAddress, profileToApi, addressToApi, type BillingProfileInput, type AddressInput, type BillingSnapshot } from './profiles.ts';

export interface CustomerFlags {
  blocked?: boolean;
  deposit_waived?: boolean;
  requires_id_check?: boolean;
  /** Set by staff or an identity plugin once the customer's ID was checked (pickup waits for it). */
  id_verified?: boolean;
}

export function customerToApi(c: any) {
  return {
    id: c.id, object: 'customer', type: c.type, name: c.name, email: c.email, phone: c.phone, company_name: c.company_name, tax_id: c.tax_id, tax_id_check: c.tax_id_check ?? null,
    addresses: c.addresses, locale: c.locale, tags: c.tags, flags: { blocked: false, deposit_waived: false, requires_id_check: false, id_verified: false, ...c.flags },
    marketing_consent: c.marketing_consent, sms_opt_in: !!c.sms_opt_in, whatsapp_opt_in: !!c.whatsapp_opt_in, notes: c.notes, custom_fields: c.custom_fields, merged_into_id: c.merged_into_id,
    b2b: b2bToApi(c), open_balance: c.open_balance ?? undefined,
    anonymized_at: c.anonymized_at, stats: c.stats ?? undefined, created_at: c.created_at, updated_at: c.updated_at,
  };
}

const COLS = {
  type: {}, name: {}, email: {}, phone: {}, company_name: {}, tax_id: {}, tax_id_check: { json: true }, addresses: { json: true }, locale: {}, tags: {},
  flags: { json: true }, marketing_consent: {}, sms_opt_in: {}, whatsapp_opt_in: {}, notes: {}, custom_fields: { json: true },
  on_account: {}, payment_terms_days: {}, credit_limit: {}, po_required: {}, invoice_schedule: {},
};

export const normalizeEmail = (e?: string | null) => (e ? e.trim().toLowerCase() : null);
export const normalizePhone = (p?: string | null) => (p ? p.replace(/[^\d+]/g, '') : null);

export async function getCustomerRow(ctx: Ctx, id: string) {
  return must(ctx, `SELECT * FROM customers WHERE id = $1 AND deleted_at IS NULL`, [id], 'customer', id);
}

export async function getCustomer(ctx: Ctx, id: string) {
  const c = await getCustomerRow(ctx, id);
  const stats = await one(
    ctx,
    `SELECT count(*)::int AS orders,
            coalesce(sum((totals->>'total')::bigint) FILTER (WHERE status NOT IN ('cancelled','expired','draft','quote')), 0)::bigint AS lifetime_value,
            max(starts_at) AS last_rental_at
       FROM orders WHERE customer_id = $1`,
    [id],
  );
  const damage = await one(ctx, `SELECT count(*)::int AS n FROM damage_charges d JOIN orders o ON o.id = d.order_id WHERE o.customer_id = $1`, [id]);
  return customerToApi({ ...c, open_balance: await openBalance(ctx, id), stats: { ...stats, lifetime_value: Number(stats?.lifetime_value ?? 0), damage_incidents: damage?.n ?? 0 } });
}

export async function listCustomers(ctx: Ctx, p: ListParams) {
  const page = await listPage<any>(
    ctx,
    {
      table: 'customers',
      filters: { type: 'type', email: 'lower(email)', tag: "array_to_string(tags, ',')", blocked: "coalesce(flags->>'blocked','false')" },
      sorts: { name: 'name', created_at: 'created_at' },
      defaultSort: 'name',
      search: ['name', 'email', 'phone', 'company_name'],
      baseWhere: 'deleted_at IS NULL AND merged_into_id IS NULL',
    },
    p,
  );
  const owed = await openBalances(ctx, page.data.map((c) => c.id));
  return { ...page, data: page.data.map((c) => customerToApi({ ...c, open_balance: owed.get(c.id) ?? 0 })) };
}

/** The customer list as a spreadsheet, with the same filters and search as the list (FR-INT-2). */
export async function exportCustomers(ctx: Ctx, p: ListParams) {
  const rows = await allPages((q) => listCustomers(ctx, q), p);
  const address = (a: any) => (a && typeof a === 'object' ? ['line1', 'line2', 'postal_code', 'city', 'region', 'country'].map((k) => a[k]).filter(Boolean).join(', ') : '');
  return {
    headers: ['name', 'type', 'email', 'phone', 'company_name', 'tax_id', 'address', 'locale', 'tags', 'marketing_consent', 'blocked', 'created_at'],
    rows: rows.map((c) => [
      c.name ?? '', c.type, c.email ?? '', c.phone ?? '', c.company_name ?? '', c.tax_id ?? '', address(Array.isArray(c.addresses) ? c.addresses[0] : (c.addresses?.billing ?? c.addresses?.shipping ?? null)), c.locale ?? '',
      (c.tags ?? []).join(', '), c.marketing_consent ? 'true' : 'false', c.flags.blocked ? 'true' : 'false', c.created_at ? new Date(c.created_at).toISOString() : '',
    ]),
  };
}

/** FR-CUS-5: matches on normalised email or phone. */
export async function findDuplicates(ctx: Ctx, email?: string | null, phone?: string | null, excludeId?: string) {
  const e = normalizeEmail(email);
  const ph = normalizePhone(phone);
  if (!e && !ph) return [];
  const rows = await many(
    ctx,
    `SELECT * FROM customers WHERE deleted_at IS NULL AND merged_into_id IS NULL AND id IS DISTINCT FROM $3
        AND ((($1::text) IS NOT NULL AND lower(email) = $1) OR (($2::text) IS NOT NULL AND regexp_replace(coalesce(phone,''), '[^0-9+]', '', 'g') = $2))
      LIMIT 10`,
    [e, ph, excludeId ?? null],
  );
  return rows.map(customerToApi);
}

export async function createCustomer(ctx: Ctx, input: Record<string, any>) {
  if (!input.name?.trim()) throw invalid(msg('error.name_is_required'), [{ field: 'name', code: 'required', message: msg('error.field.enter_a_name') }]);
  input = { ...input, custom_fields: await validateCustomFields(ctx, 'customer', input.custom_fields) };
  const terms = b2bColumns(null, input.b2b ?? {});
  const duplicates = await findDuplicates(ctx, input.email, input.phone);
  const check = input.tax_id ? await checkTaxId(ctx, input.tax_id) : null;
  const row = (
    await many(
      ctx,
      `INSERT INTO customers (id, tenant_id, type, name, email, phone, company_name, tax_id, addresses, locale, tags, flags, marketing_consent, notes, custom_fields,
         on_account, payment_terms_days, credit_limit, po_required, invoice_schedule, sms_opt_in, whatsapp_opt_in, tax_id_check)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
      [
        newId('cus'), ctx.tenantId, input.type ?? 'person', input.name.trim(), normalizeEmail(input.email), input.phone ?? null, input.company_name ?? null,
        input.tax_id ?? null, json(input.addresses ?? {}), input.locale ?? null, input.tags ?? [], json(input.flags ?? {}), !!input.marketing_consent,
        input.notes ?? '', json(input.custom_fields ?? {}), terms.on_account, terms.payment_terms_days, terms.credit_limit, terms.po_required, terms.invoice_schedule,
        !!input.sms_opt_in, !!input.whatsapp_opt_in, check ? json(check) : null,
      ],
    )
  )[0];
  await audit(ctx, { entity_type: 'customer', entity_id: row.id, action: 'create', after: row });
  const api = customerToApi(row);
  await emit(ctx, 'customer.created', { type: 'customer', id: row.id }, api);
  return { ...api, possible_duplicates: duplicates };
}

/** Storefront checkout: reuse the customer with the same email, else create one. */
export interface Address {
  line1?: string;
  line2?: string;
  postal_code?: string;
  city?: string;
  region?: string;
  country?: string;
}

export interface CheckoutCustomer {
  name: string;
  email: string;
  phone?: string | null;
  locale?: string | null;
  marketing_consent?: boolean;
  /** Booking updates by text message or WhatsApp (FR-NOT-4). */
  sms_opt_in?: boolean;
  whatsapp_opt_in?: boolean;
  company_name?: string | null;
  tax_id?: string | null;
  billing_address?: Address | null;
}

/**
 * Details typed at checkout fill in what the customer record does not have yet; what staff or the
 * customer entered before stays. (The order keeps the billing details of this booking itself.)
 */
export async function fillFromCheckout(ctx: Ctx, existing: any, input: CheckoutCustomer) {
  const company = input.company_name?.trim() || null;
  const patch: Record<string, unknown> = {};
  if (input.phone && !existing.phone) patch.phone = input.phone;
  if (company && !existing.company_name) patch.company_name = company;
  if (input.tax_id && !existing.tax_id) patch.tax_id = input.tax_id;
  if (input.billing_address?.line1 && !existing.addresses?.billing?.line1) patch.addresses = { ...(existing.addresses ?? {}), billing: input.billing_address };
  if (input.locale && !existing.locale) patch.locale = input.locale;
  if (input.marketing_consent === true && !existing.marketing_consent) patch.marketing_consent = true;
  // Asking for texts at checkout means this number, today.
  for (const k of ['sms_opt_in', 'whatsapp_opt_in'] as const) if (input[k] === true && !existing[k]) patch[k] = true;
  if ((input.sms_opt_in || input.whatsapp_opt_in) && input.phone) patch.phone = input.phone;
  if (Object.keys(patch).length) await updateCustomer(ctx, existing.id, patch);
}

/** Storefront checkout: reuses the customer with this email, filling in details they did not have yet. */
export async function findOrCreateByEmail(ctx: Ctx, input: CheckoutCustomer) {
  const existing = await one(ctx, `SELECT * FROM customers WHERE lower(email) = $1 AND deleted_at IS NULL AND merged_into_id IS NULL ORDER BY created_at LIMIT 1`, [normalizeEmail(input.email)]);
  const company = input.company_name?.trim() || null;
  if (existing) {
    await fillFromCheckout(ctx, existing, input);
    return getCustomerRow(ctx, existing.id);
  }
  const { billing_address, ...rest } = input;
  const c = await createCustomer(ctx, { ...rest, company_name: company, type: company ? 'company' : 'person', addresses: billing_address?.line1 ? { billing: billing_address } : {} });
  return getCustomerRow(ctx, c.id);
}

// --- Contacts of company customers (FR-CUS-1) ------------------------------------

export function contactToApi(r: any) {
  return { id: r.id, object: 'customer_contact', customer_id: r.customer_id, name: r.name, email: r.email, phone: r.phone, role: r.role, is_primary: r.is_primary, created_at: r.created_at };
}

export async function listContacts(ctx: Ctx, customerId: string) {
  return (await many(ctx, `SELECT * FROM customer_contacts WHERE customer_id = $1 ORDER BY is_primary DESC, name`, [customerId])).map(contactToApi);
}

export async function saveContact(ctx: Ctx, customerId: string, input: { name: string; email?: string | null; phone?: string | null; role?: string | null; is_primary?: boolean }, id?: string) {
  await getCustomerRow(ctx, customerId);
  if (input.is_primary) await exec(ctx, `UPDATE customer_contacts SET is_primary = false WHERE customer_id = $1`, [customerId]);
  const vals = [input.name.trim(), normalizeEmail(input.email), input.phone?.trim() || null, input.role?.trim() || null, !!input.is_primary];
  const row = id
    ? (await many(ctx, `UPDATE customer_contacts SET name = $3, email = $4, phone = $5, role = $6, is_primary = $7 WHERE id = $1 AND customer_id = $2 RETURNING *`, [id, customerId, ...vals]))[0]
    : (await many(ctx, `INSERT INTO customer_contacts (id, tenant_id, customer_id, name, email, phone, role, is_primary) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [newId('cct'), ctx.tenantId, customerId, ...vals]))[0];
  if (!row) throw new AppError('not_found', 404, t('customers.contact_not_found'));
  await audit(ctx, { entity_type: 'customer', entity_id: customerId, action: id ? 'update_contact' : 'add_contact', extra: { contact_id: row.id } });
  return contactToApi(row);
}

export async function deleteContact(ctx: Ctx, customerId: string, id: string) {
  const n = await exec(ctx, `DELETE FROM customer_contacts WHERE id = $1 AND customer_id = $2`, [id, customerId]);
  if (!n) throw new AppError('not_found', 404, t('customers.contact_not_found'));
  await audit(ctx, { entity_type: 'customer', entity_id: customerId, action: 'delete_contact', extra: { contact_id: id } });
}

export async function updateCustomer(ctx: Ctx, id: string, patch: Record<string, any>) {
  const before = await getCustomerRow(ctx, id);
  if (before.anonymized_at) throw new AppError('customer_anonymized', 409, msg('error.this_customer_was_anonymised'));
  const data = { ...patch };
  if (data.email !== undefined) data.email = normalizeEmail(data.email);
  if (data.custom_fields !== undefined) data.custom_fields = await validateCustomFields(ctx, 'customer', data.custom_fields);
  if (data.flags) data.flags = { ...before.flags, ...data.flags };
  if (data.b2b) Object.assign(data, b2bColumns(before, data.b2b));
  delete data.b2b;
  // A new tax number is checked; the old check never stays with another number.
  delete data.tax_id_check;
  if (data.tax_id !== undefined && (data.tax_id || null) !== (before.tax_id || null)) data.tax_id_check = data.tax_id ? await checkTaxId(ctx, data.tax_id) : null;
  const q = updateSql('customers', id, data, COLS);
  if (!q) return customerToApi(before);
  const after = (await many(ctx, q.text, q.values))[0];
  await audit(ctx, { entity_type: 'customer', entity_id: id, action: 'update', before, after });
  const api = customerToApi(after);
  await emit(ctx, 'customer.updated', { type: 'customer', id }, api);
  return api;
}

/** Checks the customer's tax number again (staff, after a register outage or a fix there). */
export async function recheckTaxId(ctx: Ctx, id: string) {
  const c = await getCustomerRow(ctx, id);
  if (!c.tax_id) throw invalid(msg('error.no_tax_id'), [{ field: 'tax_id', code: 'required', message: msg('error.no_tax_id') }]);
  const check = await checkTaxId(ctx, c.tax_id, { fresh: true });
  if (!check) throw new AppError('no_tax_provider', 409, msg('error.no_tax_check'));
  const after = (await many(ctx, `UPDATE customers SET tax_id_check = $2 WHERE id = $1 RETURNING *`, [id, json(check)]))[0];
  await audit(ctx, { entity_type: 'customer', entity_id: id, action: 'check_tax_id', extra: { status: check.status, ref: check.ref ?? null } });
  const api = customerToApi(after);
  await emit(ctx, 'customer.updated', { type: 'customer', id }, api);
  return api;
}

export async function setBlocked(ctx: Ctx, id: string, blocked: boolean, reason?: string) {
  const c = await updateCustomer(ctx, id, { flags: { blocked } });
  if (blocked) await emit(ctx, 'customer.blocked', { type: 'customer', id }, { ...c, reason: reason ?? null });
  return c;
}

export async function deleteCustomer(ctx: Ctx, id: string) {
  const c = await getCustomerRow(ctx, id);
  const used = await one(ctx, `SELECT 1 FROM orders WHERE customer_id = $1 LIMIT 1`, [id]);
  if (used) throw new AppError('customer_has_orders', 409, msg('error.this_customer_has_orders_anonymise_instead_of'));
  await exec(ctx, `UPDATE customers SET deleted_at = now() WHERE id = $1`, [id]);
  await audit(ctx, { entity_type: 'customer', entity_id: id, action: 'delete', before: c });
}

/** Moves orders, documents and payments to `targetId`; the source becomes a tombstone. */
export async function mergeCustomers(ctx: Ctx, targetId: string, sourceId: string) {
  if (targetId === sourceId) throw invalid(msg('error.cannot_merge_a_customer_into_itself'));
  const target = await getCustomerRow(ctx, targetId);
  const source = await getCustomerRow(ctx, sourceId);
  await exec(ctx, `UPDATE orders SET customer_id = $1 WHERE customer_id = $2`, [targetId, sourceId]);
  await exec(ctx, `UPDATE documents SET customer_id = $1 WHERE customer_id = $2 AND issued_at IS NULL`, [targetId, sourceId]);
  // Saved billing details and addresses come along; the target keeps its own defaults.
  for (const table of ['customer_billing_profiles', 'customer_addresses']) await exec(ctx, `UPDATE ${table} SET customer_id = $1, is_default = false WHERE customer_id = $2`, [targetId, sourceId]);
  const patch = {
    email: target.email ?? source.email,
    phone: target.phone ?? source.phone,
    tags: [...new Set([...(target.tags ?? []), ...(source.tags ?? [])])],
    notes: [target.notes, source.notes].filter(Boolean).join('\n'),
    provider_refs: { ...source.provider_refs, ...target.provider_refs },
  };
  await exec(ctx, `UPDATE customers SET email = $2, phone = $3, tags = $4, notes = $5, provider_refs = $6 WHERE id = $1`, [targetId, patch.email, patch.phone, patch.tags, patch.notes, json(patch.provider_refs)]);
  await exec(ctx, `UPDATE customers SET merged_into_id = $1, deleted_at = now() WHERE id = $2`, [targetId, sourceId]);
  await audit(ctx, { entity_type: 'customer', entity_id: targetId, action: 'merge', extra: { merged_from: sourceId } });
  const api = await getCustomer(ctx, targetId);
  await emit(ctx, 'customer.merged', { type: 'customer', id: targetId }, { ...api, merged_from: sourceId });
  return api;
}

/** FR-CUS-4: wipes personal data, keeps financial records attached to the anonymised row. */
export async function anonymizeCustomer(ctx: Ctx, id: string) {
  const before = await getCustomerRow(ctx, id);
  const open = await one(ctx, `SELECT 1 FROM orders WHERE customer_id = $1 AND status IN ('reserved','prepared','out','returned_partial') LIMIT 1`, [id]);
  if (open) throw new AppError('customer_has_open_orders', 409, msg('error.finish_or_cancel_open_orders_before_anonymising'));
  await exec(
    ctx,
    `UPDATE customers SET name = $2, email = NULL, phone = NULL, company_name = NULL, tax_id = NULL, addresses = '{}',
       notes = '', tags = '{}', custom_fields = '{}', provider_refs = '{}', marketing_consent = false, sms_opt_in = false, whatsapp_opt_in = false, anonymized_at = now() WHERE id = $1`,
    [id, msg('customer.anonymised_name', {}, await tenantLocale(ctx))],
  );
  // Contact people and the customer's own files (ID scans, certificates) are personal data too.
  const contacts = await many(ctx, `DELETE FROM customer_contacts WHERE customer_id = $1 RETURNING id`, [id]);
  // Saved billing details and addresses go, and so do the copies on orders (issued documents keep theirs).
  await exec(ctx, `DELETE FROM customer_billing_profiles WHERE customer_id = $1`, [id]);
  await exec(ctx, `DELETE FROM customer_addresses WHERE customer_id = $1`, [id]);
  await exec(ctx, `UPDATE orders SET billing = NULL WHERE customer_id = $1 AND billing IS NOT NULL`, [id]);
  const files = await removeCustomerAttachments(ctx, id);
  await audit(ctx, { entity_type: 'customer', entity_id: id, action: 'anonymize', extra: { had_email: !!before.email, contacts_removed: contacts.length, attachments_removed: files } });
  const api = customerToApi(await getCustomerRow(ctx, id));
  await emit(ctx, 'customer.anonymized', { type: 'customer', id }, api);
  return api;
}

/** FR-CUS-4: everything held about a customer. */
export async function exportCustomer(ctx: Ctx, id: string) {
  const customer = await getCustomer(ctx, id);
  const orders = await many(ctx, `SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at`, [id]);
  const ids = orders.map((o) => o.id);
  return {
    exported_at: ctx.now.toISOString(),
    customer,
    contacts: await many(ctx, `SELECT id, name, email, phone, role, is_primary, created_at FROM customer_contacts WHERE customer_id = $1 ORDER BY created_at`, [id]),
    billing_profiles: await many(ctx, `SELECT id, kind, name, company_name, tax_id, address, is_default, created_at FROM customer_billing_profiles WHERE customer_id = $1 ORDER BY created_at`, [id]),
    addresses: await many(ctx, `SELECT id, label, recipient, phone, address, is_default, created_at FROM customer_addresses WHERE customer_id = $1 ORDER BY created_at`, [id]),
    attachments: await many(
      ctx,
      `SELECT a.id, a.owner_type, a.owner_id, a.label, a.kind, a.visibility, f.filename, f.content_type, f.size, a.created_at FROM attachments a JOIN files f ON f.id = a.file_id
        WHERE (a.owner_type = 'customer' AND a.owner_id = $1) OR (a.owner_type = 'order' AND a.owner_id IN (SELECT id FROM orders WHERE customer_id = $1)) ORDER BY a.created_at`,
      [id],
    ),
    orders,
    order_lines: ids.length ? await many(ctx, `SELECT * FROM order_lines WHERE order_id = ANY($1)`, [ids]) : [],
    payments: ids.length ? await many(ctx, `SELECT * FROM payments WHERE order_id = ANY($1)`, [ids]) : [],
    deposits: ids.length ? await many(ctx, `SELECT * FROM deposits WHERE order_id = ANY($1)`, [ids]) : [],
    documents: await many(ctx, `SELECT id, type, number, issued_at, status, data FROM documents WHERE customer_id = $1 OR order_id = ANY($2)`, [id, ids]),
    notifications: ids.length ? await many(ctx, `SELECT id, template_key, recipient, subject, status, created_at FROM notifications WHERE order_id = ANY($1)`, [ids]) : [],
    damage_charges: ids.length ? await many(ctx, `SELECT * FROM damage_charges WHERE order_id = ANY($1)`, [ids]) : [],
  };
}
