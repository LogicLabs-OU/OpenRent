import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem } from '@openrent/db';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

const pdf = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

suite('attachments and unit photos', () => {
  let t: TestApp;
  let admin: Client;
  let order: any;
  let customer: any;
  let unitId: string;

  beforeAll(async () => {
    ({ t, admin } = await shopForTests(dbinfo!));
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Tent', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 1500 } });
    unitId = (await admin.post('/api/v1/stock_items', { variant_id: p.body.variants[0].id, barcode: 'TENT-1' })).body.id;
    customer = (await admin.post('/api/v1/customers', { name: 'Fia File', email: 'fia@test.dev' })).body;
    order = (await admin.post('/api/v1/orders', { customer_id: customer.id, starts_at: isoIn(3), ends_at: isoIn(5), lines: [{ variant_id: p.body.variants[0].id, quantity: 1 }] })).body;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('attaches documents to an order and shares them with the customer on request', async () => {
    const bad = await admin.upload('/api/v1/files?purpose=attachment', 'tool.exe', 'application/x-msdownload', Buffer.from('MZ'));
    expect(bad.status).toBe(415);
    const up = await admin.upload('/api/v1/files?purpose=attachment', 'Rental agreement.pdf', 'application/pdf', pdf);
    expect(up.status).toBe(201);
    const a = await admin.post(`/api/v1/orders/${order.number}/attachments`, { file_id: up.body.id, label: 'Signed agreement' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ label: 'Signed agreement', visibility: 'internal', filename: 'Rental agreement.pdf' });
    // The same file cannot sit on two owners.
    expect((await admin.post(`/api/v1/customers/${customer.id}/attachments`, { file_id: up.body.id })).status).toBe(409);

    // Internal: not on the customer's order page.
    const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
    const token = order.public_token;
    expect((await sf.get(`/api/v1/storefront/orders/${token}?token=${token}`)).body.attachments).toEqual([]);
    expect((await sf.get(`/api/v1/storefront/orders/${token}/attachments/${a.body.id}/file?token=${token}`)).status).toBe(404);

    // Shared: listed and downloadable with the order link only.
    await admin.patch(`/api/v1/orders/${order.id}/attachments/${a.body.id}`, { visibility: 'customer' });
    const pub = await sf.get(`/api/v1/storefront/orders/${token}?token=${token}`);
    expect(pub.body.attachments).toEqual([expect.objectContaining({ id: a.body.id, label: 'Signed agreement' })]);
    const file = await sf.get(`/api/v1/storefront/orders/${token}/attachments/${a.body.id}/file?token=${token}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect((await sf.get(`/api/v1/storefront/orders/${token}/attachments/${a.body.id}/file?token=${'x'.repeat(20)}`)).status).toBe(404);

    // Staff download and removal (the file goes with it).
    expect((await admin.get(`/api/v1/orders/${order.id}/attachments/${a.body.id}/content`)).status).toBe(200);
    expect((await admin.del(`/api/v1/orders/${order.id}/attachments/${a.body.id}`)).status).toBe(204);
    const left = await withSystem(t.deps.db, (c) => c.query(`SELECT 1 FROM files WHERE id = $1`, [up.body.id]));
    expect(left.rows).toHaveLength(0);
  });

  it('refuses photos as attachments and keeps unit photos on the unit', async () => {
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#e11d48' } }).png().toBuffer();
    const photo = await admin.upload('/api/v1/files?purpose=photo', 'scratch.png', 'image/png', png);
    const wrong = await admin.post(`/api/v1/orders/${order.id}/attachments`, { file_id: photo.body.id });
    expect(wrong.status, JSON.stringify(wrong.body)).toBe(422);
    expect(wrong.body.errors[0].field).toBe('file_id');
    const unit = { id: unitId };
    expect((await admin.post(`/api/v1/stock_items/${unit.id}/photos`, { file_id: photo.body.id })).status).toBe(201);
    const got = await admin.get(`/api/v1/stock_items/${unit.id}`);
    expect(got.body.photos).toHaveLength(1);
    expect(got.body.photos[0].file_id).toBe(photo.body.id);
  });

  it('exports a customer’s files and removes them when the customer is anonymised', async () => {
    const up = await admin.upload('/api/v1/files?purpose=attachment', 'passport.png', 'image/png', Buffer.from('\x89PNG\r\n\x1a\n'));
    const a = await admin.post(`/api/v1/customers/${customer.id}/attachments`, { file_id: up.body.id, kind: 'id_document' });
    expect(a.body.kind).toBe('id_document');
    const exp = await admin.get(`/api/v1/customers/${customer.id}/export`);
    expect(exp.body.attachments.map((x: any) => x.id)).toContain(a.body.id);
    await admin.post(`/api/v1/orders/${order.id}/actions/cancel`, { notify: false });
    expect((await admin.post(`/api/v1/customers/${customer.id}/actions/anonymize`)).status).toBe(200);
    expect((await admin.get(`/api/v1/customers/${customer.id}/attachments`)).body.data).toEqual([]);
  });

  it('deletes an unused upload but not one that belongs to something (PRD §5.4)', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%%EOF');
    const loose = await admin.upload('/api/v1/files?purpose=attachment', 'loose.pdf', 'application/pdf', pdf);
    expect((await admin.del(`/api/v1/files/${loose.body.id}`)).status).toBe(204);
    expect((await admin.get(`/api/v1/files/${loose.body.id}`)).status).toBe(404);
    const kept = await admin.upload('/api/v1/files?purpose=attachment', 'kept.pdf', 'application/pdf', pdf);
    const other = (await admin.post('/api/v1/customers', { name: 'File Keeper', email: 'keeper@test.dev' })).body;
    expect((await admin.post(`/api/v1/customers/${other.id}/attachments`, { file_id: kept.body.id })).status).toBe(201);
    const refused = await admin.del(`/api/v1/files/${kept.body.id}`);
    expect([refused.status, refused.body.code]).toEqual([409, 'file_in_use']);
  });
});
