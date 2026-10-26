import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notifications, type Ctx } from '@openrent/core';
import { withTenant } from '@openrent/db';
import { Client, databaseForTests, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

suite('the shop’s own wording', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, tenantId, (c) =>
      fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: 'http://shop.test', livemode: false }, logger: quietLogger }),
    );

  beforeAll(async () => {
    ({ t, admin, tenantId } = await shopForTests(dbinfo!));
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('lists every set of texts and searches them', async () => {
    const ids = (await admin.get('/api/v1/string_namespaces')).body.data.map((n: any) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['storefront', 'email', 'documents', 'theme:default', 'theme:retro']));
    const found = await admin.get('/api/v1/strings?namespace=email&locale=de&q=order_confirmed.subject');
    expect(found.body).toMatchObject({ total: 1, changed: 0, data: [{ key: 'email.order_confirmed.subject', english: 'Your booking #{number} is confirmed', value: null }] });
    expect((await admin.get('/api/v1/strings?namespace=nope&locale=en')).status).toBe(404);
    expect((await admin.get('/api/v1/strings?namespace=email&locale=xx')).body.errors[0].field).toBe('locale');
  });

  it('keeps placeholders and applies the wording to emails, themes and the storefront', async () => {
    const bad = await admin.put('/api/v1/strings/email/en', { values: { 'email.order_confirmed.subject': 'Booked!', 'not.a.key': 'x' } });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((e: any) => e.field)).toEqual(['values.email.order_confirmed.subject', 'values.not.a.key']);
    expect(bad.body.errors[0].message).toContain('{number}');

    expect((await admin.put('/api/v1/strings/email/en', { values: { 'email.order_confirmed.subject': 'Booked! No. {number}' } })).status).toBe(200);
    const msg = await inTenant((ctx) => notifications.render(ctx, 'order_confirmed', { order: { number: 1042, public_token: 'x' }, customer: { name: 'A', locale: 'en' }, lines: [], totals: {} }, { audience: 'customer', locale: 'en' }));
    expect(msg.subject).toBe('Booked! No. 1042');
    // Other languages keep the built-in text.
    const de = await inTenant((ctx) => notifications.render(ctx, 'order_confirmed', { order: { number: 1042, public_token: 'x' }, customer: { name: 'A' }, lines: [], totals: {} }, { audience: 'customer', locale: 'de' }));
    expect(de.subject).not.toContain('Booked!');

    await admin.put('/api/v1/strings/theme:default/en', { values: { 'nav.all': 'Rent it all' } });
    await admin.put('/api/v1/strings/storefront/en', { values: { 'error.generic': 'Oops, try again.' } });
    const settings = (await t.app.inject({ method: 'GET', url: '/api/v1/storefront/settings' })).json();
    expect(settings.theme.translations.en['nav.all']).toBe('Rent it all');
    expect(settings.strings['error.generic']).toBe('Oops, try again.');

    const list = await admin.get('/api/v1/strings?namespace=theme:default&locale=en&changed=true');
    expect(list.body.data).toEqual([expect.objectContaining({ key: 'nav.all', value: 'Rent it all' })]);
    await admin.put('/api/v1/strings/theme:default/en', { values: { 'nav.all': null } });
    expect((await admin.get('/api/v1/strings?namespace=theme:default&locale=en&changed=true')).body.data).toEqual([]);
    expect((await admin.get('/api/v1/strings/storefront/en/catalog')).body.strings['error.generic']).toBe('Oops, try again.');
  });
});
