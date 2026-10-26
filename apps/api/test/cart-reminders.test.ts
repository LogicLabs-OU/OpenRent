import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storefront, type Ctx } from '@openrent/core';
import { withSystem, withTenant } from '@openrent/db';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;
const HOUR = 3_600_000;

/** Abandoned-cart reminders (FR-SF-9): one email, a link back, a way to stop them. */
suite('cart reminders', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let variant: string;
  let terms: string;
  const shop = () => new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>, now = new Date()) =>
    withTenant(t.deps.db, tenantId, (c) =>
      fn({ db: c, tenantId, actor: { type: 'system', id: null }, now, plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: 'http://shop.test', livemode: false }, logger: quietLogger }),
    );
  const remind = (hoursLater: number) => inTenant((ctx) => storefront.sendCartReminders(ctx), new Date(Date.now() + hoursLater * HOUR));
  const leave = async (email: string, offset = 10) => {
    const s = await shop().post('/api/v1/storefront/checkout_sessions', { starts_at: isoIn(offset), ends_at: isoIn(offset + 1), lines: [{ variant_id: variant, quantity: 1 }] });
    await shop().patch(`/api/v1/storefront/checkout_sessions/${s.body.id}`, { customer: { name: 'Leaving Lisa', email } });
    return s.body.id as string;
  };
  const mails = (email: string) => withSystem(t.deps.db, async (c) => (await c.query(`SELECT body_html FROM notifications WHERE template_key = 'cart_reminder' AND recipient = $1`, [email])).rows);
  const tokenIn = (html: string) => decodeURIComponent(/cart\/restore\?token=([^"&]+)/.exec(html.replace(/&#x3D;/g, '='))![1]!);

  beforeAll(async () => {
    let locationId: string;
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Paddle board', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 3000 } });
    variant = p.body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId!}`, { quantity: 10 });
    terms = (await shop().get('/api/v1/storefront/settings')).body.terms.hash;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('sends nothing until the shop turns reminders on, and checks the hours', async () => {
    await leave('off@test.dev');
    expect(await remind(5)).toBe(0);
    expect((await admin.patch('/api/v1/tenant/settings', { cart_reminders: { enabled: true, after_hours: 0 } })).body.errors[0].field).toBe('cart_reminders.after_hours');
    expect((await admin.patch('/api/v1/tenant/settings', { cart_reminders: { enabled: true, after_hours: 2 } })).status).toBe(200);
  });

  it('sends one reminder after the hours, and the link brings the cart back', async () => {
    const id = await leave('lisa@test.dev');
    expect(await remind(1)).toBe(0);
    expect(await remind(3)).toBeGreaterThanOrEqual(1);
    expect(await remind(4)).toBe(0);
    const sent = await mails('lisa@test.dev');
    expect(sent).toHaveLength(1);
    expect(sent[0].body_html).toContain('Paddle board');
    const token = tokenIn(sent[0].body_html);
    // Nothing about the customer can be read from the link.
    expect(token).not.toContain('lisa');
    const back = await shop().post('/api/v1/storefront/checkout_sessions/restore', { token });
    expect(back.status, JSON.stringify(back.body)).toBe(201);
    expect(back.body).toMatchObject({ dates_kept: true });
    expect(back.body.id).not.toBe(id);
    const cart = (await shop().get(`/api/v1/storefront/checkout_sessions/${back.body.id}`)).body;
    expect(cart.lines.map((l: any) => [l.variant_id, l.quantity])).toEqual([[variant, 1]]);
    expect((await shop().post('/api/v1/storefront/checkout_sessions/restore', { token: 'v1.forged.token.value-nothing' })).status).toBe(404);
  });

  it('stops for an email that asked, and skips people who booked since', async () => {
    await leave('stop@test.dev');
    await remind(3);
    const token = tokenIn((await mails('stop@test.dev'))[0].body_html);
    expect((await shop().post('/api/v1/storefront/cart_reminders/opt_out', { token })).body).toEqual({ object: 'reminder_optout', stopped: true });
    await leave('stop@test.dev', 20);
    await remind(3);
    expect(await mails('stop@test.dev')).toHaveLength(1);

    await leave('booked@test.dev', 30);
    const s = await shop().post('/api/v1/storefront/checkout_sessions', { starts_at: isoIn(40), ends_at: isoIn(41), lines: [{ variant_id: variant, quantity: 1 }] });
    expect((await shop().post(`/api/v1/storefront/checkout_sessions/${s.body.id}/actions/complete`, { customer: { name: 'Booked Ben', email: 'booked@test.dev' }, terms_accepted: true, terms_hash: terms })).status).toBe(200);
    await remind(3);
    expect(await mails('booked@test.dev')).toHaveLength(0);
  });
});
