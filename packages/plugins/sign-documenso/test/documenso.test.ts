import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { startDocumensoFake, type DocumensoFake } from '@openrent/sign-fakes';
import { createDocumensoProvider } from '../src/index.ts';

describe('Documenso against the Documenso fake', () => {
  let fake: DocumensoFake;
  let pdf: Uint8Array;
  const provider = createDocumensoProvider();
  const ctx = () => ({ tenantId: 't1', config: { api_key: 'api_test_key_123', webhook_secret: 'whsec-1', api_url: fake.url }, logger: console as any });
  beforeAll(async () => {
    fake = await startDocumensoFake({ apiKey: 'api_test_key_123' });
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    pdf = await doc.save();
  });
  afterAll(() => fake?.close());

  it('sends the PDF with a signer and a signature field on the last page', async () => {
    const r = await provider.requestSignature(ctx(), { documentId: 'doc_1', documentUrl: 'https://shop.test/sign/x', signer: { name: 'Ann', email: 'ann@x.ee' }, title: 'Rental agreement RA-7', locale: 'de', pdf: async () => pdf });
    const e = fake.envelopes.get(r.ref)!;
    expect(e).toMatchObject({ title: 'Rental agreement RA-7', status: 'PENDING', meta: {} });
    expect(e.recipients[0]).toMatchObject({ email: 'ann@x.ee', role: 'SIGNER', fields: [{ type: 'SIGNATURE', page: 2 }] });
    expect(r.url).toBe('https://documenso.test/sign/tok0');
    expect(await provider.status!(ctx(), r.ref)).toBe('pending');
    fake.complete(r.ref);
    expect(await provider.status!(ctx(), r.ref)).toBe('signed');
    const signed = Buffer.from((await provider.signedPdf!(ctx(), r.ref))!);
    expect(signed.toString('latin1')).toContain('%signed by documenso fake');
  });

  it('trusts only webhooks with the secret, and reads completed and rejected', async () => {
    const r = await provider.requestSignature(ctx(), { documentId: 'doc_2', documentUrl: '', signer: { name: 'Bo', email: 'bo@x.ee' }, pdf: async () => pdf });
    fake.reject(r.ref);
    const body = Buffer.from(fake.webhookBody(r.ref, 'DOCUMENT_REJECTED'));
    await expect(provider.handleWebhook!(ctx(), { rawBody: body, headers: { 'x-documenso-secret': 'wrong-1' } })).rejects.toMatchObject({ status: 401 });
    expect(await provider.handleWebhook!(ctx(), { rawBody: body, headers: { 'x-documenso-secret': 'whsec-1' } })).toEqual({ ref: r.ref, status: 'declined' });
    expect(await provider.handleWebhook!(ctx(), { rawBody: Buffer.from(fake.webhookBody(r.ref, 'DOCUMENT_OPENED')), headers: { 'x-documenso-secret': 'whsec-1' } })).toBeNull();
    await expect(provider.handleWebhook!({ ...ctx(), config: { ...ctx().config, webhook_secret: '' } }, { rawBody: body, headers: { 'x-documenso-secret': '' } })).rejects.toMatchObject({ status: 401 });
  });

  it('needs a PDF, and reports Documenso’s refusals', async () => {
    await expect(provider.requestSignature(ctx(), { documentId: 'd', documentUrl: '', signer: { name: 'A', email: 'a@x.ee' }, pdf: async () => null })).rejects.toThrow(/PDF/);
    await expect(provider.requestSignature({ ...ctx(), config: { ...ctx().config, api_key: 'wrong' } }, { documentId: 'd', documentUrl: '', signer: { name: 'A', email: 'a@x.ee' }, pdf: async () => pdf })).rejects.toThrow(/Documenso 401/);
  });
});
