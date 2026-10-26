import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { servicing, type Ctx } from '@openrent/core';
import { withTenant } from '@openrent/db';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Meters, service intervals and depreciation (FR-CAT-10, FR-MNT-4). */
suite('meters, service and depreciation', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let locationId: string;
  let scooter: string;
  let scooterProduct: string;
  let helmet: string;
  let customer: string;
  const units: Record<string, string> = {};
  const intervals: Record<string, string> = {};

  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, tenantId, (c) =>
      fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: '', livemode: false }, logger: quietLogger }),
    );
  const reading = (code: string, value: number) => admin.post(`/api/v1/stock_items/${units[code]}/actions/add_meter_reading`, { value });
  const due = async () => (await admin.get('/api/v1/service_due')).body.data.map((d: any) => [d.stock_item.barcode, d.interval.name, d.status]);
  const yearAgo = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    const p = (await admin.post('/api/v1/products', { type: 'rental', name: 'E-scooter', tracking: 'serialized', meter_unit: 'km', depreciation_months: 36, residual_bp: 1000, price: { kind: 'per_period', period_unit: 'day', amount: 2500 } })).body;
    scooterProduct = p.id;
    scooter = p.variants[0].id;
    expect([p.meter_unit, p.depreciation_months, p.residual_bp]).toEqual(['km', 36, 1000]);
    helmet = (await admin.post('/api/v1/products', { type: 'rental', name: 'Helmet', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 300 } })).body.variants[0].id;
    for (const [b, v] of [['SC-1', scooter], ['SC-2', scooter], ['HM-1', helmet]] as const)
      units[b] = (await admin.post('/api/v1/stock_items', { variant_id: v, location_id: locationId, barcode: b, purchase_price: 120000, purchase_date: yearAgo })).body.id;
    customer = (await admin.post('/api/v1/customers', { name: 'Meter Rider', email: 'meter@test.dev' })).body.id;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('records meter readings that never go down', async () => {
    expect((await reading('SC-1', 100)).body).toMatchObject({ value: 100, source: 'manual' });
    const lower = await reading('SC-1', 90);
    expect([lower.status, lower.body.errors[0].field]).toEqual([422, 'value']);
    expect(lower.body.errors[0].message).toContain('100 km');
    expect((await reading('HM-1', 5)).body.errors[0].code).toBe('no_meter');
    expect((await admin.get(`/api/v1/stock_items/${units['SC-1']}/meter_readings`)).body.data.map((r: any) => r.value)).toEqual([100]);
    // The database refuses a lower reading too.
    await expect(
      withTenant(t.deps.db, tenantId, (c) => c.query(`INSERT INTO meter_readings (id, tenant_id, stock_item_id, value) VALUES ('mtr_x', $1, $2, 1)`, [tenantId, units['SC-1']])),
    ).rejects.toThrow(/cannot be lower/);
  });

  it('takes readings at pickup and return, field by field', async () => {
    const o = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(0, 23), ends_at: isoIn(1, 23), lines: [{ variant_id: scooter, quantity: 1 }] })).body;
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, {});
    await admin.post(`/api/v1/orders/${o.id}/actions/assign_units`, { barcodes: ['SC-1'] });
    const out = await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, { meter_readings: [{ barcode: 'SC-1', value: 120 }] });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    const bad = await admin.post(`/api/v1/orders/${o.id}/actions/check_in`, { all: true, meter_readings: [{ barcode: 'SC-1', value: 110 }] });
    expect([bad.status, bad.body.errors[0].field]).toEqual([422, 'meter_readings[0].value']);
    expect((await admin.get(`/api/v1/orders/${o.id}`)).body.status).toBe('out');
    expect((await admin.post(`/api/v1/orders/${o.id}/actions/check_in`, { all: true, meter_readings: [{ barcode: 'SC-1', value: 460 }] })).status).toBe(200);
    const readings = (await admin.get(`/api/v1/stock_items/${units['SC-1']}/meter_readings`)).body.data;
    expect(readings.map((r: any) => [r.value, r.source, r.order_id])).toEqual([[460, 'check_in', o.id], [120, 'check_out', o.id], [100, 'manual', null]]);
  });

  it('refuses incomplete intervals field by field', async () => {
    const none = await admin.post('/api/v1/service_intervals', { name: 'Nothing' });
    expect([none.status, none.body.errors.map((e: any) => e.field)]).toEqual([422, ['every_days']]);
    const cat = (await admin.post('/api/v1/categories', { name: 'Scooters' })).body.id;
    const both = await admin.post('/api/v1/service_intervals', { name: 'Both', product_id: scooterProduct, category_id: cat, every_days: 10 });
    expect(both.body.errors.map((e: any) => e.field)).toEqual(['category_id']);
    const meterless = await admin.post('/api/v1/service_intervals', { name: 'Km', product_id: (await admin.get(`/api/v1/products?q=Helmet`)).body.data[0].id, every_meter: 100 });
    expect(meterless.body.errors.map((e: any) => e.field)).toEqual(['every_meter']);
  });

  it('lists services that are due by days, rentals or meter', async () => {
    intervals.km = (await admin.post('/api/v1/service_intervals', { name: 'Tyres', product_id: scooterProduct, every_meter: 500 })).body.id;
    intervals.rentals = (await admin.post('/api/v1/service_intervals', { name: 'Clean', product_id: scooterProduct, every_rentals: 2, opens_ticket: false })).body.id;
    // SC-1 has done 460 of 500 km and one of two rentals: both due soon. SC-2 never rented, no readings.
    expect(await due()).toEqual([['SC-1', 'Clean', 'due_soon'], ['SC-1', 'Tyres', 'due_soon']]);
    await reading('SC-1', 520);
    expect(await due()).toContainEqual(['SC-1', 'Tyres', 'overdue']);
    intervals.yearly = (await admin.post('/api/v1/service_intervals', { name: 'Yearly check', every_days: 300 })).body.id;
    // Bought a year ago: every unit is past its yearly check.
    expect((await admin.get(`/api/v1/service_due?interval_id=${intervals.yearly}`)).body.data.map((d: any) => [d.stock_item.barcode, d.status])).toEqual([
      ['HM-1', 'overdue'], ['SC-1', 'overdue'], ['SC-2', 'overdue'],
    ]);
  });

  it('opens one service ticket per overdue unit and keeps it in service; resolving it records the service', async () => {
    await admin.del(`/api/v1/service_intervals/${intervals.yearly}`);
    const first = await inTenant((ctx) => servicing.runServiceDue(ctx));
    expect(first).toEqual({ overdue: 1, tickets: 1 });
    expect(await inTenant((ctx) => servicing.runServiceDue(ctx))).toEqual({ overdue: 1, tickets: 0 });
    const tk = (await admin.get('/api/v1/maintenance_tickets')).body.data.find((x: any) => x.service_interval_id === intervals.km);
    expect(tk.title).toBe('Service due: Tyres (SC-1)');
    expect((await admin.get(`/api/v1/stock_items/${units['SC-1']}`)).body.status).toBe('available');
    const notices = (await admin.get('/api/v1/me/notifications')).body.data.filter((n: any) => n.kind === 'staff_service_due');
    expect(notices).toHaveLength(1);

    expect((await admin.post(`/api/v1/maintenance_tickets/${tk.id}/actions/resolve`, { resolution: 'New tyres' })).status).toBe(200);
    expect((await admin.get('/api/v1/service_due?status=overdue')).body.data).toEqual([]);
    const upkeep = (await admin.get(`/api/v1/stock_items/${units['SC-1']}/upkeep`)).body;
    expect(upkeep.service.history.map((e: any) => [e.interval_name, e.meter_value, e.ticket_id])).toEqual([['Tyres', 520, tk.id]]);
    expect(upkeep.meter).toMatchObject({ unit: 'km', value: 520 });
  });

  it('records a service by hand', async () => {
    const r = await admin.post(`/api/v1/stock_items/${units['SC-1']}/actions/record_service`, { interval_id: intervals.rentals, notes: 'Washed' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await due()).filter((d: any) => d[1] === 'Clean')).toEqual([]);
    expect((await admin.post(`/api/v1/stock_items/${units['SC-1']}/actions/record_service`, { interval_id: 'svi_nope' })).body.errors[0].field).toBe('interval_id');
  });

  it('works out the straight-line book value of each unit', async () => {
    const d = (await admin.get(`/api/v1/stock_items/${units['SC-2']}/upkeep`)).body.depreciation;
    // 1200.00 down to 120.00 over 36 months: 30.00 a month, about 12 months gone.
    expect([d.purchase_price, d.residual_value, d.monthly, d.life_months]).toEqual([120000, 12000, 3000, 36]);
    expect(Math.abs(d.book_value - 84000)).toBeLessThan(600);
    expect((await admin.get(`/api/v1/stock_items/${units['HM-1']}/upkeep`)).body.depreciation).toBeNull();
    const report = (await admin.get('/api/v1/reports/depreciation?group_by=location')).body.data;
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ location: 'Main shop', units: 2, purchase_price: 240000 });
    expect(Math.abs(report[0].book_value - 168000)).toBeLessThan(1200);
  });
});
