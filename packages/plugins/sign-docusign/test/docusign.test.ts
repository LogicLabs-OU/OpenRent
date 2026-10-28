import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { startDocuSignFake, type DocuSignFake } from '@openrent/sign-fakes';
import { createDocuSignProvider } from '../src/index.ts';

describe('DocuSign against the DocuSign fake', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let fake: DocuSignFake;
  let pdf: Uint8Array;
  const provider = createDocuSignProvider();
  const ctx = (over: Record<string, unknown> = {}) => ({
    tenantId: 't1', logger: console as any,
    config: { integration_key: 'ik-1', user_id: 'user-1', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), hmac_key: 'hmac-1', auth_url: fake.url, ...over },
  });
  beforeAll(async () => {
    fake = await startDocuSignFake({ integrationKey: 'ik-1', userId: 'user-1', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() });
    const doc = await PDFDocument.create();
    doc.addPage();
    pdf = await doc.save();
  });
  afterAll(() => fake?.close());

  it('signs in with the JWT grant and sends an envelope with a Sign Here tab', async () => {
    expect(provider.isConfigured(ctx())).toBe(true);
    const r = await provider.requestSignature(ctx(), { documentId: 'doc_1', documentUrl: '', signer: { name: 'Ann', email: 'ann@x.ee' }, title: 'Rental agreement RA-7', pdf: async () => pdf });
    const e = fake.envelopes.get(r.ref)!;
    expect(e).toMatchObject({ status: 'sent', emailSubject: 'Rental agreement RA-7', signers: [{ email: 'ann@x.ee', recipientId: '1', tabs: { signHereTabs: [{ pageNumber: '1' }] } }] });
    fake.complete(r.ref);
    expect(await provider.status!(ctx(), r.ref)).toBe('signed');
    expect(Buffer.from((await provider.signedPdf!(ctx(), r.ref))!).toString('latin1')).toContain('%completed by docusign fake');
  });

  it('refuses a key DocuSign does not know', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    // Another shop, so no sign-in is cached.
    const c = { ...ctx({ private_key: other }), tenantId: 't2' };
    await expect(provider.requestSignature(c, { documentId: 'd', documentUrl: '', signer: { name: 'A', email: 'a@x.ee' }, pdf: async () => pdf })).rejects.toThrow(/DocuSign sign-in: invalid_grant/);
  });

  it('trusts only Connect messages signed with the HMAC key', async () => {
    const r = await provider.requestSignature(ctx(), { documentId: 'doc_2', documentUrl: '', signer: { name: 'Bo', email: 'bo@x.ee' }, pdf: async () => pdf });
    fake.decline(r.ref);
    const { body, signature } = fake.webhook(r.ref, 'hmac-1');
    expect(await provider.handleWebhook!(ctx(), { rawBody: Buffer.from(body), headers: { 'x-docusign-signature-1': signature } })).toEqual({ ref: r.ref, status: 'declined' });
    const forged = fake.webhook(r.ref, 'other-key');
    await expect(provider.handleWebhook!(ctx(), { rawBody: Buffer.from(forged.body), headers: { 'x-docusign-signature-1': forged.signature } })).rejects.toMatchObject({ status: 401 });
  });
});
