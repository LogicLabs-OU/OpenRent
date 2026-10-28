import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@openrent/db';
import { Client, databaseForTests, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

const DAY = 86_400_000;
/** The Monday `weeks` weeks after the week after next, at noon UTC (the shop is in Tallinn). */
function monday(weeks: number) {
  const d = new Date(Date.now() + 7 * DAY);
  d.setUTCHours(12, 0, 0, 0);
  while (d.getUTCDay() !== 1) d.setTime(d.getTime() + DAY);
  return new Date(d.getTime() + weeks * 7 * DAY);
}
const day = (d: Date) => d.toISOString().slice(0, 10);

/** FR-PR-9: weekly price suggestions from how full coming weeks are, now and a year ago. */
suite('price suggestions', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let locationId: string;
  const product = async (name: string, quantity: number) => {
    const p = await admin.post('/api/v1/products', { type: 'rental', name, tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 1000 } });
    await admin.put(`/api/v1/stock_levels/${p.body.variants[0].id}/${locationId}`, { quantity });
    return { id: p.body.id as string, variant: p.body.variants[0].id as string };
  };
  let busy: { id: string; variant: string };
  let quiet: { id: string; variant: string };
  let fresh: { id: string; variant: string };

  beforeAll(async () => {
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    busy = await product('Canoe', 2);
    quiet = await product('Snow chains', 4);
    fresh = await product('New drone', 3);
    // Both canoes out for the whole of the week three weeks on.
    const c = await admin.post('/api/v1/customers', { name: 'Paddler', email: 'paddler@test.dev' });
    const start = monday(3);
    const o = await admin.post('/api/v1/orders', { customer_id: c.body.id, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 7 * DAY).toISOString(), lines: [{ variant_id: busy.variant, quantity: 2 }], deposit: { mode: 'none' } });
    expect((await admin.post(`/api/v1/orders/${o.body.id}/actions/reserve`, { notify: false })).status).toBe(200);
    // Snow chains were rented a little over a year ago, so they have a past; the coming weeks were quiet then.
    // The canoe was rented recently only: its empty weeks a year ago say nothing.
    await withTenant(t.deps.db, tenantId, async (db) => {
      await db.query(`INSERT INTO allocations (id, tenant_id, variant_id, location_id, quantity, period, kind) VALUES ('alc_past_chains', $1, $2, $3, 1, tstzrange(now() - interval '420 days', now() - interval '419 days'), 'reservation')`, [tenantId, quiet.variant, locationId]);
      await db.query(`INSERT INTO allocations (id, tenant_id, variant_id, location_id, quantity, period, kind) VALUES ('alc_past_canoe', $1, $2, $3, 1, tstzrange(now() - interval '30 days', now() - interval '29 days'), 'reservation')`, [tenantId, busy.variant, locationId]);
    });
  }, 120_000);
  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('suggests a rise for a full week and a cut for weeks that were quiet a year ago too', async () => {
    const r = await admin.post('/api/v1/price_suggestions/actions/refresh', {});
    expect(r.status).toBe(200);
    const open = (await admin.get('/api/v1/price_suggestions?status=open')).body.data;
    const canoe = open.filter((s: any) => s.product_id === busy.id);
    // The booking runs Monday noon to Monday noon; the shop's week (Tallinn) is 154 of its 168 hours.
    expect(canoe).toEqual([expect.objectContaining({ direction: 'busy', adjustment_bp: 1000, starts_on: day(monday(3)), ends_on: day(new Date(monday(3).getTime() + 6 * DAY)), last_year_bp: null })]);
    expect(canoe[0].booked_bp).toBeGreaterThanOrEqual(8500);
    const chains = open.filter((s: any) => s.product_id === quiet.id);
    expect(chains).toHaveLength(1);
    expect(chains[0]).toMatchObject({ direction: 'quiet', adjustment_bp: -1000, booked_bp: 0, last_year_bp: 0 });
    // Twelve weeks in one season.
    expect((Date.parse(chains[0].ends_on) - Date.parse(chains[0].starts_on)) / DAY).toBe(83);
    // Without a past or bookings there is nothing to go by.
    expect(open.some((s: any) => s.product_id === fresh.id)).toBe(false);
  });

  it('makes a season price rule when accepted, with the percentage staff choose', async () => {
    const [s] = (await admin.get('/api/v1/price_suggestions?status=open')).body.data.filter((x: any) => x.product_id === busy.id);
    expect((await admin.post(`/api/v1/price_suggestions/${s.id}/actions/accept`, { adjustment_bp: 0 })).body.errors[0].field).toBe('adjustment_bp');
    const ok = await admin.post(`/api/v1/price_suggestions/${s.id}/actions/accept`, { adjustment_bp: 1500 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'accepted', adjustment_bp: 1500, price_rule: { kind: 'season', adjustment_bp: 1500, product_ids: [busy.id], starts_on: s.starts_on, ends_on: s.ends_on } });
    expect((await admin.post(`/api/v1/price_suggestions/${s.id}/actions/dismiss`, {})).body.code).toBe('price_suggestion_decided');
    // The rule prices that week.
    const q = await admin.post('/api/v1/price_quote', { starts_at: monday(3).toISOString(), ends_at: new Date(monday(3).getTime() + DAY).toISOString(), lines: [{ variant_id: busy.variant, quantity: 1 }] });
    expect(q.body.lines[0].unit_price.amount).toBe(1150);
  });

  it('does not suggest dismissed or accepted dates again, and stops when turned off', async () => {
    const [chains] = (await admin.get('/api/v1/price_suggestions?status=open')).body.data.filter((x: any) => x.product_id === quiet.id);
    expect((await admin.post(`/api/v1/price_suggestions/${chains.id}/actions/dismiss`, {})).body.status).toBe('dismissed');
    await admin.post('/api/v1/price_suggestions/actions/refresh', {});
    expect((await admin.get('/api/v1/price_suggestions?status=open')).body.data).toEqual([]);
    expect((await admin.get('/api/v1/price_suggestions')).body.data.map((s: any) => s.status).sort()).toEqual(['accepted', 'dismissed']);

    const bad = await admin.patch('/api/v1/tenant/settings', { price_suggestions: { busy_bp: 2000, quiet_bp: 3000 } });
    expect(bad.status).toBe(422);
    expect(bad.body.errors[0].field).toBe('price_suggestions.busy_bp');
    expect((await admin.patch('/api/v1/tenant/settings', { price_suggestions: { enabled: false } })).status).toBe(200);
    const audit = (await admin.get('/api/v1/audit_log?filter[entity_type]=price_suggestion')).body.data.map((a: any) => a.action).sort();
    expect(audit).toEqual(['accept', 'dismiss']);
  });

  it('lets only staff who price see and decide', async () => {
    await admin.post('/api/v1/users', { email: 'wh@test.dev', name: 'Warehouse', role: 'warehouse', password: 'warehouse-123' });
    const wh = new Client(t.app);
    await wh.post('/api/v1/auth/login', { email: 'wh@test.dev', password: 'warehouse-123' });
    expect((await wh.post('/api/v1/price_suggestions/actions/refresh', {})).status).toBe(403);
  });
});
