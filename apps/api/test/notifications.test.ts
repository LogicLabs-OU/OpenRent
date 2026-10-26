import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { availability, notifications, staffNotices, type Ctx } from '@openrent/core';
import { withSystem, withTenant } from '@openrent/db';
import { definePlugin, type DeliveryReport } from '@openrent/plugin-sdk';
import { deliverWebhooks, publishOutbox, sendNotifications } from '../../worker/src/jobs.ts';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

suite('staff notices, email providers, delivery reports and webhook limits', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let locationId: string;
  let product: string;
  let variant: string;
  const sent: { to: string; subject: string }[] = [];
  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, tenantId, (c) =>
      fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: 'http://shop.test', livemode: false }, logger: quietLogger }),
    );
  const emails = async (template: string) =>
    (await withSystem(t.deps.db, (c) => c.query(`SELECT id, recipient, status, provider, provider_ref FROM notifications WHERE template_key = $1 ORDER BY created_at`, [template]))).rows;

  beforeAll(async () => {
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    // An email plugin that records what it sends and reads delivery reports as JSON.
    await t.deps.plugins.register(
      definePlugin({
        id: 'fakemail',
        name: 'Fake mail',
        version: '1.0.0',
        compat: '^1.0.0',
        setup: (api) =>
          api.registerNotificationChannel({
            id: 'fakemail',
            channel: 'email',
            isConfigured: () => true,
            async send(_c, m) {
              sent.push({ to: m.to, subject: m.subject });
              return { ref: `fm_${sent.length}` };
            },
            async handleWebhook(_c, req) {
              return [JSON.parse(req.rawBody.toString()) as DeliveryReport];
            },
          }),
      }),
    );
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Kayak', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 3000 } });
    product = p.body.id;
    variant = p.body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId}`, { quantity: 3 });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('tells staff once when a variant runs low, in the admin and by email', async () => {
    expect((await admin.patch(`/api/v1/variants/${variant}`, { low_availability_threshold: 2 })).status).toBe(200);
    const c = await admin.post('/api/v1/customers', { name: 'Low Stock', email: 'low@test.dev' });
    const o = await admin.post('/api/v1/orders', { customer_id: c.body.id, starts_at: isoIn(1), ends_at: isoIn(3), lines: [{ variant_id: variant, quantity: 2 }] });
    expect((await admin.post(`/api/v1/orders/${o.body.id}/actions/reserve`, { notify: false })).status).toBe(200);

    expect(await inTenant((ctx) => availability.lowAvailabilityCheck(ctx, 7))).toEqual({ checked: 1, warned: 1 });
    await inTenant((ctx) => availability.lowAvailabilityCheck(ctx, 7));

    const mine = await admin.get('/api/v1/me/notifications');
    expect(mine.status).toBe(200);
    expect(mine.body.unread_count).toBe(1);
    expect(mine.body.data[0]).toMatchObject({ kind: 'staff_low_availability', params: { item: 'Kayak', available: 1, threshold: 2, location: 'Main shop', days: 7, product_id: product }, read_at: null });
    expect(await emails('staff_low_availability')).toMatchObject([{ recipient: 'owner@test.dev', status: 'queued' }]);

    expect((await admin.post(`/api/v1/me/notifications/${mine.body.data[0].id}/actions/read`)).body.read_at).toBeTruthy();
    expect((await admin.get('/api/v1/me/notifications?unread=true')).body).toMatchObject({ data: [], unread_count: 0 });
    expect((await admin.post('/api/v1/me/notifications/ord_x/actions/read')).status).toBe(404);
  });

  it('leaves out notices and emails a member turned off', async () => {
    const prefs = await admin.patch('/api/v1/me/notification_preferences', { kinds: [{ kind: 'staff_webhook_disabled', in_app: false, email: false }, { kind: 'not_a_kind', email: false }] });
    expect(prefs.status).toBe(200);
    expect(prefs.body.kinds.find((k: any) => k.kind === 'staff_webhook_disabled')).toEqual({ kind: 'staff_webhook_disabled', in_app: false, email: false });
    expect(prefs.body.kinds.some((k: any) => k.kind === 'not_a_kind')).toBe(false);

    await inTenant((ctx) => notifications.notifyStaff(ctx, null, 'staff_webhook_disabled', { url: 'https://hooks.test/a' }));
    expect((await admin.get('/api/v1/me/notifications')).body.data.some((n: any) => n.kind === 'staff_webhook_disabled')).toBe(false);
    expect(await emails('staff_webhook_disabled')).toEqual([]);
    expect(await inTenant((ctx) => staffNotices.emailRecipients(ctx, 'staff_overdue'))).toEqual(['owner@test.dev']);

    // A shared staff address still gets every staff email.
    await admin.patch('/api/v1/tenant/settings', { staff_email: 'team@test.dev' });
    await inTenant((ctx) => notifications.notifyStaff(ctx, null, 'staff_webhook_disabled', { url: 'https://hooks.test/b' }));
    expect(await emails('staff_webhook_disabled')).toMatchObject([{ recipient: 'team@test.dev' }]);
    await admin.patch('/api/v1/tenant/settings', { staff_email: null });
    await admin.patch('/api/v1/me/notification_preferences', { kinds: [{ kind: 'staff_webhook_disabled', in_app: true, email: true }] });
  });

  it('sends with the chosen email plugin and records delivery reports', async () => {
    const bad = await admin.patch('/api/v1/tenant/settings', { email_channel: 'Not A Plugin!' });
    expect(bad.status).toBe(422);
    expect(bad.body.errors[0].field).toBe('email_channel');
    expect((await admin.patch('/api/v1/tenant/settings', { email_channel: 'fakemail' })).status).toBe(200);

    await sendNotifications(t.deps, quietLogger);
    const [low] = await emails('staff_low_availability');
    expect(low).toMatchObject({ status: 'sent', provider: 'fakemail', provider_ref: expect.stringMatching(/^fm_/) });
    expect(sent.some((m) => m.to === 'owner@test.dev')).toBe(true);

    const report = (body: object) => t.app.inject({ method: 'POST', url: `/webhooks/notify/fakemail/${tenantId}`, payload: body });
    expect((await report({ ref: low.provider_ref, status: 'delivered' })).json()).toEqual({ received: true, updated: 1 });
    expect((await emails('staff_low_availability'))[0].status).toBe('delivered');
    expect((await report({ ref: low.provider_ref, status: 'bounced', error: 'mailbox full' })).json().updated).toBe(1);
    // A bounce is final; a late "delivered" does not undo it.
    expect((await report({ ref: low.provider_ref, status: 'delivered' })).json().updated).toBe(0);
    expect((await emails('staff_low_availability'))[0].status).toBe('bounced');
    expect((await t.app.inject({ method: 'POST', url: `/webhooks/notify/notify-smtp/${tenantId}`, payload: {} })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: `/webhooks/notify/fakemail/ten_missing`, payload: {} })).statusCode).toBe(404);
    await admin.patch('/api/v1/tenant/settings', { email_channel: null });
  });

  it('turns off a webhook endpoint that keeps failing and tells the owners', async () => {
    process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORK = 'true';
    const ep = await admin.post('/api/v1/webhook_endpoints', { url: 'http://127.0.0.1:9/hook', events: ['customer.*'] });
    await withSystem(t.deps.db, (c) => c.query(`UPDATE webhook_endpoints SET failing_since = now() - interval '4 days' WHERE id = $1`, [ep.body.id]));
    await admin.post('/api/v1/customers', { name: 'Hook Fail', email: 'hookfail@test.dev' });
    for (let i = 0; i < 3; i++) await publishOutbox(t.deps, quietLogger);
    await deliverWebhooks(t.deps, quietLogger, async () => ({ status: 500, text: async () => 'down' }));
    expect((await admin.get(`/api/v1/webhook_endpoints/${ep.body.id}`)).body.status).toBe('disabled_failures');
    const notice = (await admin.get('/api/v1/me/notifications')).body.data.find((n: any) => n.kind === 'staff_webhook_disabled');
    expect(notice).toMatchObject({ params: { url: 'http://127.0.0.1:9/hook' } });
  });

  it.runIf(dbinfo?.real)('sends at most four requests to one endpoint at a time', async () => {
    const ep = await admin.post('/api/v1/webhook_endpoints', { url: 'http://127.0.0.1:9/slots', events: ['customer.*'] });
    for (let i = 0; i < 12; i++) await admin.post('/api/v1/customers', { name: `Slot ${i}`, email: `slot${i}@test.dev` });
    for (let i = 0; i < 5; i++) await publishOutbox(t.deps, quietLogger);
    let inFlight = 0;
    let peak = 0;
    const slow = async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 50));
      inFlight--;
      return { status: 200, text: async () => 'ok' };
    };
    // Two workers at once would make up to eight requests without the endpoint slots.
    const [a, b] = await Promise.all([deliverWebhooks(t.deps, quietLogger, slow), deliverWebhooks(t.deps, quietLogger, slow)]);
    expect(peak).toBeLessThanOrEqual(4);
    expect(a + b).toBeGreaterThan(0);
    // Skipped deliveries wait for the next run.
    while ((await deliverWebhooks(t.deps, quietLogger, slow)) > 0);
    expect((await withSystem(t.deps.db, (c) => c.query(`SELECT count(*)::int AS n FROM webhook_deliveries WHERE endpoint_id = $1 AND status <> 'succeeded'`, [ep.body.id]))).rows[0].n).toBe(0);
  });

  it('reads one message template by id, built-in or the shop’s own', async () => {
    const builtin = await admin.get('/api/v1/notification_templates/builtin:order_confirmed?locale=de');
    expect(builtin.body).toMatchObject({ id: 'builtin:order_confirmed', event: 'order_confirmed', locale: 'de' });
    const own = await admin.patch('/api/v1/notification_templates/order_confirmed', { subject: 'Booked {{order.number}}', body: 'Thanks', locale: 'en' });
    expect((await admin.get(`/api/v1/notification_templates/${own.body.id}`)).body).toMatchObject({ id: own.body.id, subject: 'Booked {{order.number}}' });
    expect((await admin.get('/api/v1/notification_templates/builtin:no_such_event')).status).toBe(404);
  });
});
