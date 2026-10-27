import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenancy, type Ctx } from '@openrent/core';
import { withTenant } from '@openrent/db';
import { Client, databaseForTests, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

const ECB_XML = `<gesmes:Envelope><Cube><Cube time='2026-10-26'><Cube currency='USD' rate='1.0812'/><Cube currency='GBP' rate='0.8350'/></Cube></Cube></gesmes:Envelope>`;

/** Prices in other currencies and with or without tax per language (FR-I18N-7), rates from the ECB plugin. */
suite('display currencies and tax display', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let ecb: Server;
  let ecbUrl = '';
  let slug: string;
  const shop = () => new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, tenantId, (c) => fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: '', livemode: false }, logger: quietLogger }));

  beforeAll(async () => {
    ({ t, admin, tenantId } = await shopForTests(dbinfo!));
    ecb = createServer((_req, res) => res.writeHead(200, { 'content-type': 'application/xml' }).end(ECB_XML));
    await new Promise<void>((ok) => ecb.listen(0, '127.0.0.1', ok));
    ecbUrl = `http://127.0.0.1:${(ecb.address() as AddressInfo).port}`;
    slug = (await admin.post('/api/v1/products', { type: 'rental', name: 'Tent', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 5000 } })).body.slug;
  }, 120_000);

  afterAll(async () => {
    ecb?.close();
    await t?.close();
    await dbinfo?.stop();
  });

  const price = async (locale = 'en') => (await shop().get(`/api/v1/storefront/catalog/products/${slug}?locale=${locale}`)).body.variants[0].price;

  it('shows catalogue prices with tax, or without for a language that wants that', async () => {
    // The test shop charges 20 % VAT and shows prices with tax by default.
    expect(await price()).toMatchObject({ amount: { amount: 6000 }, includes_tax: true });
    await admin.patch('/api/v1/tenant/settings', { storefront: { locales: ['en', 'de'], default_locale: 'en' }, tax_display: { de: 'excl' } });
    expect(await price('de')).toMatchObject({ amount: { amount: 5000 }, includes_tax: false });
    expect((await shop().get('/api/v1/storefront/settings?locale=de')).body.display_prices_including_tax).toBe(false);
    const bad = await admin.patch('/api/v1/tenant/settings', { tax_display: { xx: 'incl' } });
    expect([bad.status, bad.body.errors[0].field]).toEqual([422, 'tax_display.xx']);
  });

  it('offers other currencies with rates typed in, never the shop’s own', async () => {
    const bad = await admin.patch('/api/v1/tenant/settings', { display_currencies: { currencies: ['usd'], rates: { USD: -1 } } });
    expect(bad.body.errors.map((e: any) => e.field).sort()).toEqual(['display_currencies.currencies', 'display_currencies.rates.USD']);
    await admin.patch('/api/v1/tenant/settings', { display_currencies: { currencies: ['USD', 'EUR', 'GBP'], rates: { USD: 1.1 } } });
    const s = (await shop().get('/api/v1/storefront/settings')).body.currencies;
    // GBP has no rate yet, and EUR is the shop's own: only USD shows.
    expect(s).toEqual({ base: 'EUR', display: [{ code: 'USD', rate: 1.1 }], updated_at: null });
    // Catalogue descriptions in the visitor's currency, marked approximate; the amount stays in euros.
    const usd = (await shop().get(`/api/v1/storefront/catalog/products/${slug}`, { 'x-display-currency': 'USD' })).body.variants[0].price;
    expect([usd.description, usd.amount]).toEqual(['≈ $66.00 per day', { amount: 6000, currency: 'EUR' }]);
    expect((await shop().get(`/api/v1/storefront/catalog/products/${slug}`, { 'x-display-currency': 'GBP' })).body.variants[0].price.description).toBe('€60.00 per day');
    const manual = await admin.post('/api/v1/tenant/settings/actions/refresh_rates');
    expect([manual.status, manual.body.code]).toEqual([409, 'rates_manual']);
  });

  it('keeps the rates up to date from the ECB plugin', async () => {
    await admin.patch('/api/v1/plugins/rates-ecb', { enabled: true, config: { url: ecbUrl } });
    await admin.patch('/api/v1/tenant/settings', { display_currencies: { source: 'rates-ecb' } });
    const r = await admin.post('/api/v1/tenant/settings/actions/refresh_rates');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.display_currencies).toMatchObject({ rates: { USD: 1.0812, GBP: 0.835 }, updated_at: '2026-10-26' });
    // The worker's daily run does the same, and quietly does nothing for a shop that types rates in.
    await admin.patch('/api/v1/tenant/settings', { display_currencies: { rates: { USD: 2 } } });
    await inTenant((ctx) => tenancy.refreshRates(ctx));
    expect((await shop().get('/api/v1/storefront/settings')).body.currencies.display).toEqual([{ code: 'USD', rate: 1.0812 }, { code: 'GBP', rate: 0.835 }]);
  });
});
