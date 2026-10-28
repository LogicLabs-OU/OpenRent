import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signatures, type Ctx } from '@openrent/core';
import { withTenant } from '@openrent/db';
import { startDocumensoFake, type DocumensoFake } from '@openrent/sign-fakes';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Signing through an outside service (FR-DOC-6): Documenso signs its copy and reports back. */
suite('external e-signatures', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let fake: DocumensoFake;
  let order: any;
  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, tenantId, (c) => fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: t.deps.config as any, logger: quietLogger }));
  const contract = async () => (await admin.post(`/api/v1/orders/${order.id}/documents`, { type: 'contract' })).body;
  const webhook = (body: string, secret: string) => t.app.inject({ method: 'POST', url: `/webhooks/sign/sign-documenso/${tenantId}`, headers: { 'content-type': 'application/json', 'x-documenso-secret': secret }, payload: body });

  beforeAll(async () => {
    let locationId: string;
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    fake = await startDocumensoFake({ apiKey: 'api_test_key_123' });
    const variant = (await admin.post('/api/v1/products', { type: 'rental', name: 'Van', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 9000 } })).body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId}`, { quantity: 2 });
    const c = (await admin.post('/api/v1/customers', { name: 'Vera Van', email: 'vera@test.dev', locale: 'de' })).body;
    order = (await admin.post('/api/v1/orders', { customer_id: c.id, starts_at: isoIn(3), ends_at: isoIn(4), lines: [{ variant_id: variant, quantity: 1 }] })).body;
    await admin.post(`/api/v1/orders/${order.id}/actions/reserve`, { notify: false });
  }, 120_000);

  afterAll(async () => {
    await fake?.close();
    await t?.close();
    await dbinfo?.stop();
  });

  it('signs with the emailed code while no signing service is set up', async () => {
    const r = await admin.post(`/api/v1/documents/${(await contract()).id}/actions/request_signature`, {});
    expect(r.body.provider).toBe('builtin');
  });

  it('sends the document to Documenso once it is set up, and keeps the signed PDF from its webhook', async () => {
    const set = await admin.patch('/api/v1/plugins/sign-documenso', { config: { api_key: 'api_test_key_123', webhook_secret: 'whsec-1', api_url: fake.url } });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const doc = await contract();
    const r = await admin.post(`/api/v1/documents/${doc.id}/actions/request_signature`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ provider: 'documenso', provider_url: 'https://documenso.test/sign/tok0', status: 'pending' });
    const envelope = [...fake.envelopes.values()].at(-1)!;
    expect(envelope).toMatchObject({ status: 'PENDING', recipients: [{ name: 'Vera Van', email: 'vera@test.dev', role: 'SIGNER' }] });
    expect(envelope.title).toMatch(/^Rental agreement /);
    fake.complete(envelope.id);
    expect((await webhook(fake.webhookBody(envelope.id, 'DOCUMENT_COMPLETED'), 'wrong-1')).statusCode).toBe(401);
    const ok = await webhook(fake.webhookBody(envelope.id, 'DOCUMENT_COMPLETED'), 'whsec-1');
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'signed' });
    const sigs = (await admin.get(`/api/v1/documents/${doc.id}/signatures`)).body;
    expect(sigs.requests[0].status).toBe('signed');
    expect(sigs.signatures[0]).toMatchObject({ method: 'external', signer_email: 'vera@test.dev', has_pdf: true });
    // The same webhook again changes nothing.
    expect((await webhook(fake.webhookBody(envelope.id, 'DOCUMENT_COMPLETED'), 'whsec-1')).json()).toMatchObject({ status: null });
  }, 120_000);

  it('learns of a refusal by asking, when no webhook came', async () => {
    const doc = await contract();
    await admin.post(`/api/v1/documents/${doc.id}/actions/request_signature`, {});
    const envelope = [...fake.envelopes.values()].at(-1)!;
    fake.reject(envelope.id);
    expect(await inTenant((ctx) => signatures.syncExternalSignatures(ctx))).toBe(1);
    expect((await admin.get(`/api/v1/documents/${doc.id}/signatures`)).body.requests[0].status).toBe('declined');
  }, 120_000);
});
