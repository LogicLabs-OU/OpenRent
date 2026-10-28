import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validateXML } from 'xmllint-wasm';
import { describe, expect, it } from 'vitest';
import { missing, referenceNumber, toEarve } from '../src/earve.ts';
import { sample } from './sample.ts';

// The e-arve schema states no license for copies, so it is fetched from ITL and kept outside the repository.
const URL = 'https://wp.itl.ee/files/IoB/uued/e-invoice_ver1.2.EN.xsd';
const CACHE = path.join(import.meta.dirname, '../node_modules/.cache/e-invoice_ver1.2.EN.xsd');
async function schema(): Promise<string | null> {
  if (existsSync(CACHE)) return readFileSync(CACHE, 'utf8');
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const text = await res.text();
    mkdirSync(path.dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, text);
    return text;
  } catch {
    return null;
  }
}
async function errors(xml: string) {
  const xsd = await schema();
  if (!xsd) return null;
  const r = await validateXML({ xml: [{ fileName: 'doc.xml', contents: xml }], schema: [{ fileName: 'e-invoice_ver1.2.EN.xsd', contents: xsd }] });
  return r.valid ? [] : r.errors.map((e) => e.message ?? e.rawMessage);
}

describe('Estonian e-invoice (e-arve)', () => {
  it('makes payment reference numbers with the 7-3-1 check digit', () => {
    // Examples from the Estonian banks' description of the method.
    expect(referenceNumber('1234')).toBe('12344');
    expect(referenceNumber('INV-2026-00042')).toBe(`202600042${referenceNumber('202600042').slice(-1)}`);
    expect(referenceNumber('123')).toBe('1232');
  });

  it('writes an invoice the e-arve 1.2 schema accepts', async (t) => {
    const xml = toEarve(sample(), { id: 'INV-2026-00042', date: '2026-10-27' });
    const found = await errors(xml);
    if (found === null) t.skip();
    expect(found).toEqual([]);
    expect(xml).toContain('<Type type="DEB"></Type>');
    expect(xml).toContain('<PayToAccount>EE382200221020145685</PayToAccount>');
    expect(xml).toContain('<TotalToPay>70.00</TotalToPay>');
  });

  it('writes a credit note naming its invoice', async (t) => {
    const xml = toEarve(sample({ type: 'credit_note', number: 'CN-2026-00003', precedingInvoice: { number: 'INV-2026-00042', issueDate: '2026-10-27' } }), { id: 'CN-2026-00003', date: '2026-10-27' });
    const found = await errors(xml);
    if (found === null) t.skip();
    expect(found).toEqual([]);
    expect(xml).toContain('<Type type="CRE"><SourceInvoice>INV-2026-00042</SourceInvoice></Type>');
    expect(xml).toContain('<Payable>NO</Payable>');
  });

  it('says what an e-arve needs: the registry code, a bank account and euros', () => {
    expect(missing(sample())).toEqual([]);
    expect(missing(sample({ currency: 'USD', payment: null, seller: { ...sample().seller, companyId: null } }))).toEqual(['seller.companyId', 'payment.iban', 'currency']);
  });
});
