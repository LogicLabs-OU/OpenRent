import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startViesFake, type ViesFake } from '@openrent/tax-fakes';
import { startSlackFake, type SlackFake } from '@openrent/messaging-fakes';
import { publishOutbox } from '../../worker/src/jobs.ts';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

// Slack webhooks must be Slack's own address, unless the installation allows a test address.
process.env.SLACK_ALLOW_ANY_WEBHOOK = '1';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** EU VAT numbers with VIES and the reverse charge (FR-PLG-1), and staff notices in Slack (FR-NOT-6). */
suite('VIES VAT numbers and Slack notices', () => {
  let t: TestApp;
  let admin: Client;
  let locationId: string;
  let variant: string;
  let vies: ViesFake;
  let slack: SlackFake;
  const shop = () => new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
  const tax = (o: any) => o.totals.tax.amount;

  beforeAll(async () => {
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
    vies = await startViesFake({ numbers: { DE123456789: { name: 'Bühne GmbH', address: 'Hauptstr. 1, Berlin' }, EE100931558: { name: 'Test Rentals OÜ', address: 'Tallinn' } } });
    slack = await startSlackFake();
    await admin.patch(`/api/v1/locations/${locationId}`, { address: { line1: 'Viru 1', city: 'Tallinn', country: 'EE' } });
    const p = (await admin.post('/api/v1/products', { type: 'rental', name: 'Stage', visibility: 'public', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 10000 } })).body;
    variant = p.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId}`, { quantity: 20 });
    await admin.patch('/api/v1/plugins/tax-vies', { enabled: true, config: { api_url: vies.url, requester_vat: 'EE100931558' } });
  }, 120_000);

  afterAll(async () => {
    await vies?.close();
    await slack?.close();
    await t?.close();
    await dbinfo?.stop();
  });

  const order = async (customerId: string) =>
    (await admin.post('/api/v1/orders', { customer_id: customerId, location_id: locationId, starts_at: isoIn(10), ends_at: isoIn(11), lines: [{ variant_id: variant, quantity: 1 }] })).body;

  it('checks a customer’s VAT number when it is saved, and again on request', async () => {
    const c = (await admin.post('/api/v1/customers', { type: 'company', name: 'Bühne', company_name: 'Bühne GmbH', email: 'buehne@test.dev', tax_id: 'DE 123 456 789' })).body;
    expect(c.tax_id_check).toMatchObject({ status: 'valid', country: 'DE', name: 'Bühne GmbH' });
    expect(c.tax_id_check.ref).toMatch(/^WAPI/);
    const bad = (await admin.post('/api/v1/customers', { type: 'company', name: 'Typo', email: 'typo@test.dev', tax_id: 'DE111111111' })).body;
    expect(bad.tax_id_check).toMatchObject({ status: 'invalid' });
    vies.numbers.DE111111111 = { name: 'Typo AG', address: 'Köln' };
    const again = await admin.post(`/api/v1/customers/${bad.id}/actions/check_tax_id`, {});
    expect([again.status, again.body.tax_id_check.status]).toEqual([200, 'valid']);
    // Clearing the number clears the check.
    expect((await admin.patch(`/api/v1/customers/${bad.id}`, { tax_id: null })).body.tax_id_check).toBeNull();
  });

  it('takes VAT off for a business in another EU country and says why on the invoice', async () => {
    const c = (await admin.get('/api/v1/customers?q=buehne')).body.data[0];
    const o = await order(c.id);
    expect(tax(o)).toBe(0);
    expect(o.totals.tax_note.en).toContain('Article 196');
    const inv = (await admin.post(`/api/v1/orders/${o.id}/documents`, { type: 'invoice' })).body;
    const html = (await admin.get(`/api/v1/documents/${inv.id}/html`)).body as string;
    expect(html).toContain('Reverse charge');
  });

  it('keeps VAT for a business at home, without a valid number and while VIES is down', async () => {
    const home = (await admin.post('/api/v1/customers', { type: 'company', name: 'Kodu', email: 'kodu@test.dev', tax_id: 'EE100931558' })).body;
    expect(tax(await order(home.id))).toBe(2000);
    vies.down.add('FR');
    const fr = (await admin.post('/api/v1/customers', { type: 'company', name: 'Scène', email: 'scene@test.dev', tax_id: 'FR12345678901' })).body;
    expect(fr.tax_id_check.status).toBe('unavailable');
    const o = await order(fr.id);
    expect([tax(o), o.totals.tax_note ?? null]).toEqual([2000, null]);
  });

  it('refuses a VAT number VIES does not know at checkout, and books a valid one without VAT', async () => {
    const sl = await admin.patch('/api/v1/plugins/notify-slack', { enabled: true, config: { webhook_url: slack.webhookUrl, kind_staff_overdue: false } });
    expect(sl.status, JSON.stringify(sl.body)).toBe(200);
    const terms = (await shop().get('/api/v1/storefront/settings')).body.terms.hash;
    const book = async (taxId: string, email: string) => {
      const cs = (await shop().post('/api/v1/storefront/checkout_sessions', { starts_at: isoIn(12), ends_at: isoIn(13), lines: [{ variant_id: variant, quantity: 1 }] })).body;
      return shop().post(`/api/v1/storefront/checkout_sessions/${cs.id}/actions/complete`, {
        customer: { name: 'Online GmbH', email, company_name: 'Online GmbH', tax_id: taxId, billing_address: { line1: 'Weg 2', city: 'Berlin', country: 'DE' } }, terms_accepted: true, terms_hash: terms,
      });
    };
    const refused = await book('DE222222222', 'online@test.dev');
    expect([refused.status, refused.body.errors[0].field]).toEqual([422, 'customer.tax_id']);
    vies.numbers.DE333333333 = { name: 'Online GmbH', address: 'Berlin' };
    const done = await book('DE333333333', 'online2@test.dev');
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const o = (await admin.get(`/api/v1/orders/${done.body.order.id}`)).body;
    expect(tax(o)).toBe(0);

    // The new booking becomes a staff notice when the worker handles it; the notice reaches Slack on the next pass.
    await publishOutbox(t.deps, quietLogger as any);
    await publishOutbox(t.deps, quietLogger as any);
    const posted = slack.messages.find((m) => m.text.includes(`#${o.number}`));
    expect(posted?.text).toMatch(new RegExp(`<[^|]+/orders/${o.id}\\|Open>$`));
  });
});
