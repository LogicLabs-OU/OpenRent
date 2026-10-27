import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startViesFake, type ViesFake } from '@openrent/tax-fakes';
import { withSystem } from '@openrent/db';
import { tenancy } from '@openrent/core';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Billing details and addresses customers keep, the copy each order takes, and the tax that follows it (ADR 0012). */
suite('billing profiles and addresses', () => {
  let t: TestApp;
  let admin: Client;
  let locationId: string;
  let variant: string;
  let vies: ViesFake;
  let session = '';
  let customer: any;
  const shop = () => new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
  const as = () => new Client(t.app, { 'x-tenant-slug': 'test-rentals', 'x-customer-session': session });
  const linkTo = async (email: string, template: string) => {
    const r = await withSystem(t.deps.db, (c) => c.query(`SELECT body_html FROM notifications WHERE template_key = $2 AND recipient = $1 ORDER BY created_at DESC LIMIT 1`, [email, template]));
    return /token(?:=|&#x3D;)([\w-]+)/.exec(r.rows[0]?.body_html ?? '')?.[1];
  };
  const terms = async () => (await shop().get('/api/v1/storefront/settings')).body.terms.hash;
  const checkout = async (client: Client, body: Record<string, any>) => {
    const cs = await client.post('/api/v1/storefront/checkout_sessions', { starts_at: isoIn(20), ends_at: isoIn(21), lines: [{ variant_id: variant, quantity: 1 }] });
    return client.post(`/api/v1/storefront/checkout_sessions/${cs.body.id}/actions/complete`, { terms_accepted: true, terms_hash: await terms(), ...body });
  };

  beforeAll(async () => {
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
    vies = await startViesFake({ numbers: { DE123456789: { name: 'Bühne GmbH', address: 'Hauptstr. 1, Berlin' }, EE100931558: { name: 'Test Rentals OÜ', address: 'Tallinn' } } });
    await admin.patch(`/api/v1/locations/${locationId}`, { address: { line1: 'Viru 1', city: 'Tallinn', country: 'EE' } });
    const p = (await admin.post('/api/v1/products', { type: 'rental', name: 'Stage', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 10000 } })).body;
    variant = p.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId}`, { quantity: 50 });
    await admin.patch('/api/v1/plugins/tax-vies', { enabled: true, config: { api_url: vies.url, requester_vat: 'EE100931558' } });
    customer = (await admin.post('/api/v1/customers', { name: 'Mia Muster', email: 'mia@test.dev' })).body;
    await admin.post(`/api/v1/customers/${customer.id}/actions/send_portal_link`);
    session = (await shop().post('/api/v1/portal/auth/verify', { token: (await linkTo('mia@test.dev', 'portal_invitation'))! })).body.token;
  }, 120_000);

  afterAll(async () => {
    await vies?.close();
    await t?.close();
    await dbinfo?.stop();
  });

  let company: any;
  let home: any;

  it('keeps billing details per customer: the first is the default, a company needs a name and an address', async () => {
    expect((await shop().get('/api/v1/storefront/account/billing_profiles')).status).toBe(401);
    home = (await as().post('/api/v1/storefront/account/billing_profiles', { kind: 'private', name: 'Mia Muster', address: { line1: 'Kai 1', city: 'Tallinn', country: 'ee' } })).body;
    expect(home).toMatchObject({ object: 'billing_profile', kind: 'private', is_default: true, address: { country: 'EE' } });
    const bad = await as().post('/api/v1/storefront/account/billing_profiles', { kind: 'company', name: 'Mia', tax_id: 'DE123456789' });
    expect([bad.status, bad.body.errors.map((e: any) => e.field).sort()]).toEqual([422, ['address.city', 'address.country', 'address.line1', 'company_name']]);
    const wrongVat = await as().post('/api/v1/storefront/account/billing_profiles', { kind: 'company', name: 'Mia', company_name: 'Nope GmbH', tax_id: 'DE999999999', address: { line1: 'A 1', city: 'Berlin', country: 'DE' } });
    expect([wrongVat.status, wrongVat.body.errors[0].field]).toEqual([422, 'tax_id']);
    company = (await as().post('/api/v1/portal/me/billing_profiles', { kind: 'company', name: 'Mia Muster', company_name: 'Bühne GmbH', tax_id: 'DE 123 456 789', address: { line1: 'Hauptstr. 1', city: 'Berlin', country: 'DE' } })).body;
    expect(company).toMatchObject({ tax_id: 'DE123456789', tax_id_check: { status: 'valid' }, is_default: false });
    // Making another the default moves the mark; there is only ever one.
    await as().patch(`/api/v1/storefront/account/billing_profiles/${company.id}`, { is_default: true });
    const list = (await as().get('/api/v1/storefront/account/billing_profiles')).body.data;
    expect(list.map((p: any) => [p.id, p.is_default])).toEqual([[company.id, true], [home.id, false]]);
    // Staff see the same list on the customer.
    expect((await admin.get(`/api/v1/customers/${customer.id}/billing_profiles`)).body.data).toHaveLength(2);
  });

  it('keeps delivery addresses, and no customer reaches another’s', async () => {
    const a = await as().post('/api/v1/storefront/account/addresses', { label: 'Office', recipient: 'Mia', address: { line1: 'Pikk 2', city: 'Tallinn', country: 'EE' } });
    expect(a.body).toMatchObject({ object: 'customer_address', label: 'Office', is_default: true });
    expect((await as().post('/api/v1/storefront/account/addresses', { address: { line1: 'Only street' } })).status).toBe(422);
    const other = (await admin.post('/api/v1/customers', { name: 'Other', email: 'other@test.dev' })).body;
    const theirs = (await admin.post(`/api/v1/customers/${other.id}/addresses`, { address: { line1: 'Mere 3', city: 'Tallinn', country: 'EE' } })).body;
    expect((await as().patch(`/api/v1/storefront/account/addresses/${theirs.id}`, { label: 'Mine now' })).status).toBe(404);
    expect((await as().del(`/api/v1/storefront/account/addresses/${theirs.id}`)).status).toBe(404);
    expect((await as().del(`/api/v1/storefront/account/addresses/${a.body.id}`)).status).toBe(204);
  });

  it('bills a booking to the company chosen at checkout, without VAT, and keeps that on the invoice', async () => {
    const r = await checkout(as(), { customer: { name: 'Mia Muster', email: 'mia@test.dev' }, extra: { 'billing.profile_id': company.id } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const o = (await admin.get(`/api/v1/orders/${r.body.order.id}`)).body;
    expect(o.billing).toMatchObject({ kind: 'company', company_name: 'Bühne GmbH', tax_id: 'DE123456789', address: { city: 'Berlin' } });
    expect(o.totals.tax.amount).toBe(0);
    const inv = (await admin.post(`/api/v1/orders/${o.id}/documents`, { type: 'invoice' })).body;
    const html = (await admin.get(`/api/v1/documents/${inv.id}/html`)).body as string;
    expect(html).toContain('Bühne GmbH');
    expect(html).toContain('DE123456789');
    expect(html).toContain('Reverse charge');
    // A later change to the profile changes neither the order nor the invoice.
    await as().patch(`/api/v1/storefront/account/billing_profiles/${company.id}`, { company_name: 'Bühne AG' });
    expect((await admin.get(`/api/v1/orders/${o.id}`)).body.billing.company_name).toBe('Bühne GmbH');
    // Once invoiced, staff cannot change the billing details either.
    const locked = await admin.put(`/api/v1/orders/${o.id}/billing`, { billing: { kind: 'private', name: 'Someone' } });
    expect(locked.status).toBe(409);
  });

  it('bills the private profile with VAT, and refuses another customer’s profile', async () => {
    const r = await checkout(as(), { customer: { name: 'Mia Muster', email: 'mia@test.dev' }, extra: { 'billing.profile_id': home.id } });
    const o = (await admin.get(`/api/v1/orders/${r.body.order.id}`)).body;
    expect([o.billing.kind, o.totals.tax.amount]).toEqual(['private', 2000]);
    const guest = await checkout(shop(), { customer: { name: 'Mia Muster', email: 'mia@test.dev' }, extra: { 'billing.profile_id': home.id } });
    expect([guest.status, guest.body.errors[0].field]).toEqual([422, 'extra.billing.profile_id']);
  });

  it('takes a guest’s typed company details for the order, saving them only for a signed-in customer who asks', async () => {
    const g = await checkout(shop(), { customer: { name: 'Gast', email: 'gast@test.dev', company_name: 'Bühne GmbH', tax_id: 'DE123456789', billing_address: { line1: 'Hauptstr. 1', city: 'Berlin', country: 'DE' } } });
    const go = (await admin.get(`/api/v1/orders/${g.body.order.id}`)).body;
    expect([go.billing.company_name, go.totals.tax.amount]).toEqual(['Bühne GmbH', 0]);
    const bad = await checkout(shop(), { customer: { name: 'Gast', email: 'gast@test.dev', tax_id: 'DE999999999' } });
    expect([bad.status, bad.body.errors[0].field]).toEqual([422, 'customer.tax_id']);
    const before = (await as().get('/api/v1/storefront/account/billing_profiles')).body.data.length;
    await checkout(as(), { customer: { name: 'Mia Muster', email: 'mia@test.dev', company_name: 'Neu OÜ', billing_address: { line1: 'Narva 5', city: 'Tartu', country: 'EE' } }, extra: { 'billing.save': true } });
    const after = (await as().get('/api/v1/storefront/account/billing_profiles')).body.data;
    expect(after).toHaveLength(before + 1);
    expect(after.find((p: any) => p.company_name === 'Neu OÜ')).toMatchObject({ kind: 'company', address: { city: 'Tartu' } });
  });

  it('fills a customer’s empty fields from checkout but never overwrites the saved address', async () => {
    await admin.patch(`/api/v1/customers/${customer.id}`, { addresses: { billing: { line1: 'Saved 1', city: 'Tallinn', country: 'EE' } } });
    await checkout(shop(), { customer: { name: 'Mia Muster', email: 'mia@test.dev', billing_address: { line1: 'Typed 9', city: 'Narva', country: 'EE' } } });
    expect((await admin.get(`/api/v1/customers/${customer.id}`)).body.addresses.billing.line1).toBe('Saved 1');
    const csv = (await admin.get('/api/v1/customers/export?format=csv')).body as string;
    expect(csv).toContain('Saved 1, Tallinn, EE');
  });

  it('lets staff set billing details on a quote, which prices the tax again', async () => {
    const o = (await admin.post('/api/v1/orders', { customer_id: customer.id, location_id: locationId, starts_at: isoIn(30), ends_at: isoIn(31), lines: [{ variant_id: variant, quantity: 1 }] })).body;
    expect(o.totals.tax.amount).toBe(2000);
    const set = await admin.put(`/api/v1/orders/${o.id}/billing`, { billing: { kind: 'company', name: 'Mia', company_name: 'Bühne GmbH', tax_id: 'DE123456789', address: { line1: 'Hauptstr. 1', city: 'Berlin', country: 'DE' } } });
    expect([set.status, set.body.totals.tax.amount]).toEqual([200, 0]);
    const back = await admin.put(`/api/v1/orders/${o.id}/billing`, { billing: null });
    expect([back.body.billing, back.body.totals.tax.amount]).toEqual([null, 2000]);
    expect((await admin.put(`/api/v1/orders/${o.id}/billing`, { billing: { kind: 'company', name: 'Mia' } })).status).toBe(422);
  });

  it('keeps the reverse-charge note on a monthly invoice', async () => {
    const b2b = (await admin.post('/api/v1/customers', { type: 'company', name: 'Bühne', company_name: 'Bühne GmbH', email: 'monthly@test.dev', tax_id: 'DE123456789', b2b: { on_account: true, invoice_schedule: 'monthly' } })).body;
    const o = (await admin.post('/api/v1/orders', { customer_id: b2b.id, location_id: locationId, starts_at: isoIn(-20), ends_at: isoIn(-19), lines: [{ variant_id: variant, quantity: 1 }] })).body;
    expect(o.totals.tax_note?.en).toContain('Article 196');
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { notify: false });
    await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, {});
    await admin.post(`/api/v1/orders/${o.id}/actions/check_in`, { all: true });
    const inv = await admin.post(`/api/v1/customers/${b2b.id}/actions/invoice_now`, {});
    expect(inv.status, JSON.stringify(inv.body)).toBeLessThan(300);
    const html = (await admin.get(`/api/v1/documents/${inv.body.id ?? inv.body.data?.[0]?.id}/html`)).body as string;
    expect(html).toContain('Reverse charge');
  });

  it('removes saved details when a customer is anonymised, and keeps them to their own shop', async () => {
    const other = await withSystem(t.deps.db, (c) => tenancy.runSetup(c, { owner: { email: 'o2@test.dev', password: 'password123', name: 'O' }, tenant: { name: 'Shop Two', slug: 'two', currency: 'EUR', timezone: 'UTC' }, location: { name: 'X' } }, { livemode: false }));
    const o2 = new Client(t.app);
    await o2.post('/api/v1/auth/login', { email: 'o2@test.dev', password: 'password123' });
    expect((await o2.get(`/api/v1/customers/${customer.id}/billing_profiles`)).status).toBe(404);
    expect(other.tenantId).toBeTruthy();
    const gone = (await admin.post('/api/v1/customers', { name: 'Gone', email: 'gone@test.dev' })).body;
    await admin.post(`/api/v1/customers/${gone.id}/billing_profiles`, { name: 'Gone', address: { line1: 'X 1', city: 'Y', country: 'EE' } });
    expect((await admin.post(`/api/v1/customers/${gone.id}/actions/anonymize`, {})).status).toBe(200);
    expect((await admin.get(`/api/v1/customers/${gone.id}/billing_profiles`)).body.data).toEqual([]);
  });
});
