import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reports, type Ctx } from '@openrent/core';
import { withSystem, withTenant } from '@openrent/db';
import { definePlugin, type Attachment } from '@openrent/plugin-sdk';
import { runJobs, sendNotifications } from '../../worker/src/jobs.ts';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Customer value, product ROI, damage frequency and staff activity (FR-REP-3); saved and scheduled reports (FR-REP-4). */
suite('reports and saved reports', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let locationId: string;
  let bike: string;
  let units: string[];
  const sent: { to: string; attachments: Attachment[] }[] = [];
  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>, now = new Date()) =>
    withTenant(t.deps.db, tenantId, (c) =>
      fn({ db: c, tenantId, actor: { type: 'system', id: null }, now, plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: 'http://admin.test', storefrontUrl: '', livemode: false }, logger: quietLogger }),
    );
  const sql = (text: string, values: unknown[] = []) => withSystem(t.deps.db, async (c) => (await c.query(text, values)).rows);
  const report = async (name: string, q: Record<string, string> = {}) => {
    const r = await admin.get(`/api/v1/reports/${name}?${new URLSearchParams({ range: 'all_time', ...q })}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.data as any[];
  };

  beforeAll(async () => {
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    // An email plugin that records what it sends.
    await t.deps.plugins.register(
      definePlugin({
        id: 'fakemail', name: 'Fake mail', version: '1.0.0', compat: '^1.0.0',
        setup: (api) =>
          api.registerNotificationChannel({
            id: 'fakemail', channel: 'email', isConfigured: () => true,
            async send(_c, m) {
              sent.push({ to: m.to, attachments: m.attachments ?? [] });
              return { ref: `fm_${sent.length}` };
            },
          }),
      }),
    );
    await admin.patch('/api/v1/tenant/settings', { email_channel: 'fakemail' });
    const p = (await admin.post('/api/v1/products', { type: 'rental', name: 'Cargo bike', tracking: 'serialized', depreciation_months: 24, residual_bp: 0, price: { kind: 'per_period', period_unit: 'day', amount: 10000 } })).body;
    bike = p.variants[0].id;
    units = [];
    for (const barcode of ['CB-1', 'CB-2']) {
      const u = await admin.post('/api/v1/stock_items', { variant_id: bike, location_id: locationId, barcode, purchase_price: 120000, purchase_date: '2026-01-01' });
      expect(u.status, JSON.stringify(u.body)).toBe(201);
      units.push(u.body.id);
    }
    // Two bookings by one customer, one by another; the second bike comes back damaged.
    const anna = (await admin.post('/api/v1/customers', { name: 'Anna Value', email: 'anna@test.dev' })).body;
    const ben = (await admin.post('/api/v1/customers', { name: 'Ben Small', email: 'ben@test.dev' })).body;
    const book = async (customer: string, offset: number, unit: string, outcome: string) => {
      const o = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(offset), ends_at: isoIn(offset + 1), lines: [{ variant_id: bike, quantity: 1 }] })).body;
      expect((await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { notify: false })).status).toBe(200);
      expect((await admin.post(`/api/v1/orders/${o.id}/actions/assign_units`, { stock_item_ids: [unit] })).status).toBe(200);
      const out = await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, {});
      expect(out.status, JSON.stringify(out.body)).toBe(200);
      expect((await admin.post(`/api/v1/orders/${o.id}/actions/check_in`, { units: [{ stock_item_id: unit, outcome }] })).status).toBe(200);
      return { order: o, unit };
    };
    await book(anna.id, 1, units[0]!, 'ok');
    await book(anna.id, 4, units[0]!, 'ok');
    const damaged = await book(ben.id, 7, units[1]!, 'damaged');
    await sql(`INSERT INTO damage_charges (id, tenant_id, order_id, stock_item_id, description, amount) VALUES ('dmg_test1', $1, $2, $3, 'Bent wheel', 4500)`, [tenantId, damaged.order.id, damaged.unit]);
    await admin.post('/api/v1/external_stock', { variant_id: bike, location_id: locationId, supplier: 'Bike Hire Co', quantity: 1, starts_at: isoIn(2), ends_at: isoIn(3), unit_cost: 3000 });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('ranks customers by what they booked', async () => {
    const rows = await report('customer_value');
    expect(rows.map((r) => [r.customer, r.orders])).toEqual([['Anna Value', 2], ['Ben Small', 1]]);
    expect(rows[0].total).toBe(rows[0].average_order * 2);
    expect(Object.keys(rows[0])).toEqual(['id', 'customer', 'email', 'orders', 'total', 'paid', 'average_order', 'first_order', 'last_order']);
  });

  it('weighs product revenue against purchase price, wear and sub-rental', async () => {
    const [row] = (await report('product_roi')).filter((r) => r.product === 'Cargo bike');
    expect(row).toMatchObject({ orders: 3, purchase_price: 240000, subrental_cost: 3000, repair_cost: 0 });
    expect(row.revenue).toBeGreaterThan(0);
    expect(row.net_return).toBe(row.revenue - 3000);
    expect(row.roi).toBeCloseTo(row.net_return / 240000, 4);
    expect(row.depreciated).toBeGreaterThan(0);
  });

  it('counts damaged returns per product and per unit', async () => {
    const [product] = await report('damage_frequency');
    expect(product).toMatchObject({ product: 'Cargo bike', returns: 3, damaged: 1, lost: 0, charges: 1, charged: 4500 });
    expect(product.damage_rate).toBeCloseTo(1 / 3, 4);
    const byUnit = await report('damage_frequency', { group_by: 'unit' });
    expect(byUnit.reduce((n, r) => n + r.returns, 0)).toBe(3);
    expect(byUnit.find((r) => r.damaged === 1)).toMatchObject({ charges: 1, damage_rate: expect.any(Number) });
  });

  it('shows what each team member did, for those who may read the audit log', async () => {
    const [owner] = await report('staff_activity');
    expect(owner).toMatchObject({ staff: 'Owner', email: 'owner@test.dev', orders_created: 3, check_outs: 3, check_ins: 3 });
    const byAction = await report('staff_activity', { group_by: 'action' });
    expect(byAction.find((r) => r.entity === 'order' && r.action === 'create')).toMatchObject({ actions: 3 });
    const role = (await admin.post('/api/v1/roles', { name: 'Report reader', permissions: ['reports:read'] })).body;
    expect((await admin.post('/api/v1/users', { email: 'viewer@test.dev', name: 'Viewer', role: role.id, password: 'password123' })).status).toBe(201);
    const viewer = new Client(t.app);
    await viewer.post('/api/v1/auth/login', { email: 'viewer@test.dev', password: 'password123' });
    expect((await viewer.get('/api/v1/reports/staff_activity')).status).toBe(403);
    expect((await viewer.get('/api/v1/reports/customer_value')).status).toBe(200);
    // Saving needs reports:write.
    expect((await viewer.post('/api/v1/saved_reports', { name: 'Mine', report: 'revenue' })).status).toBe(403);
  });

  it('resolves relative periods in the shop time zone', async () => {
    const now = new Date('2026-03-15T10:00:00Z');
    const tz = 'Europe/Tallinn';
    const range = (r: any) => {
      const { from, to } = reports.resolveRange(r, now, tz);
      return [from.toISOString(), to.toISOString()];
    };
    expect(range('last_month')).toEqual(['2026-01-31T22:00:00.000Z', '2026-02-28T22:00:00.000Z']);
    expect(range('last_7_days')).toEqual(['2026-03-07T22:00:00.000Z', '2026-03-14T22:00:00.000Z']);
    expect(range('year_to_date')).toEqual(['2025-12-31T22:00:00.000Z', '2026-03-15T22:00:00.000Z']);
    // Summer time starts on 29 March: this month still ends at local midnight.
    expect(reports.resolveRange('last_month', new Date('2026-04-02T10:00:00Z'), tz).to.toISOString()).toBe('2026-03-31T21:00:00.000Z');
    const bad = await admin.get('/api/v1/reports/revenue?range=forever');
    expect([bad.status, bad.body.errors[0].field]).toEqual([422, 'range']);
  });

  it('works out the next send time at 07:00 shop time', () => {
    const tz = 'Europe/Tallinn';
    const at = (s: any, now: string) => reports.nextRunAt(s, new Date(now), tz).toISOString();
    expect(at('daily', '2026-03-15T03:00:00Z')).toBe('2026-03-15T05:00:00.000Z');
    expect(at('daily', '2026-03-15T06:00:00Z')).toBe('2026-03-16T05:00:00.000Z');
    // Sunday the 15th → Monday the 16th; on a Monday after 07:00 → next Monday.
    expect(at('weekly', '2026-03-15T10:00:00Z')).toBe('2026-03-16T05:00:00.000Z');
    expect(at('weekly', '2026-03-16T10:00:00Z')).toBe('2026-03-23T05:00:00.000Z');
    expect(at('monthly', '2026-12-05T10:00:00Z')).toBe('2027-01-01T05:00:00.000Z');
    // After the clocks go forward 07:00 is 04:00 UTC.
    expect(at('daily', '2026-03-29T10:00:00Z')).toBe('2026-03-30T04:00:00.000Z');
  });

  it('checks a saved report field by field', async () => {
    const r = await admin.post('/api/v1/saved_reports', { name: ' ', report: 'revenue', params: { group_by: 'colour' }, schedule: 'weekly', recipients: ['not-an-email'] });
    expect(r.status).toBe(422);
    expect(r.body.errors.map((e: any) => e.field).sort()).toEqual(['name', 'params.group_by', 'params.range', 'recipients']);
    const noOne = await admin.post('/api/v1/saved_reports', { name: 'Weekly', report: 'revenue', params: { range: 'last_7_days' }, schedule: 'weekly' });
    expect([noOne.status, noOne.body.errors[0].field]).toEqual([422, 'recipients']);
    const where = await admin.post('/api/v1/saved_reports', { name: 'Where', report: 'revenue', params: { location_id: 'loc_nowhere' } });
    expect([where.status, where.body.errors[0].field]).toEqual([422, 'params.location_id']);
  });

  it('emails a scheduled report as a file when it is due, and moves it on', async () => {
    const r = await admin.post('/api/v1/saved_reports', {
      name: 'Monthly revenue', report: 'revenue', params: { range: 'last_month', group_by: 'product' }, format: 'xlsx', schedule: 'monthly', recipients: ['Books@Test.dev', 'books@test.dev', 'boss@test.dev'],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ object: 'saved_report', recipients: ['books@test.dev', 'boss@test.dev'], schedule: 'monthly', format: 'xlsx' });
    expect(new Date(r.body.next_run_at).getUTCDate()).toBe(1);
    expect((await admin.get('/api/v1/saved_reports')).body.data.map((s: any) => s.name)).toEqual(['Monthly revenue']);

    // Not due yet; then due at the next run time.
    expect(await inTenant((ctx) => reports.queueDueReports(ctx))).toBe(0);
    const when = new Date(new Date(r.body.next_run_at).getTime() + 60_000);
    expect(await inTenant((ctx) => reports.queueDueReports(ctx), when)).toBe(1);
    expect(await inTenant((ctx) => reports.queueDueReports(ctx), when)).toBe(0);
    const moved = (await admin.get(`/api/v1/saved_reports/${r.body.id}`)).body;
    expect(new Date(moved.next_run_at).getTime()).toBeGreaterThan(when.getTime());
    expect(moved.last_run_at).not.toBeNull();

    expect(await runJobs(t.deps, quietLogger)).toBe(1);
    const mails = await sql(`SELECT recipient, subject, attachments, audience FROM notifications WHERE template_key = 'scheduled_report' ORDER BY recipient`);
    expect(mails.map((m) => [m.recipient, m.subject, m.audience])).toEqual([['books@test.dev', 'Report: Monthly revenue', 'staff'], ['boss@test.dev', 'Report: Monthly revenue', 'staff']]);
    const [file] = await sql(`SELECT filename, content_type FROM files WHERE id = $1`, [mails[0].attachments[0]]);
    expect(file.filename).toMatch(/^revenue-\d{4}-\d{2}-\d{2}\.xlsx$/);
    await sendNotifications(t.deps, quietLogger);
    const mail = sent.find((m) => m.to === 'boss@test.dev')!;
    expect(mail.attachments.map((a) => [a.filename, a.contentType])).toEqual([[file.filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]);
    expect(Buffer.from(mail.attachments[0]!.content as Uint8Array).subarray(0, 2).toString()).toBe('PK');
    const events = await sql(`SELECT event_type FROM outbox WHERE tenant_id = $1 AND event_type LIKE 'saved_report.%' ORDER BY created_at, id`, [tenantId]);
    expect(events.map((e) => e.event_type)).toEqual(['saved_report.created', 'saved_report.sent']);
  });

  it('sends a saved report now to other addresses, and stops sending once the schedule is removed', async () => {
    const r = (await admin.post('/api/v1/saved_reports', { name: 'Damage', report: 'damage_frequency', params: { range: 'last_30_days' }, schedule: 'daily', recipients: ['ops@test.dev'] })).body;
    const job = await admin.post(`/api/v1/saved_reports/${r.id}/actions/send`, { recipients: ['me@test.dev'] });
    expect([job.status, job.body.kind, job.body.params.saved_report_id]).toEqual([202, 'report_export', r.id]);
    expect(await runJobs(t.deps, quietLogger)).toBe(1);
    expect((await sql(`SELECT recipient FROM notifications WHERE template_key = 'scheduled_report' AND recipient = 'me@test.dev'`)).length).toBe(1);
    const off = await admin.patch(`/api/v1/saved_reports/${r.id}`, { schedule: null });
    expect([off.body.schedule, off.body.next_run_at]).toEqual([null, null]);
    expect(await inTenant((ctx) => reports.queueDueReports(ctx), new Date(Date.now() + 3 * 86400_000))).toBe(0);
    expect((await admin.del(`/api/v1/saved_reports/${r.id}`)).status).toBe(204);
    expect((await admin.get(`/api/v1/saved_reports/${r.id}`)).status).toBe(404);
  });
});
