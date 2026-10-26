import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem } from '@openrent/db';
import { startBooqableFake, startSnipeItFake, type BooqableFake, type SnipeItFake } from '@openrent/import-fakes';
import { publishOutbox, runJobs } from '../../worker/src/jobs.ts';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/**
 * Moving to OpenRent (FR-MIG-2): files with their own column names, customers and bookings, and the
 * Shelf.nu, Booqable and Snipe-IT importers against fakes, checked together and applied in one job.
 */
suite('migrations from files and other systems', () => {
  let t: TestApp;
  let admin: Client;
  let booqable: BooqableFake;
  let snipe: SnipeItFake;
  const sql = (text: string, values: unknown[] = []) => withSystem(t.deps.db, async (c) => (await c.query(text, values)).rows);
  const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n'));
  const upload = async (name: string, rows: string[][]) => (await admin.upload('/api/v1/files?purpose=import', name, 'text/csv', csv(rows))).body.id as string;
  const day = (offset: number) => isoIn(offset).slice(0, 10);

  beforeAll(async () => {
    ({ t, admin } = await shopForTests(dbinfo!));
    process.env.IMPORTS_ALLOW_PRIVATE_NETWORK = 'true';
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Canoe', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 4000 }, variants: [{ name: 'Canoe', sku: 'CANOE', tracking: 'bulk' }] });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const loc = (await admin.get('/api/v1/locations')).body.data[0].id;
    await admin.put(`/api/v1/stock_levels/${p.body.variants[0].id}/${loc}`, { quantity: 3 });
    booqable = await startBooqableFake({
      customers: [{ id: 'bq-c1', name: 'Bea Booq', email: 'bea@booq.test', phone: '+3725550301' }, { id: 'bq-c2', name: 'Bob Booq', email: null }],
      product_groups: [
        { id: 'bq-g1', name: 'Tandem bike', slug: 'tandem-bike', sku: 'TANDEM', description: 'For two', trackable: false, base_price_in_cents: 3500, price_period: 'day', tag_list: ['bikes'], show_in_store: true, archived: false },
        { id: 'bq-g2', name: 'Old tent', slug: 'old-tent', sku: 'TENT-OLD', trackable: false, base_price_in_cents: 1000, price_period: 'day', archived: true },
      ],
      products: [{ id: 'bq-p1', product_group_id: 'bq-g1', sku: 'TANDEM' }],
      orders: [
        { id: 'bq-o1', number: 501, status: 'reserved', starts_at: isoIn(10), stops_at: isoIn(12), customer_id: 'bq-c1', lines: [{ title: 'Tandem bike', quantity: 1, item_id: 'bq-p1' }] },
        { id: 'bq-o2', number: 502, status: 'stopped', starts_at: isoIn(-20), stops_at: isoIn(-18), customer_id: 'bq-c2', lines: [{ title: 'Tandem bike', quantity: 2, item_id: 'bq-g1' }] },
        { id: 'bq-o3', number: 503, status: 'canceled', starts_at: isoIn(30), stops_at: isoIn(31), customer_id: 'bq-c1', lines: [{ title: 'Tandem bike', quantity: 1, item_id: 'bq-p1' }] },
      ],
    });
    snipe = await startSnipeItFake({
      models: [{ id: 7, name: 'Projector X1', model_number: 'PX1', category: { name: 'AV &amp; Light' } }, { id: 8, name: 'Laptop', model_number: null, category: { name: 'IT' } }],
      hardware: [
        { id: 1, asset_tag: 'AV-001', serial: 'S1', model: { id: 7 }, status_label: { status_meta: 'deployable' }, location: { name: 'Main shop' }, purchase_date: { date: '2025-03-01' }, purchase_cost: '1,250.00', notes: 'Lens cap' },
        { id: 2, asset_tag: 'AV-002', serial: 'S2', model: { id: 7 }, status_label: { status_meta: 'archived' }, location: null },
        { id: 3, asset_tag: 'IT-001', serial: 'L1', model: { id: 8 }, status_label: { status_meta: 'deployable' }, location: { name: 'Warehouse that does not exist' }, purchase_cost: null },
      ],
    });
  }, 120_000);

  afterAll(async () => {
    delete process.env.IMPORTS_ALLOW_PRIVATE_NETWORK;
    await booqable?.close();
    await snipe?.close();
    await t?.close();
    await dbinfo?.stop();
  });

  it('maps a file’s own columns, and remembers the mapping for the next file', async () => {
    const rows = [['Full Name', 'E-Mail', 'Mobile', 'Kundennummer', 'Firma'], ['Carla Csv', 'carla@csv.test', '+3725550401', 'K-1', ''], ['Dora Firm', 'dora@csv.test', '', 'K-2', 'Dora GmbH']];
    const first = (await admin.post('/api/v1/imports', { entity: 'customers', file_id: await upload('kunden.csv', rows) })).body;
    expect(first.report.columns).toEqual({ 'Full Name': 'name', 'E-Mail': 'email', Mobile: 'phone' });
    expect(first.report.unknown_columns).toEqual(['Kundennummer', 'Firma']);
    expect(first.report.headers).toEqual(['Full Name', 'E-Mail', 'Mobile', 'Kundennummer', 'Firma']);
    const cols = (await admin.get('/api/v1/imports/columns/customers')).body.data;
    expect(cols.find((c: any) => c.key === 'name')).toEqual({ key: 'name', required: true });
    const mapped = (await admin.patch(`/api/v1/imports/${first.id}`, { mapping: { Kundennummer: 'reference', Firma: 'company_name', Mobile: '' } })).body;
    expect(mapped.report.columns).toEqual({ 'Full Name': 'name', 'E-Mail': 'email', Kundennummer: 'reference', Firma: 'company_name' });
    expect(mapped.report.counts).toEqual({ create: 2, update: 0, unchanged: 0, error: 0 });
    // The same export again: mapped by itself.
    const again = (await admin.post('/api/v1/imports', { entity: 'customers', file_id: await upload('kunden-2.csv', rows) })).body;
    expect(again.mapping).toEqual({ Kundennummer: 'reference', Firma: 'company_name', Mobile: '' });
    expect((await admin.post(`/api/v1/imports/${again.id}/actions/apply`)).status).toBe(200);
    const [dora] = await sql(`SELECT type, company_name, phone, provider_refs FROM customers WHERE email = 'dora@csv.test'`);
    expect(dora).toMatchObject({ type: 'company', company_name: 'Dora GmbH', phone: null, provider_refs: { import: 'K-2' } });
    const events = await sql(`SELECT 1 FROM outbox WHERE event_type = 'import.completed' AND aggregate_id = $1`, [again.id]);
    expect(events).toHaveLength(1);
  });

  it('imports bookings: upcoming ones hold stock, past ones are history, and nothing twice', async () => {
    const rows = [
      ['Booking', 'Customer number', 'SKU', 'Qty', 'Start', 'End', 'Status'],
      ['W-1', 'K-1', 'CANOE', '2', `${day(8)} 10:00`, `${day(9)} 18:00`, 'confirmed'],
      ['W-2', 'K-2', 'CANOE', '1', `${day(-30)} 10:00`, `${day(-29)} 10:00`, ''],
      ['W-3', 'K-9', 'NOPE', '1', `${day(5)} 10:00`, `${day(4)} 10:00`, 'reserved'],
    ];
    const imp = (await admin.post('/api/v1/imports', { entity: 'orders', file_id: await upload('bookings.csv', rows) })).body;
    expect(imp.report.counts).toEqual({ create: 2, update: 0, unchanged: 0, error: 1 });
    expect(imp.report.rows.find((r: any) => r.key === 'W-3').errors.map((e: any) => e.field)).toEqual(['ends_at']);
    const fixed = (await admin.post('/api/v1/imports', { entity: 'orders', file_id: await upload('bookings.csv', rows.slice(0, 3)) })).body;
    expect((await admin.post(`/api/v1/imports/${fixed.id}/actions/apply`)).status).toBe(200);
    const orders = await sql(`SELECT o.status, o.source, o.external_ref, o.starts_at, c.email, (SELECT count(*)::int FROM allocations a WHERE a.order_id = o.id) AS allocations FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.source = 'import' ORDER BY o.starts_at`);
    expect(orders.map((o) => [o.external_ref, o.status, o.email, o.allocations > 0])).toEqual([['import:W-2', 'closed', 'dora@csv.test', false], ['import:W-1', 'reserved', 'carla@csv.test', true]]);
    // 10:00 in the shop's zone (Tallinn), not UTC.
    expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Tallinn', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(orders[1].starts_at)))
      .toBe(`${day(8).split('-').reverse().join('/')}, 10:00`);
    const twice = (await admin.post('/api/v1/imports', { entity: 'orders', file_id: await upload('bookings.csv', rows.slice(0, 3)) })).body;
    expect(twice.report.counts).toEqual({ create: 0, update: 0, unchanged: 2, error: 0 });
  });

  it('moves from Shelf.nu: assets with the same name become one product with its units', async () => {
    const file = await upload('shelf-assets.csv', [
      ['Name', 'Description', 'Category', 'Location', 'Tags', 'Valuation', 'QR code ID'],
      ['Camera A7', 'Full frame', 'Cameras', 'Main shop', 'video, photo', '1800', 'qr-a7-1'],
      ['Camera A7', 'Full frame', 'Cameras', 'Elsewhere', 'video, photo', '1750.50', 'qr-a7-2'],
      ['Tripod', '', 'Grip', '', '', '', 'qr-tri-1'],
    ]);
    const batch = await admin.post('/api/v1/import_batches', { source: 'shelf', file_id: file });
    expect(batch.status, JSON.stringify(batch.body)).toBe(201);
    expect(batch.body).toMatchObject({ object: 'import_batch', source: 'shelf', status: 'validated' });
    expect(batch.body.imports.map((i: any) => [i.entity, i.report.counts])).toEqual([
      ['products', { create: 2, update: 0, unchanged: 0, error: 0 }],
      ['stock_items', { create: 3, update: 0, unchanged: 0, error: 0 }],
    ]);
    const applying = await admin.post(`/api/v1/import_batches/${batch.body.id}/actions/apply`);
    expect([applying.status, applying.body.status]).toEqual([202, 'applying']);
    expect(await runJobs(t.deps, quietLogger)).toBe(1);
    const done = (await admin.get(`/api/v1/import_batches/${batch.body.id}`)).body;
    expect(done.status).toBe('applied');
    const units = await sql(`SELECT s.barcode, s.purchase_price, p.name, l.name AS location FROM stock_items s JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id JOIN locations l ON l.id = s.location_id WHERE s.barcode LIKE 'qr-%' ORDER BY s.barcode`);
    expect(units.map((u) => [u.barcode, u.name, Number(u.purchase_price ?? 0), u.location])).toEqual([['qr-a7-1', 'Camera A7', 180000, 'Main shop'], ['qr-a7-2', 'Camera A7', 175050, 'Main shop'], ['qr-tri-1', 'Tripod', 0, 'Main shop']]);
    await publishOutbox(t.deps, quietLogger);
    expect(await sql(`SELECT 1 FROM outbox WHERE event_type = 'import.completed' AND aggregate_id = $1`, [batch.body.id])).toHaveLength(1);
  });

  it('checks the connection details of a remote system', async () => {
    const r = await admin.post('/api/v1/import_batches', { source: 'booqable', api_key: '' });
    expect([r.status, r.body.errors.map((e: any) => e.field).sort()]).toEqual([422, ['api_key', 'company']]);
    expect((await admin.post('/api/v1/import_batches', { source: 'booqable', company: 'not a name!', api_key: 'x' })).body.errors[0].field).toBe('company');
    delete process.env.IMPORTS_ALLOW_PRIVATE_NETWORK;
    const local = await admin.post('/api/v1/import_batches', { source: 'snipeit', base_url: 'http://10.0.0.5', api_key: 'x' });
    expect([local.status, local.body.errors[0].code]).toEqual([422, 'https_required']);
    process.env.IMPORTS_ALLOW_PRIVATE_NETWORK = 'true';
  });

  it('moves from Booqable: customers, products and bookings, read and applied in the background', async () => {
    const created = await admin.post('/api/v1/import_batches', { source: 'booqable', base_url: booqable.url, api_key: booqable.apiKey });
    expect([created.status, created.body.status]).toEqual([201, 'fetching']);
    // The key stays with the job, encrypted, and is never shown.
    const job = (await admin.get(`/api/v1/jobs/${created.body.job_id}`)).body;
    expect(job.params).toEqual({ batch_id: created.body.id, source: 'booqable', company: null, base_url: booqable.url });
    expect(JSON.stringify(await sql(`SELECT params FROM jobs WHERE id = $1`, [job.id]))).not.toContain(booqable.apiKey);
    expect(await runJobs(t.deps, quietLogger)).toBe(1);
    expect(booqable.calls.some((c) => c.startsWith('/api/1/orders/bq-o1?'))).toBe(true);
    const batch = (await admin.get(`/api/v1/import_batches/${created.body.id}`)).body;
    expect(batch.status).toBe('validated');
    expect(batch.imports.map((i: any) => [i.entity, i.report.counts.create, i.report.counts.error])).toEqual([['customers', 2, 0], ['products', 1, 0], ['orders', 3, 0]]);
    await admin.post(`/api/v1/import_batches/${batch.id}/actions/apply`);
    expect(await runJobs(t.deps, quietLogger)).toBe(1);
    expect((await admin.get(`/api/v1/import_batches/${batch.id}`)).body.status).toBe('applied');
    const [tandem] = await sql(`SELECT p.visibility, p.tags, ps.amount, v.tracking FROM products p JOIN variants v ON v.product_id = p.id LEFT JOIN price_structures ps ON ps.id = v.price_structure_id WHERE v.sku = 'TANDEM'`);
    expect([tandem.visibility, tandem.tags, Number(tandem.amount), tandem.tracking]).toEqual(['public', ['bikes'], 3500, 'bulk']);
    const orders = await sql(`SELECT external_ref, status FROM orders WHERE external_ref LIKE 'booqable:%' ORDER BY external_ref`);
    expect(orders.map((o) => [o.external_ref, o.status])).toEqual([['booqable:501', 'reserved'], ['booqable:502', 'closed'], ['booqable:503', 'cancelled']]);
    const [bea] = await sql(`SELECT provider_refs, phone FROM customers WHERE email = 'bea@booq.test'`);
    expect(bea).toMatchObject({ provider_refs: { booqable: 'bq-c1' }, phone: '+3725550301' });
    // Booked without stock in OpenRent yet: it comes in and waits as an overbooking.
    expect((await sql(`SELECT count(*)::int AS n FROM overbookings o JOIN orders r ON r.id = o.order_id WHERE r.external_ref = 'booqable:501' AND o.resolved_at IS NULL`))[0].n).toBe(1);
  });

  it('moves from Snipe-IT: models and assets, without archived ones; a bad token fails the batch with a reason', async () => {
    const bad = (await admin.post('/api/v1/import_batches', { source: 'snipeit', base_url: snipe.url, api_key: 'wrong' })).body;
    await runJobs(t.deps, quietLogger);
    expect((await admin.get(`/api/v1/import_batches/${bad.id}`)).body).toMatchObject({ status: 'failed', error: 'Snipe-IT refused the key: check it and its permissions' });

    const ok = (await admin.post('/api/v1/import_batches', { source: 'snipeit', base_url: `${snipe.url}/`, api_key: snipe.token })).body;
    await runJobs(t.deps, quietLogger);
    const batch = (await admin.get(`/api/v1/import_batches/${ok.id}`)).body;
    expect(batch.imports.map((i: any) => [i.entity, i.report.counts.create])).toEqual([['products', 2], ['stock_items', 2]]);
    await admin.post(`/api/v1/import_batches/${ok.id}/actions/apply`);
    await runJobs(t.deps, quietLogger);
    const units = await sql(`SELECT s.barcode, s.serial, s.notes, s.purchase_price, v.sku FROM stock_items s JOIN variants v ON v.id = s.variant_id WHERE v.sku IN ('PX1', 'SNIPE-8') ORDER BY s.barcode`);
    expect(units.map((u) => [u.barcode, u.serial, u.sku, u.purchase_price == null ? null : Number(u.purchase_price), u.notes])).toEqual([['AV-001', 'S1', 'PX1', 125000, 'Lens cap'], ['IT-001', 'L1', 'SNIPE-8', null, '']]);
    expect((await sql(`SELECT c.name FROM categories c JOIN product_categories pc ON pc.category_id = c.id JOIN variants v ON v.product_id = pc.product_id WHERE v.sku = 'PX1'`))[0].name).toBe('AV & Light');
  });
});
