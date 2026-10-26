import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notifications } from '@openrent/core';
import { withSystem } from '@openrent/db';
import { startTwilioFake, twilioSignature, type TwilioFake } from '@openrent/messaging-fakes';
import { sendNotifications } from '../../worker/src/jobs.ts';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/**
 * Booking updates by SMS and WhatsApp (FR-NOT-4) end to end: the real Twilio plugin against its fake,
 * customers who opt in at checkout or in their account, the shop's own texts, the message log and
 * signed delivery reports (FR-NOT-5).
 */
suite('text messages', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let fake: TwilioFake;
  let variant: string;
  let terms: string;
  const shop = () => new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
  const texts = (to?: string) =>
    withSystem(t.deps.db, async (c) => (await c.query(`SELECT * FROM notifications WHERE channel IN ('sms', 'whatsapp') AND ($1::text IS NULL OR recipient = $1) ORDER BY created_at`, [to ?? null])).rows);
  const booking = async (customer: string) => {
    const o = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(4), ends_at: isoIn(5), lines: [{ variant_id: variant, quantity: 1 }] })).body;
    expect((await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, {})).status).toBe(200);
    return o;
  };

  beforeAll(async () => {
    let locationId: string;
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    fake = await startTwilioFake();
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Paddle board', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 3000 } });
    variant = p.body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId!}`, { quantity: 50 });
    terms = (await shop().get('/api/v1/storefront/settings')).body.terms.hash;
  }, 120_000);

  afterAll(async () => {
    await fake?.close();
    await t?.close();
    await dbinfo?.stop();
  });

  it('sends nothing until the shop chooses a set-up plugin', async () => {
    expect((await shop().get('/api/v1/storefront/settings')).body.messaging).toEqual({ sms: false, whatsapp: false });
    const c = (await admin.post('/api/v1/customers', { name: 'Early Eva', email: 'eva@test.dev', phone: '+372 5550 1001', sms_opt_in: true })).body;
    expect(c).toMatchObject({ sms_opt_in: true, whatsapp_opt_in: false });
    await booking(c.id);
    expect(await texts()).toEqual([]);
    const bad = await admin.patch('/api/v1/tenant/settings', { sms_channel: 'Not A Plugin!' });
    expect([bad.status, bad.body.errors[0].field]).toEqual([422, 'sms_channel']);
    expect((await admin.patch('/api/v1/plugins/notify-twilio', { enabled: true, config: { account_sid: fake.accountSid, auth_token: fake.authToken, from: '+15005550006', whatsapp_from: '+14155238886', api_base_url: fake.url } })).status).toBe(200);
    expect((await admin.patch('/api/v1/tenant/settings', { sms_channel: 'notify-twilio', whatsapp_channel: 'notify-twilio' })).status).toBe(200);
    expect((await shop().get('/api/v1/storefront/settings')).body.messaging).toEqual({ sms: true, whatsapp: true });
  });

  it('texts the booking confirmation to a customer who asked, and logs the delivery report', async () => {
    const c = (await admin.post('/api/v1/customers', { name: 'Sam Sms', email: 'sam@test.dev', phone: '+372 (5550) 1002', sms_opt_in: true })).body;
    const quiet = (await admin.post('/api/v1/customers', { name: 'Quiet Quinn', email: 'quinn@test.dev', phone: '+3725550103' })).body;
    const o = await booking(c.id);
    await booking(quiet.id);
    const [text] = await texts();
    expect(text).toMatchObject({ channel: 'sms', template_key: 'order_confirmed', recipient: '+37255501002', status: 'queued', subject: '', order_id: o.id });
    expect(text.body_text).toMatch(new RegExp(`^Test Rentals: booking #${o.number} is confirmed\\. Pickup .+ http://localhost:7072/order/`));

    await sendNotifications(t.deps, quietLogger);
    const sent = (await texts())[0];
    expect(sent).toMatchObject({ status: 'sent', provider: 'notify-twilio' });
    const m = fake.messages.find((x) => x.sid === sent.provider_ref)!;
    const callback = `http://localhost:7070/webhooks/notify/notify-twilio/${tenantId}`;
    expect(m).toMatchObject({ to: '+37255501002', from: '+15005550006', body: sent.body_text, statusCallback: callback });

    // Twilio's signed status callback marks it delivered; a forged one is refused.
    const params = { MessageSid: m.sid, MessageStatus: 'delivered', AccountSid: fake.accountSid, To: m.to };
    const post = (signature: string) => t.app.inject({ method: 'POST', url: `/webhooks/notify/notify-twilio/${tenantId}`, payload: new URLSearchParams(params).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature } });
    expect((await post('forged')).statusCode).toBe(401);
    const ok = await post(twilioSignature(fake.authToken, callback, params));
    expect([ok.statusCode, ok.json()]).toEqual([200, { received: true, updated: 1 }]);
    expect((await texts())[0].status).toBe('delivered');
    // The order's message log lists the text next to the emails.
    const log = (await admin.get(`/api/v1/notifications?order_id=${o.id}`)).body.data;
    expect(log.map((n: any) => n.channel).sort()).toEqual(['email', 'sms']);
    expect(log.find((n: any) => n.channel === 'sms')).toMatchObject({ status: 'delivered', text: sent.body_text });
  });

  it('prefers WhatsApp when the customer wants it, and logs a number without country code as failed', async () => {
    const wa = (await admin.post('/api/v1/customers', { name: 'Wanda Whats', email: 'wanda@test.dev', phone: '0044 7700 900123', sms_opt_in: true, whatsapp_opt_in: true })).body;
    await booking(wa.id);
    expect((await texts('+447700900123'))[0]).toMatchObject({ channel: 'whatsapp', status: 'queued' });
    const local = (await admin.post('/api/v1/customers', { name: 'Local Lars', email: 'lars@test.dev', phone: '5550 1004', sms_opt_in: true })).body;
    await booking(local.id);
    expect((await texts('5550 1004'))[0]).toMatchObject({ status: 'failed', error: 'The phone number needs its country code, like +44 or +372' });
    await sendNotifications(t.deps, quietLogger);
    expect(fake.messages.at(-1)).toMatchObject({ to: 'whatsapp:+447700900123', from: 'whatsapp:+14155238886' });
  });

  it('uses the shop’s own text, or none at all', async () => {
    const tpl = (await admin.get('/api/v1/notification_templates?locale=en')).body.data;
    expect(tpl.find((x: any) => x.event === 'order_confirmed')).toMatchObject({ text_builtin: true, text: expect.stringContaining('{{order.number}}') });
    expect(tpl.find((x: any) => x.event === 'staff_new_order').text).toBeNull();
    const own = tpl.find((x: any) => x.event === 'order_confirmed');
    const long = await admin.patch('/api/v1/notification_templates/order_confirmed', { subject: own.subject, body: own.body, locale: 'en', text: 'x'.repeat(700) });
    expect([long.status, long.body.errors[0].field]).toEqual([422, 'text']);
    await admin.patch('/api/v1/notification_templates/order_confirmed', { subject: own.subject, body: own.body, locale: 'en', text: 'Thanks {{customer.name}}! #{{order.number}} & see you.' });
    const c = (await admin.post('/api/v1/customers', { name: 'Olga Own', email: 'olga@test.dev', phone: '+3725550105', sms_opt_in: true })).body;
    const o = await booking(c.id);
    // Plain text: no HTML escaping of "&".
    expect((await texts('+3725550105'))[0].body_text).toBe(`Thanks Olga Own! #${o.number} & see you.`);
    await admin.patch('/api/v1/notification_templates/order_confirmed', { subject: own.subject, body: own.body, locale: 'en', text: '' });
    await booking(c.id);
    expect(await texts('+3725550105')).toHaveLength(1);
    await admin.patch('/api/v1/notification_templates/order_confirmed', { subject: own.subject, body: own.body, locale: 'en', text: null });
    expect((await admin.get('/api/v1/notification_templates?locale=en')).body.data.find((x: any) => x.event === 'order_confirmed').text_builtin).toBe(true);
  });

  it('lets customers opt in at checkout and in their account', async () => {
    const s = await shop().post('/api/v1/storefront/checkout_sessions', { starts_at: isoIn(10), ends_at: isoIn(11), lines: [{ variant_id: variant, quantity: 1 }] });
    const done = await shop().post(`/api/v1/storefront/checkout_sessions/${s.body.id}/actions/complete`, {
      customer: { name: 'Cora Checkout', email: 'cora@test.dev', phone: '+3725550106', sms_opt_in: true }, terms_accepted: true, terms_hash: terms,
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const cora = (await admin.get('/api/v1/customers?q=cora@test.dev')).body.data[0];
    expect(cora).toMatchObject({ sms_opt_in: true, phone: '+3725550106' });
    const n = await withSystem(t.deps.db, async (c) => (await c.query(`SELECT count(*)::int AS n FROM notifications WHERE channel = 'sms' AND recipient = '+3725550106'`)).rows[0].n);
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('sends a test text right away, and checks the number', async () => {
    const bad = await admin.post('/api/v1/notifications/actions/test_text', { to: '555 1234', channel: 'sms' });
    expect([bad.status, bad.body.errors[0].field]).toEqual([422, 'to']);
    const r = await admin.post('/api/v1/notifications/actions/test_text', { to: '+372 5550 1007', channel: 'sms' });
    expect(r.body).toMatchObject({ object: 'text_test', status: 'sent', to: '+37255501007' });
    expect(fake.messages.at(-1)!.body).toBe('Test Rentals: a test message from OpenRent. Text messages work.');
    expect(notifications.normalizePhone('00 372 5550-1007')).toBe('+37255501007');
  });
});
