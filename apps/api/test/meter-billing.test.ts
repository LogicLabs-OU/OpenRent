import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounting, type Ctx } from '@openrent/core';
import { withTenant } from '@openrent/db';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Meter billing for construction rentals: what the meter ran beyond the included amount is charged at return. */
suite('meter billing', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let product: any;
  let unit: any;
  let customer: string;

  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, tenantId, (c) =>
      fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: 'http://shop.test', livemode: false }, logger: quietLogger }),
    );
  const booked = async (orderId: string) =>
    (
      await withTenant(t.deps.db, tenantId, (c) =>
        c.query(
          `SELECT e.kind, json_agg(json_build_array(l.account_key, l.debit::int, l.credit::int) ORDER BY l.position) AS lines
             FROM accounting_entries e JOIN accounting_entry_lines l ON l.entry_id = e.id WHERE e.order_id = $1 GROUP BY e.id ORDER BY e.number`,
          [orderId],
        ),
      )
    ).rows;

  beforeAll(async () => {
    let locationId: string;
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    product = (
      await admin.post('/api/v1/products', {
        type: 'rental', name: 'Excavator', tracking: 'serialized', buffer_after_min: 0, meter_unit: 'h', meter_rate: { amount: 1000, included: 8 },
        price: { kind: 'per_period', period_unit: 'day', amount: 20000 },
      })
    ).body;
    unit = (await admin.post('/api/v1/stock_items', { variant_id: product.variants[0].id, location_id: locationId, barcode: 'EX-1' })).body;
    customer = (await admin.post('/api/v1/customers', { name: 'Build Co', email: 'build@test.dev' })).body.id;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('checks the meter price', async () => {
    expect(product.meter_rate).toEqual({ amount: 1000, included: 8 });
    const noMeter = await admin.post('/api/v1/products', { type: 'rental', name: 'Plate', tracking: 'none', meter_rate: { amount: 100 }, price: { kind: 'per_period', period_unit: 'day', amount: 100 } });
    expect(noMeter.status).toBe(422);
    expect(noMeter.body.errors.map((e: any) => e.field)).toEqual(['meter_rate']);
    // Removing the meter removes its price.
    const other = (await admin.post('/api/v1/products', { type: 'rental', name: 'Roller', tracking: 'none', meter_unit: 'h', meter_rate: { amount: 500 }, price: { kind: 'per_period', period_unit: 'day', amount: 100 } })).body;
    expect((await admin.patch(`/api/v1/products/${other.id}`, { meter_unit: null })).body.meter_rate).toBeNull();
  });

  it('needs readings, charges the hours beyond the included ones on their own invoice and books it', async () => {
    const o = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(1), ends_at: isoIn(2), po_number: 'PO-77', lines: [{ variant_id: product.variants[0].id, quantity: 1 }] })).body;
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, {});
    await admin.post(`/api/v1/orders/${o.id}/actions/assign_units`, { barcodes: ['EX-1'] });
    const unread = await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, {});
    expect(unread.status).toBe(422);
    expect(unread.body.errors).toEqual([expect.objectContaining({ field: `meter_readings.${unit.id}`, code: 'required' })]);
    expect((await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, { meter_readings: [{ barcode: 'EX-1', value: 100 }] })).body.status).toBe('out');
    const first = (await admin.post(`/api/v1/orders/${o.id}/documents`, { type: 'invoice' })).body;
    expect(first.total.amount).toBe(24000);

    expect((await admin.post(`/api/v1/orders/${o.id}/actions/check_in`, { units: [{ barcode: 'EX-1', outcome: 'ok' }] })).status).toBe(422);
    const back = await admin.post(`/api/v1/orders/${o.id}/actions/check_in`, { units: [{ barcode: 'EX-1', outcome: 'ok' }], meter_readings: [{ barcode: 'EX-1', value: 112.5 }] });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    // 12.5 h used, 8 included: 4.5 h at 10.00, plus 20 % tax.
    const fee = back.body.lines.find((l: any) => l.type === 'fee');
    expect(fee).toMatchObject({ description: 'Excavator EX-1: 4.5 h beyond the 8 h included (100 to 112.5)', subtotal: { amount: 4500, currency: 'EUR' }, tax: { amount: 900, currency: 'EUR' }, total: { amount: 5400, currency: 'EUR' } });
    expect(back.body.totals.total.amount).toBe(29400);

    const docs = (await admin.get(`/api/v1/documents?order_id=${o.id}&type=invoice`)).body.data;
    expect(docs).toHaveLength(2);
    const extra = docs.find((d: any) => d.id !== first.id);
    expect(extra.total.amount).toBe(5400);
    const data = (await withTenant(t.deps.db, tenantId, (c) => c.query(`SELECT data FROM documents WHERE id = $1`, [extra.id]))).rows[0].data;
    expect(data.order.po_number).toBe('PO-77');
    expect(data.lines.map((l: any) => l.name)).toEqual(['Excavator EX-1: 4.5 h beyond the 8 h included (100 to 112.5)']);
    await inTenant((ctx) => accounting.postPending(ctx));
    const entries = await booked(o.id);
    expect(entries.map((e: any) => e.kind)).toEqual(['invoice', 'invoice']);
    expect(entries[1].lines).toEqual([['receivable', 5400, 0], expect.arrayContaining([expect.any(String), 0, 4500]), ['tax', 0, 900]]);
  });

  it('tells shoppers the meter price, with tax as the shop shows prices', async () => {
    const shop = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
    const p = (await shop.get(`/api/v1/storefront/catalog/products/${product.slug}`)).body;
    expect(p.meter).toMatchObject({ unit: 'h', included: 8, description: expect.stringMatching(/^8 h included; then .+ per h, charged at return$/) });
  });

  it('charges nothing within the included hours', async () => {
    const o = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(4), ends_at: isoIn(5), lines: [{ variant_id: product.variants[0].id, quantity: 1 }] })).body;
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, {});
    const out = await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, { barcodes: ['EX-1'], meter_readings: [{ barcode: 'EX-1', value: 113 }] });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    const back = (await admin.post(`/api/v1/orders/${o.id}/actions/check_in`, { all: true, meter_readings: [{ barcode: 'EX-1', value: 120 }] })).body;
    expect(back.status).toBe('returned');
    expect(back.lines.filter((l: any) => l.type === 'fee')).toEqual([]);
  });
});
