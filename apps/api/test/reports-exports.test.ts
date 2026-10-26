import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Local calendar date in the test shop's time zone, `days` from now. */
const tallinnDay = (days: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tallinn' }).format(new Date(Date.now() + days * 86400_000));

suite('availability forecast, list exports and unit calendars', () => {
  let t: TestApp;
  let admin: Client;
  let locationId: string;
  let bulk: string;

  beforeAll(async () => {
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Canoe', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 4000 } });
    bulk = p.body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${bulk}/${locationId}`, { quantity: 3 });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('forecasts free stock per variant and day', async () => {
    const c = await admin.post('/api/v1/customers', { name: 'Fore Cast', email: 'forecast@test.dev' });
    const o = await admin.post('/api/v1/orders', { customer_id: c.body.id, starts_at: isoIn(3, 9), ends_at: isoIn(5, 9), lines: [{ variant_id: bulk, quantity: 2 }] });
    await admin.post(`/api/v1/orders/${o.body.id}/actions/reserve`, { notify: false });

    const r = await admin.get(`/api/v1/reports/availability_forecast?from=${tallinnDay(0)}&to=${tallinnDay(10)}`);
    expect(r.status).toBe(200);
    const canoe = r.body.data.filter((x: any) => x.product === 'Canoe');
    expect(canoe).toHaveLength(10);
    expect(canoe[0]).toMatchObject({ date: tallinnDay(0), location: 'Main shop', capacity: 3, booked: 0, available: 3, shortage: false });
    expect(canoe.find((x: any) => x.date === tallinnDay(4))).toMatchObject({ booked: 2, available: 1 });
    expect(canoe.find((x: any) => x.date === tallinnDay(8))).toMatchObject({ booked: 0, available: 3 });

    // Defaults to the next 14 days.
    expect((await admin.get(`/api/v1/reports/availability_forecast?variant_id=${bulk}`)).body.data).toHaveLength(14);
    const tooLong = await admin.get(`/api/v1/reports/availability_forecast?from=${tallinnDay(0)}&to=${tallinnDay(90)}`);
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.errors[0].field).toBe('to');
    const csv = await t.app.inject({ method: 'GET', url: `/api/v1/reports/availability_forecast?variant_id=${bulk}&format=csv`, headers: { cookie: [...admin.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
    expect(csv.body.split('\r\n')[0]).toBe('\uFEFFdate,location,product,variant,capacity,booked,available,shortage');
  });

  it('exports the order and customer lists with their filters', async () => {
    const tricky = await admin.post('/api/v1/customers', { name: '=HYPERLINK("http://evil")', email: 'tricky@test.dev' });
    const quote = await admin.post('/api/v1/orders', { customer_id: tricky.body.id, starts_at: isoIn(6), ends_at: isoIn(7), lines: [{ variant_id: bulk, quantity: 1 }] });
    const reserved = (await admin.get('/api/v1/orders?filter[status]=reserved')).body.data;

    const res = await admin.get('/api/v1/orders/export?filter[status]=reserved&format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="orders-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = String(res.body).trim().split('\r\n');
    expect(lines[0]).toBe('number,status,payment_status,source,customer,customer_email,location,starts_at,ends_at,currency,subtotal,discount,tax,total,deposit,paid,balance,tags,created_at');
    expect(lines).toHaveLength(reserved.length + 1);
    expect(lines.some((l) => l.startsWith(`${quote.body.number},`))).toBe(false);

    const all = await admin.get('/api/v1/orders/export');
    expect(String(all.body)).toContain(`${quote.body.number},draft,`);
    // Spreadsheet formulas from customer input are neutralised.
    expect(String(all.body)).toContain(`"'=HYPERLINK(""http://evil"")"`);

    const xlsx = await t.app.inject({ method: 'GET', url: '/api/v1/customers/export?q=tricky&format=xlsx', headers: { cookie: [...admin.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.rawPayload as any);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(1).getCell(1).value).toBe('name');
    expect(ws.rowCount).toBe(2);
    expect(ws.getRow(2).getCell(3).value).toBe('tricky@test.dev');
    expect((await admin.get('/api/v1/orders/export?filter[nope]=1')).status).toBe(400);
  });

  it('serves one unit’s bookings and downtime as an iCal feed', async () => {
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'E-bike', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 6000 } });
    const variant = p.body.variants[0].id;
    const unit = await admin.post('/api/v1/stock_items', { variant_id: variant, location_id: locationId, barcode: 'EB-001' });
    expect(unit.status).toBe(201);
    const c = await admin.post('/api/v1/customers', { name: 'Unit Rider', email: 'rider@test.dev' });
    const o = await admin.post('/api/v1/orders', { customer_id: c.body.id, starts_at: isoIn(2), ends_at: isoIn(4), lines: [{ variant_id: variant, quantity: 1, stock_item_ids: [unit.body.id] }] });
    expect((await admin.post(`/api/v1/orders/${o.body.id}/actions/reserve`, { notify: false })).status).toBe(200);
    expect((await admin.post('/api/v1/downtimes', { stock_item_id: unit.body.id, starts_at: isoIn(10), ends_at: isoIn(12), reason: 'Service' })).status).toBe(201);

    expect((await admin.post('/api/v1/calendar_feeds', { name: 'Bike', stock_item_id: 'sti_missing' })).body.errors[0].field).toBe('stock_item_id');
    const feed = await admin.post('/api/v1/calendar_feeds', { name: 'Unit EB-001', stock_item_id: unit.body.id, location_id: locationId });
    expect(feed.status).toBe(201);
    expect(feed.body).toMatchObject({ stock_item_id: unit.body.id, location_id: null });
    expect((await admin.get(`/api/v1/calendar_feeds?stock_item_id=${unit.body.id}`)).body.data).toMatchObject([{ id: feed.body.id, stock_item_label: 'EB-001' }]);

    const ics = (await t.app.inject({ method: 'GET', url: new URL(feed.body.url).pathname })).body.replace(/\r\n /g, '');
    expect(ics).toContain(`SUMMARY:#${o.body.number} · Unit Rider`);
    expect(ics).toContain('SUMMARY:Unavailable Service');
    // Only this unit: pickups and returns of other orders are not in it.
    expect(ics).not.toContain('Pickup');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });
});
