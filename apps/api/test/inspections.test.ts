import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@openrent/db';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Inspection checklists (FR-MNT-3). */
suite('inspection checklists', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let locationId: string;
  let templateId: string;
  let ebike: string;
  let plain: string;
  const units: Record<string, string> = {};

  const status = async (code: string) => (await admin.get(`/api/v1/stock_items/${units[code]}`)).body.status;
  const run = (code: string, results: unknown[]) => admin.post(`/api/v1/stock_items/${units[code]}/inspections`, { results });
  const ITEMS = [
    { label: { en: 'Brakes', de: 'Bremsen' }, kind: 'check', fail_status: 'hard_down' },
    { label: { en: 'Battery charge %' }, kind: 'number', min: 80 },
    { label: { en: 'Lights' }, kind: 'check' },
    { label: { en: 'Remarks' }, kind: 'text', required: false },
  ];

  beforeAll(async () => {
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    const cat = (await admin.post('/api/v1/categories', { name: 'E-bikes' })).body.id;
    const p = (await admin.post('/api/v1/products', { type: 'rental', name: 'City e-bike', tracking: 'serialized', category_ids: [cat], price: { kind: 'per_period', period_unit: 'day', amount: 3000 } })).body;
    ebike = p.variants[0].id;
    plain = (await admin.post('/api/v1/products', { type: 'rental', name: 'Helmet', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 500 } })).body.variants[0].id;
    for (const [b, v] of [['EB-1', ebike], ['EB-2', ebike], ['EB-3', ebike], ['HL-1', plain]] as const) units[b] = (await admin.post('/api/v1/stock_items', { variant_id: v, location_id: locationId, barcode: b })).body.id;
    units.cat = cat;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('refuses incomplete templates field by field', async () => {
    const r = await admin.post('/api/v1/inspection_templates', { name: ' ', items: [{ label: { de: 'Nur deutsch' }, kind: 'check' }, { label: { en: 'Odd' }, kind: 'colour' }], category_ids: ['cat_nope'] });
    expect(r.status).toBe(422);
    expect(r.body.errors.map((e: any) => e.field).sort()).toEqual(['category_ids[0]', 'items[0].label', 'items[1].kind', 'name']);
    expect((await admin.post('/api/v1/inspection_templates', { name: 'Empty', items: [] })).body.errors[0].field).toBe('items');
  });

  it('applies a template to the units of its categories', async () => {
    const r = await admin.post('/api/v1/inspection_templates', { name: 'E-bike check', items: ITEMS, category_ids: [units.cat] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    templateId = r.body.id;
    expect(r.body.items.map((i: any) => [i.key, i.required, i.fail_status])).toEqual([
      ['brakes', true, 'hard_down'], ['battery_charge', true, 'soft_down'], ['lights', true, 'soft_down'], ['remarks', false, 'soft_down'],
    ]);
    expect((await admin.get(`/api/v1/stock_items/${units['EB-1']}/inspection_template`)).body.template.id).toBe(templateId);
    expect((await admin.get(`/api/v1/stock_items/${units['HL-1']}/inspection_template`)).body.template).toBeNull();
  });

  it('needs an answer for every required item', async () => {
    const r = await run('EB-1', [{ key: 'brakes', passed: true }, { key: 'battery_charge', value: 'lots' }]);
    expect(r.status).toBe(422);
    expect(r.body.errors.map((e: any) => e.field)).toEqual(['results.battery_charge', 'results.lights']);
  });

  it('brings a unit waiting for inspection back into service when it passes', async () => {
    await admin.post(`/api/v1/stock_items/${units['EB-1']}/actions/set_status`, { status: 'needs_inspection', reason: 'Check after storage' });
    const r = await run('EB-1', [{ key: 'brakes', passed: true }, { key: 'battery_charge', value: 95 }, { key: 'lights', passed: true }]);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ passed: true, template_version: 1, ticket_id: null });
    expect(await status('EB-1')).toBe('available');
  });

  it('takes a failing unit out of service with a ticket naming what failed', async () => {
    const low = (await run('EB-2', [{ key: 'brakes', passed: true }, { key: 'battery_charge', value: 50 }, { key: 'lights', passed: true }])).body;
    expect(low.passed).toBe(false);
    expect(await status('EB-2')).toBe('soft_down');
    const ticket = (await admin.get(`/api/v1/maintenance_tickets/${low.ticket_id}`)).body;
    expect(ticket.notes).toContain('E-bike check failed: Battery charge %');
    // The worst failure decides: bad brakes are hard down.
    const brakes = (await run('EB-3', [{ key: 'brakes', passed: false, note: 'Pads worn' }, { key: 'battery_charge', value: 90 }, { key: 'lights', passed: false }])).body;
    expect(await status('EB-3')).toBe('hard_down');
    expect(brakes.results.find((x: any) => x.key === 'brakes')).toMatchObject({ passed: false, note: 'Pads worn' });
    expect((await admin.get(`/api/v1/stock_items/${units['EB-3']}/inspections`)).body.data.map((i: any) => i.passed)).toEqual([false]);
  });

  it('versions the template and keeps past inspections as they were', async () => {
    const v2 = await admin.patch(`/api/v1/inspection_templates/${templateId}`, { items: [...ITEMS, { label: { en: 'Tyre pressure' }, kind: 'number', required: false }] });
    expect(v2.body.version).toBe(2);
    expect((await admin.patch(`/api/v1/inspection_templates/${templateId}`, { name: 'E-bike safety check' })).body.version).toBe(2);
    const past = (await admin.get(`/api/v1/stock_items/${units['EB-1']}/inspections`)).body.data[0];
    expect([past.template_version, past.template.name, past.template.items.length]).toEqual([1, 'E-bike check', 4]);
    // Inspections cannot be changed afterwards, even directly in the database.
    await expect(withTenant(t.deps.db, tenantId, (c) => c.query(`UPDATE inspections SET passed = NOT passed`))).rejects.toThrow(/cannot be changed/);
  });

  it('sends returned units to inspection when the shop asks for it', async () => {
    await admin.patch('/api/v1/tenant/settings', { require_inspection_on_return: true });
    const customer = (await admin.post('/api/v1/customers', { name: 'Rider', email: 'rider@test.dev' })).body.id;
    const o = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(0, 23), ends_at: isoIn(1, 23), lines: [{ variant_id: ebike, quantity: 1 }, { variant_id: plain, quantity: 1 }] })).body;
    for (const a of ['reserve']) expect((await admin.post(`/api/v1/orders/${o.id}/actions/${a}`, {})).status).toBe(200);
    expect((await admin.post(`/api/v1/orders/${o.id}/actions/assign_units`, { barcodes: ['EB-1', 'HL-1'] })).status).toBe(200);
    const out = await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, {});
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect((await admin.post(`/api/v1/orders/${o.id}/actions/check_in`, { all: true })).status).toBe(200);
    expect(await status('EB-1')).toBe('needs_inspection');
    expect(await status('HL-1')).toBe('available');
    await admin.patch('/api/v1/tenant/settings', { require_inspection_on_return: false });
  });
});
