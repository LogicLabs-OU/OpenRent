import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

suite('document template editor', () => {
  let t: TestApp;
  let admin: Client;
  let order: any;

  beforeAll(async () => {
    ({ t, admin } = await shopForTests(dbinfo!));
    await admin.patch('/api/v1/tenant/settings', { storefront: { locales: ['en', 'de'], default_locale: 'en' } });
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Canoe', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 4000 } });
    await admin.put(`/api/v1/stock_levels/${p.body.variants[0].id}/${(await admin.get('/api/v1/locations')).body.data[0].id}`, { quantity: 2 });
    const c = await admin.post('/api/v1/customers', { name: 'Doc Reader', email: 'doc@test.dev' });
    order = (await admin.post('/api/v1/orders', { customer_id: c.body.id, starts_at: isoIn(2), ends_at: isoIn(4), lines: [{ variant_id: p.body.variants[0].id, quantity: 1 }] })).body;
    await admin.post(`/api/v1/orders/${order.id}/actions/reserve`, { notify: false });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('lists one template per type in each language, named in that language', async () => {
    const de = await admin.get('/api/v1/document_templates?locale=de');
    expect(de.body.data).toHaveLength(9);
    expect(de.body.data.find((d: any) => d.type === 'invoice')).toMatchObject({ builtin: true, locale: 'de', name: 'Rechnung' });
    const vars = await admin.get('/api/v1/document_templates/variables');
    expect(vars.body.values).toContain('totals.total');
  });

  it('previews in the chosen language and reports template errors next to the body', async () => {
    const de = await admin.post('/api/v1/document_templates/preview', { type: 'invoice', order_id: order.id, locale: 'de' });
    expect(de.status).toBe(200);
    expect(de.body).toContain('lang="de"');
    expect(de.body).toContain('Gesamt');
    const broken = await admin.post('/api/v1/document_templates/preview', { type: 'invoice', order_id: order.id, body: '{{#each lines}}<p>{{name}}</p>' });
    expect(broken.status).toBe(422);
    expect(broken.body.errors[0].field).toBe('body');
    const helper = await admin.post('/api/v1/document_templates/preview', { type: 'invoice', order_id: order.id, body: '{{nosuchhelper 1}}' });
    expect(helper.status).toBe(422);
  });

  it('saves a shop template for one language without touching issued documents, and resets it', async () => {
    const first = await admin.post(`/api/v1/orders/${order.id}/documents`, { type: 'confirmation' });
    const firstHtml = (await admin.get(`/api/v1/documents/${first.body.id}/html`)).body as string;
    const saved = await admin.post('/api/v1/document_templates', { type: 'confirmation', locale: 'en', body: '<h1>Thanks, {{customer.name}}!</h1><p>{{t "doc.order"}} #{{order.number}}</p>' });
    expect(saved.status).toBe(201);
    const second = await admin.post(`/api/v1/orders/${order.id}/documents`, { type: 'confirmation' });
    expect((await admin.get(`/api/v1/documents/${second.body.id}/html`)).body).toContain('Thanks, Doc Reader!');
    // The earlier document is unchanged.
    expect((await admin.get(`/api/v1/documents/${first.body.id}/html`)).body).toBe(firstHtml);
    // German still uses the built-in template.
    expect((await admin.get('/api/v1/document_templates?locale=de')).body.data.find((d: any) => d.type === 'confirmation').builtin).toBe(true);
    expect((await admin.del(`/api/v1/document_templates/${saved.body.id}`)).status).toBe(204);
    expect((await admin.get('/api/v1/document_templates?locale=en')).body.data.find((d: any) => d.type === 'confirmation').builtin).toBe(true);
  });

  it('reads, changes and previews one template by id (PRD §5.4)', async () => {
    const builtin = await admin.get('/api/v1/document_templates/builtin:quote');
    expect(builtin.body).toMatchObject({ type: 'quote', locale: 'en' });
    expect((await admin.get('/api/v1/document_templates/dtp_missing')).status).toBe(404);
    const own = await admin.patch('/api/v1/document_templates/builtin:quote', { locale: 'de', body: '<h1>{{t "doc.total"}}</h1>' });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body).toMatchObject({ type: 'quote', locale: 'de' });
    const changed = await admin.patch(`/api/v1/document_templates/${own.body.id}`, { css: 'h1 { color: teal }' });
    expect(changed.body).toMatchObject({ id: own.body.id, body: '<h1>{{t "doc.total"}}</h1>', css: 'h1 { color: teal }', version: own.body.version + 1 });
    expect((await admin.patch(`/api/v1/document_templates/${own.body.id}`, { body: '{{#if x}}' })).body.errors[0].field).toBe('body');
    const html = await admin.post(`/api/v1/document_templates/${own.body.id}/preview`, { order_id: order.id });
    expect(html.status).toBe(200);
    expect(html.body).toContain('Gesamt');
    expect(html.body).toContain('color: teal');
    expect((await admin.del(`/api/v1/document_templates/${own.body.id}`)).status).toBe(204);
  });
});
