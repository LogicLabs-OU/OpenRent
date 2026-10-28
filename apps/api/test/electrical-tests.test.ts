import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { servicing } from '@openrent/core';
import pg from 'pg';
import { withTenant } from '@openrent/db';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** FR-MNT-5: electrical safety (PAT) tests, due dates, certificates and the pickup check. */
suite('electrical safety tests', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let variant: string;
  let product: string;
  let interval: string;
  const units: Record<string, string> = {};

  beforeAll(async () => {
    ({ t, admin, tenantId } = await shopForTests(dbinfo!));
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Floor sander', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 4500 } });
    product = p.body.id;
    variant = p.body.variants[0].id;
    const loc = (await admin.get('/api/v1/locations')).body.data[0].id;
    for (const b of ['SANDER-1', 'SANDER-2']) units[b] = (await admin.post('/api/v1/stock_items', { variant_id: variant, location_id: loc, barcode: b })).body.id;
  }, 120_000);
  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('makes a yearly test interval, due by days only', async () => {
    const bad = await admin.post('/api/v1/service_intervals', { name: 'PAT', kind: 'electrical_test', product_id: product, every_rentals: 10 });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((e: any) => e.field)).toContain('every_days');
    const ok = await admin.post('/api/v1/service_intervals', { name: 'PAT yearly', kind: 'electrical_test', product_id: product, every_days: 365 });
    expect(ok.status).toBe(201);
    expect(ok.body.kind).toBe('electrical_test');
    interval = ok.body.id;
    const st = (await admin.get(`/api/v1/stock_items/${units['SANDER-1']}/electrical_tests`)).body.status;
    expect(st).toMatchObject({ required: true, expired: true, last_test: null });
  });

  it('records a pass with its readings, which counts as the service, and refuses a test without what it needs', async () => {
    const bad = await admin.post(`/api/v1/stock_items/${units['SANDER-1']}/electrical_tests`, { result: 'pass', appliance_class: 'I', tester: ' ', readings: { insulation_mohm: -1 } });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((e: any) => e.field).sort()).toEqual(['readings.earth_ohm', 'readings.insulation_mohm', 'tester']);
    const r = await admin.post(`/api/v1/stock_items/${units['SANDER-1']}/electrical_tests`, {
      result: 'pass', appliance_class: 'I', tester: 'Kaur Tamm', instrument: 'Seaward PrimeTest 250+', readings: { earth_ohm: 0.08, insulation_mohm: 200, leakage_ma: 0.12, polarity_ok: true, visual_ok: true },
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ result: 'pass', interval_id: interval, readings: { earth_ohm: 0.08 } });
    expect(r.body.next_due).toBe(new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10));
    const list = (await admin.get(`/api/v1/stock_items/${units['SANDER-1']}/electrical_tests`)).body;
    expect(list.status.expired).toBe(false);
    expect(list.data).toHaveLength(1);
    const events = await withTenant(t.deps.db, tenantId, (c) => c.query(`SELECT interval_id FROM service_events WHERE stock_item_id = $1`, [units['SANDER-1']]));
    expect(events.rows).toEqual([{ interval_id: interval }]);
    // The certificate: a PDF, made from this page.
    const cert = await t.app.inject({ method: 'GET', url: `/api/v1/electrical_tests/${r.body.id}/certificate`, headers: { cookie: [...admin.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
    expect([cert.statusCode, cert.headers['content-type']]).toEqual([200, 'application/pdf']);
    const html = await withTenant(t.deps.db, tenantId, (db) => servicing.certificateHtml({ db, tenantId } as any, r.body.id));
    for (const s of ['SANDER-1', 'Kaur Tamm', 'Seaward PrimeTest 250+', '0.08 Ω', '200 MΩ', 'Result: passed']) expect(html).toContain(s);
    // A record of what was measured: never changed afterwards.
    await expect(withTenant(t.deps.db, tenantId, (c) => c.query(`UPDATE electrical_tests SET result = 'fail' WHERE id = $1`, [r.body.id]))).rejects.toThrow(/cannot be changed/);
  });

  it('will not let a unit out without a valid test, at the scan and at pickup', async () => {
    const c = await admin.post('/api/v1/customers', { name: 'Floor Fixer', email: 'floors@test.dev' });
    const o = await admin.post('/api/v1/orders', { customer_id: c.body.id, starts_at: isoIn(0, 23), ends_at: isoIn(2), lines: [{ variant_id: variant, quantity: 1 }], deposit: { mode: 'none' } });
    await admin.post(`/api/v1/orders/${o.body.id}/actions/reserve`, { notify: false });
    const never = await admin.post(`/api/v1/orders/${o.body.id}/actions/assign_units`, { barcodes: ['SANDER-2'] });
    expect([never.status, never.body.code]).toEqual([409, 'electrical_test_expired']);
    expect(never.body.detail).toContain('SANDER-2');
    expect((await admin.post(`/api/v1/orders/${o.body.id}/actions/assign_units`, { barcodes: ['SANDER-1'] })).status).toBe(200);

    // SANDER-1's test runs out after it was put on the order: pickup stops.
    // (As the owner, past the append-only rule, to move the test back in time.)
    const owner = new pg.Client({ connectionString: dbinfo!.url });
    await owner.connect();
    await owner.query(`ALTER TABLE electrical_tests DISABLE TRIGGER electrical_tests_append_only`);
    await owner.query(`UPDATE electrical_tests SET tested_at = now() - interval '400 days' WHERE stock_item_id = $1`, [units['SANDER-1']]);
    await owner.query(`ALTER TABLE electrical_tests ENABLE TRIGGER electrical_tests_append_only`);
    await owner.end();
    const out = await admin.post(`/api/v1/orders/${o.body.id}/actions/check_out`, {});
    expect([out.status, out.body.code]).toEqual([409, 'electrical_test_expired']);

    // A failed test takes SANDER-2 out of service; a pass afterwards lets it go.
    const fail = await admin.post(`/api/v1/stock_items/${units['SANDER-2']}/electrical_tests`, { result: 'fail', appliance_class: 'I', tester: 'Kaur Tamm', readings: { insulation_mohm: 0.3 }, notes: 'Cracked plug' });
    expect(fail.body.ticket_id).toBeTruthy();
    expect((await admin.get(`/api/v1/stock_items/${units['SANDER-2']}`)).body.status).toBe('hard_down');
    expect((await admin.get(`/api/v1/stock_items/${units['SANDER-2']}/electrical_tests`)).body.status.expired).toBe(true);
    await admin.post(`/api/v1/stock_items/${units['SANDER-1']}/electrical_tests`, { result: 'pass', appliance_class: 'II', tester: 'Kaur Tamm' });
    const picked = await admin.post(`/api/v1/orders/${o.body.id}/actions/check_out`, {});
    expect(picked.status, JSON.stringify(picked.body)).toBe(200);
  });
});
