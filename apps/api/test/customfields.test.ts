import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

suite('custom fields, rich descriptions and tags', () => {
  let t: TestApp;
  let admin: Client;

  beforeAll(async () => {
    ({ t, admin } = await shopForTests(dbinfo!));
    await admin.patch('/api/v1/tenant/settings', { storefront: { locales: ['en', 'de'], default_locale: 'en' } });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('defines fields with translated labels and options, and guards keys', async () => {
    const size = await admin.post('/api/v1/custom_field_definitions', {
      entity: 'product',
      key: 'frame_size',
      type: 'select',
      labels: { en: 'Frame size', de: 'Rahmengröße' },
      options: [
        { value: 's', labels: { en: 'Small', de: 'Klein' } },
        { value: 'l', labels: { en: 'Large', de: 'Groß' } },
      ],
      visibility: 'storefront',
    });
    expect(size.status).toBe(201);
    expect((await admin.post('/api/v1/custom_field_definitions', { entity: 'product', key: 'frame_size', type: 'text', labels: { en: 'Again' } })).status).toBe(409);
    const noOptions = await admin.post('/api/v1/custom_field_definitions', { entity: 'product', key: 'colour', type: 'select', labels: { en: 'Colour' } });
    expect(noOptions.status).toBe(422);
    expect(noOptions.body.errors[0].field).toBe('options');
    expect((await admin.post('/api/v1/custom_field_definitions', { entity: 'product', key: 'plg_mine', type: 'text', labels: { en: 'Mine' } })).status).toBe(422);
    const rekey = await admin.patch(`/api/v1/custom_field_definitions/${size.body.id}`, { key: 'other' });
    expect(rekey.status).toBe(422);
    expect(rekey.body.errors[0].field).toBe('key');
    await admin.post('/api/v1/custom_field_definitions', { entity: 'product', key: 'internal_note', type: 'text', labels: { en: 'Workshop note' } });
    await admin.post('/api/v1/custom_field_definitions', { entity: 'customer', key: 'licence_checked', type: 'boolean', labels: { en: 'Licence checked' }, required: true });
    const list = await admin.get('/api/v1/custom_field_definitions?filter[entity]=product');
    expect(list.body.data.map((d: any) => d.key)).toEqual(['frame_size', 'internal_note']);
  });

  it('validates values next to their fields and shows storefront fields in the shopper’s language', async () => {
    const bad = await admin.post('/api/v1/products', { type: 'rental', name: 'Bike', tracking: 'bulk', price: { kind: 'fixed', amount: 100 }, custom_fields: { frame_size: 'xl', nope: 1 } });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((e: any) => `${e.field}:${e.code}`).sort()).toEqual(['custom_fields.frame_size:not_option', 'custom_fields.nope:unknown_field']);
    const p = await admin.post('/api/v1/products', {
      type: 'rental',
      name: 'Bike',
      tracking: 'bulk',
      price: { kind: 'fixed', amount: 100 },
      description: '<h2>City bike</h2><p>Light <strong>and</strong> quick.<script>alert(1)</script></p><ul><li>Lock</li></ul>',
      translations: { de: { description: '<p>Leicht <em>und</em> schnell<img src=x onerror=alert(1)></p>' } },
      custom_fields: { frame_size: 'l', internal_note: 'New chain in May' },
      tags: ['city', 'family'],
    });
    expect(p.status).toBe(201);
    expect(p.body.description).toBe('<h2>City bike</h2><p>Light <strong>and</strong> quick.</p><ul><li>Lock</li></ul>');
    expect(p.body.translations.de.description).toBe('<p>Leicht <em>und</em> schnell</p>');

    const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
    const en = await sf.get(`/api/v1/storefront/catalog/products/${p.body.slug}`);
    expect(en.body.description).toBe('City bike\nLight and quick.\nLock');
    expect(en.body.description_html).toContain('<strong>and</strong>');
    // Internal fields stay internal.
    expect(en.body.fields).toEqual([{ key: 'frame_size', label: 'Frame size', type: 'select', value: 'l', display: 'Large' }]);
    const de = await sf.get(`/api/v1/storefront/catalog/products/${p.body.slug}?locale=de`);
    expect(de.body.fields[0]).toMatchObject({ label: 'Rahmengröße', display: 'Groß' });
    expect(de.body.description_html).toBe('<p>Leicht <em>und</em> schnell</p>');

    // Tags in use are suggested, most used first.
    await admin.post('/api/v1/products', { type: 'rental', name: 'Trike', tracking: 'bulk', price: { kind: 'fixed', amount: 100 }, tags: ['family'] });
    const tags = await admin.get('/api/v1/tags?entity=product');
    expect(tags.body.data[0]).toEqual({ tag: 'family', count: 2 });
    expect((await admin.get('/api/v1/tags?entity=product&q=cit')).body.data).toEqual([{ tag: 'city', count: 1 }]);
  });

  it('asks staff for required fields but lets shoppers book without them', async () => {
    const missing = await admin.post('/api/v1/customers', { name: 'Rita Required' });
    expect(missing.status).toBe(422);
    expect(missing.body.errors[0]).toMatchObject({ field: 'custom_fields.licence_checked', code: 'required', message: 'Licence checked is required' });
    expect((await admin.post('/api/v1/customers', { name: 'Rita Required', custom_fields: { licence_checked: true } })).status).toBe(201);

    const bike = (await admin.get('/api/v1/products?q=Bike')).body.data.find((x: any) => x.name === 'Bike');
    await admin.put(`/api/v1/stock_levels/${bike.variants[0].id}/${(await admin.get('/api/v1/locations')).body.data[0].id}`, { quantity: 3 });
    const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
    const settings = await sf.get('/api/v1/storefront/settings');
    const cs = await sf.post('/api/v1/storefront/checkout_sessions', { starts_at: isoIn(4), ends_at: isoIn(5), lines: [{ variant_id: bike.variants[0].id, quantity: 1 }] });
    const done = await sf.post(`/api/v1/storefront/checkout_sessions/${cs.body.id}/actions/complete`, { customer: { name: 'Web Walker', email: 'walker@test.dev' }, terms_accepted: true, terms_hash: settings.body.terms.hash });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
  });
});
