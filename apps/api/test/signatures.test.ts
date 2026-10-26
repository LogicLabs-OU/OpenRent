import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { withTenant } from '@openrent/db';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Signing documents with an emailed code (FR-DOC-5). */
suite('e-signatures', () => {
  let t: TestApp;
  let admin: Client;
  let sf: Client;
  let tenantId: string;
  let orderId: string;
  let docId: string;
  let token: string;
  // A 1×1 transparent PNG.
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  const sql = <T = any>(text: string, values: unknown[] = []) => withTenant(t.deps.db, tenantId, async (c) => (await c.query(text, values)).rows as T[]);
  /** The newest email of a template: link token or code out of its body. */
  const lastMail = async (template: string) => (await sql(`SELECT recipient, body_html FROM notifications WHERE template_key = $1 ORDER BY created_at DESC LIMIT 1`, [template]))[0];
  const sign = (body: Record<string, unknown>, tk = token) => sf.post(`/api/v1/storefront/signatures/${tk}/actions/sign`, { consent: true, name: 'Sig Customer', ...body });
  const issue = async () => (await admin.post(`/api/v1/orders/${orderId}/documents`, { type: 'contract' })).body.id;

  beforeAll(async () => {
    ({ t, admin, tenantId } = await shopForTests(dbinfo!));
    sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
    const customer = (await admin.post('/api/v1/customers', { name: 'Sig Customer', email: 'signer@test.dev' })).body.id;
    const v = (await admin.post('/api/v1/products', { type: 'rental', name: 'Tent', tracking: 'none', price: { kind: 'per_period', period_unit: 'day', amount: 1000 } })).body.variants[0].id;
    orderId = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(5), ends_at: isoIn(6), lines: [{ variant_id: v, quantity: 1 }] })).body.id;
    docId = await issue();
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('emails a signing link to the customer, one open request per document', async () => {
    const r = await admin.post(`/api/v1/documents/${docId}/actions/request_signature`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: 'pending', signer_name: 'Sig Customer', signer_email: 'signer@test.dev', provider: 'builtin' });
    const mail = await lastMail('signature_requested');
    expect(mail.recipient).toBe('signer@test.dev');
    token = /\/sign\/([A-Za-z0-9_-]+)/.exec(mail.body_html)![1]!;
    expect((await admin.post(`/api/v1/documents/${docId}/actions/request_signature`, {})).body.code).toBe('signature_pending');
    const bad = await admin.post(`/api/v1/documents/${await issue()}/actions/request_signature`, { signer_email: 'nope' });
    expect([bad.status, bad.body.errors[0].field]).toEqual([422, 'signer_email']);
  });

  it('shows the document to the signer and records the first look', async () => {
    const page = (await sf.get(`/api/v1/storefront/signatures/${token}`)).body;
    expect(page).toMatchObject({ status: 'pending', signer_name: 'Sig Customer', signer_email: 's•••••@test.dev', code_sent: false, document: { type: 'contract', title: 'Rental agreement' } });
    const html = await sf.get(`/api/v1/storefront/signatures/${token}/document`);
    expect(html.status).toBe(200);
    const req = (await admin.get(`/api/v1/documents/${docId}/signatures`)).body.requests[0];
    expect(req.viewed_at).toBeTruthy();
    expect((await sf.get('/api/v1/storefront/signatures/not-a-real-token-at-all')).status).toBe(404);
  });

  it('needs the emailed code, counts wrong tries and checks the consent', async () => {
    const noCode = await sign({ code: '000000' });
    expect([noCode.status, noCode.body.errors[0].field]).toEqual([422, 'code']);
    const sent = (await sf.post(`/api/v1/storefront/signatures/${token}/actions/send_code`, {})).body;
    expect(sent).toMatchObject({ sent_to: 's•••••@test.dev', expires_in_minutes: 10 });
    const code = /letter-spacing:6px">(\d{6})</.exec((await lastMail('signature_code')).body_html)![1]!;
    const wrong = await sign({ code: code === '123456' ? '654321' : '123456' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.errors[0].message).toContain('3 tries left');
    expect((await sql(`SELECT attempts FROM signature_requests WHERE document_id = $1`, [docId]))[0].attempts).toBe(2);
    const noConsent = await sign({ code, consent: false });
    expect([noConsent.status, noConsent.body.errors[0].field]).toEqual([422, 'consent']);

    const ok = await sign({ code, image: PNG });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.signature).toMatchObject({ method: 'drawn', signer_name: 'Sig Customer', signer_email: 'signer@test.dev' });
    const docHtml = (await sql(`SELECT html FROM documents WHERE id = $1`, [docId]))[0].html;
    expect(ok.body.signature.html_sha256).toBe(createHash('sha256').update(docHtml).digest('hex'));
    expect((await sign({ code })).body.code).toBe('request_signed');
    expect((await lastMail('document_signed')).recipient).toBe('signer@test.dev');
    const list = (await admin.get(`/api/v1/documents/${docId}/signatures`)).body;
    expect([list.requests[0].status, list.signatures.length]).toEqual(['signed', 1]);
    // Signatures cannot be changed afterwards.
    await expect(sql(`UPDATE signatures SET signer_name = 'Someone else'`)).rejects.toThrow(/cannot be changed/);
  });

  it('locks the request after five wrong codes, and staff can withdraw a request', async () => {
    const other = await issue();
    await admin.post(`/api/v1/documents/${other}/actions/request_signature`, {});
    const tk = /\/sign\/([A-Za-z0-9_-]+)/.exec((await lastMail('signature_requested')).body_html)![1]!;
    await sf.post(`/api/v1/storefront/signatures/${tk}/actions/send_code`, {});
    for (let i = 0; i < 5; i++) expect((await sign({ code: '999999' }, tk)).status).toBe(422);
    expect((await sign({ code: '999999' }, tk)).body.code).toBe('request_locked');
    const req = (await admin.get(`/api/v1/documents/${other}/signatures`)).body.requests[0];
    expect((await admin.post(`/api/v1/signature_requests/${req.id}/actions/cancel`, {})).body.status).toBe('cancelled');
    expect((await sf.get(`/api/v1/storefront/signatures/${tk}`)).body.status).toBe('cancelled');
  });
});
