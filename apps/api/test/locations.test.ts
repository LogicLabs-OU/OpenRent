import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Location context (B1): contact and tax details per location, archive and restore, filters and reports by location. */
suite('location context', () => {
  let t: TestApp;
  let admin: Client;
  let main: string;
  let branch: string;
  let customer: string;
  let kayak: string; // bulk, uses the shop's default tax profile
  let book: string; // bulk, has its own reduced-rate profile
  let camera: string; // serialized
  let reduced: string;
  let finnish: string;

  beforeAll(async () => {
    ({ t, admin, locationId: main } = await shopForTests(dbinfo!));
    customer = (await admin.post('/api/v1/customers', { name: 'Loc Customer', email: 'loc@test.dev' })).body.id;
    reduced = (await admin.post('/api/v1/tax_profiles', { name: 'Reduced', rates: [{ name: 'VAT', rate_bp: 900 }] })).body.id;
    finnish = (await admin.post('/api/v1/tax_profiles', { name: 'Finland', rates: [{ name: 'ALV', rate_bp: 2550 }] })).body.id;
    kayak = (await admin.post('/api/v1/products', { type: 'rental', name: 'Kayak', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 1000 } })).body.variants[0].id;
    book = (await admin.post('/api/v1/products', { type: 'rental', name: 'Guide book', tracking: 'bulk', tax_profile_id: reduced, price: { kind: 'per_period', period_unit: 'day', amount: 1000 } })).body.variants[0].id;
    camera = (await admin.post('/api/v1/products', { type: 'rental', name: 'Camera', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 1000 } })).body.variants[0].id;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('refuses bad location details field by field', async () => {
    const r = await admin.post('/api/v1/locations', { name: 'Bad', timezone: 'Mars/Base', email: 'not-an-email', tax_profile_id: 'txp_nope' });
    expect(r.status).toBe(422);
    expect(r.body.errors.map((e: any) => e.field).sort()).toEqual(['email', 'tax_profile_id', 'timezone']);
  });

  it('keeps contact and tax details per location, and empty values as null', async () => {
    const r = await admin.post('/api/v1/locations', {
      name: 'Helsinki', timezone: 'Europe/Helsinki', address: { line1: 'Esplanadi 1', postal_code: '00100', city: 'Helsinki' },
      phone: ' +358 40 123 ', email: 'helsinki@test.dev', tax_ids: [{ type: 'VAT', value: 'FI12345678' }, { type: 'VAT', value: ' ' }], tax_profile_id: finnish, opening_hours: {},
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    branch = r.body.id;
    expect(r.body).toMatchObject({ phone: '+358 40 123', email: 'helsinki@test.dev', tax_ids: [{ type: 'VAT', value: 'FI12345678' }], tax_profile_id: finnish });
    const cleared = (await admin.patch(`/api/v1/locations/${branch}`, { phone: '' })).body;
    expect(cleared.phone).toBeNull();
    await admin.patch(`/api/v1/locations/${branch}`, { phone: '+358 40 123' });
  });

  it("uses the location's tax profile instead of the shop default, but keeps a product's own profile", async () => {
    const lines = [{ variant_id: kayak, quantity: 1 }, { variant_id: book, quantity: 1 }];
    const rates = async (location_id: string) =>
      (await admin.post('/api/v1/price_quote', { location_id, starts_at: isoIn(10), ends_at: isoIn(11), lines })).body.lines.map((l: any) => l.tax_rate_bp);
    expect(await rates(main)).toEqual([2000, 900]);
    expect(await rates(branch)).toEqual([2550, 900]);
    // Fee rules follow the same rule.
    await admin.post('/api/v1/fee_rules', { name: 'Cleaning', kind: 'cleaning', calculation: 'flat', amount: 500 });
    const q = (await admin.post('/api/v1/price_quote', { location_id: branch, starts_at: isoIn(10), ends_at: isoIn(11), lines: [{ variant_id: kayak, quantity: 1 }] })).body;
    expect(q.lines.find((l: any) => l.type === 'fee').tax_rate_bp).toBe(2550);
  });

  it("shows the location's contact and tax id on its documents", async () => {
    await admin.patch('/api/v1/tenant', { tax_ids: [{ type: 'VAT', value: 'EE100200300' }] });
    const o = (await admin.post('/api/v1/orders', { customer_id: customer, location_id: branch, starts_at: isoIn(10), ends_at: isoIn(11), lines: [{ variant_id: kayak, quantity: 1 }] })).body;
    expect(o.lines[0].tax.amount).toBe(255);
    const doc = (await admin.post(`/api/v1/orders/${o.id}/documents`, { type: 'confirmation' })).body;
    const data = (await admin.get(`/api/v1/documents/${doc.id}`)).body.data;
    expect(data.tenant.tax_ids).toEqual([{ type: 'VAT', value: 'FI12345678' }]);
    expect(data.location).toMatchObject({ name: 'Helsinki', phone: '+358 40 123', address_lines: ['Esplanadi 1', '00100 Helsinki'] });
    const html = (await admin.get(`/api/v1/documents/${doc.id}/html`)).body as string;
    expect(html).toContain('FI12345678');
    expect(html).not.toContain('EE100200300');
    // The main shop has no tax id of its own: the shop's shows.
    const home = (await admin.post('/api/v1/orders', { customer_id: customer, location_id: main, starts_at: isoIn(10), ends_at: isoIn(11), lines: [{ variant_id: kayak, quantity: 1 }] })).body;
    const homeDoc = (await admin.post(`/api/v1/orders/${home.id}/documents`, { type: 'confirmation' })).body;
    expect((await admin.get(`/api/v1/documents/${homeDoc.id}`)).body.data.tenant.tax_ids).toEqual([{ type: 'VAT', value: 'EE100200300' }]);
  });

  it('filters maintenance tickets, downtimes and stock by location', async () => {
    const a = (await admin.post('/api/v1/stock_items', { variant_id: camera, location_id: main, barcode: 'LOC-CAM-1' })).body;
    const b = (await admin.post('/api/v1/stock_items', { variant_id: camera, location_id: branch, barcode: 'LOC-CAM-2' })).body;
    for (const u of [a, b]) expect((await admin.post(`/api/v1/stock_items/${u.id}/actions/set_status`, { status: 'soft_down', reason: 'Lens check' })).status).toBe(200);
    const tickets = async (q: string) => (await admin.get(`/api/v1/maintenance_tickets${q}`)).body.data.map((x: any) => x.stock_item.barcode).sort();
    expect(await tickets('')).toEqual(['LOC-CAM-1', 'LOC-CAM-2']);
    expect(await tickets(`?location_id=${branch}`)).toEqual(['LOC-CAM-2']);
    expect(await tickets(`?status=open&location_id=${main}`)).toEqual(['LOC-CAM-1']);
    const downs = (await admin.get(`/api/v1/downtimes?active=true&location_id=${branch}`)).body.data;
    expect(downs.map((d: any) => d.stock_item_id)).toEqual([b.id]);
    const units = (await admin.get(`/api/v1/stock_items?filter[location_id]=${branch}`)).body.data;
    expect(units.map((u: any) => u.barcode)).toEqual(['LOC-CAM-2']);
    for (const u of [a, b]) await admin.post(`/api/v1/stock_items/${u.id}/actions/set_status`, { status: 'available', reason: 'Fine' });
  });

  it('groups utilisation and tax by location, and refuses unknown groupings', async () => {
    await admin.put(`/api/v1/stock_levels/${kayak}/${main}`, { quantity: 4 });
    await admin.put(`/api/v1/stock_levels/${kayak}/${branch}`, { quantity: 2 });
    for (const loc of [main, branch]) {
      const o = (await admin.post('/api/v1/orders', { customer_id: customer, location_id: loc, starts_at: isoIn(1), ends_at: isoIn(2), lines: [{ variant_id: kayak, quantity: 1 }] })).body;
      expect((await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, {})).status).toBe(200);
    }
    const range = `from=${encodeURIComponent(isoIn(0))}&to=${encodeURIComponent(isoIn(5))}`;
    const util = (await admin.get(`/api/v1/reports/utilization?group_by=location&${range}`)).body.data;
    expect(util.map((r: any) => [r.location, r.capacity])).toEqual([['Helsinki', 3], ['Main shop', 5]]);
    expect(util.every((r: any) => Number(r.booked_unit_hours) === 24)).toBe(true);
    const only = (await admin.get(`/api/v1/reports/utilization?group_by=location&location_id=${branch}&${range}`)).body.data;
    expect(only.map((r: any) => r.location)).toEqual(['Helsinki']);

    const tax = (await admin.get(`/api/v1/reports/tax_summary?group_by=location&${range}`)).body.data;
    expect(tax.map((r: any) => [r.location, r.rate_bp])).toEqual([['Helsinki', 2550], ['Main shop', 2000]]);

    const bad = await admin.get(`/api/v1/reports/overdue?group_by=location`);
    expect(bad.status).toBe(422);
    expect(bad.body.errors[0].field).toBe('group_by');
    expect((await admin.get(`/api/v1/reports/revenue?group_by=weekday`)).status).toBe(422);
    expect((await admin.get(`/api/v1/reports/revenue?location_id=loc_missing`)).status).toBe(404);
    const fulfilment = (await admin.get(`/api/v1/reports/fulfilment?${range}`)).body.data;
    expect(new Set(fulfilment.map((r: any) => r.location))).toEqual(new Set(['Helsinki', 'Main shop']));
  });

  it('archives a location and restores it, listing archived ones on request', async () => {
    const pop = (await admin.post('/api/v1/locations', { name: 'Pop-up', opening_hours: {} })).body;
    expect((await admin.del(`/api/v1/locations/${pop.id}`)).status).toBe(204);
    expect((await admin.get('/api/v1/locations')).body.data.map((l: any) => l.name)).not.toContain('Pop-up');
    const all = (await admin.get('/api/v1/locations?archived=true')).body.data;
    expect(all.at(-1)).toMatchObject({ name: 'Pop-up' });
    expect(all.at(-1).deleted_at).toBeTruthy();
    const back = await admin.post(`/api/v1/locations/${pop.id}/actions/restore`, {});
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ deleted_at: null, is_default: false });
    expect((await admin.get('/api/v1/locations')).body.data.map((l: any) => l.name)).toContain('Pop-up');
  });
});
