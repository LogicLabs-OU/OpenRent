import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { missing, toUbl } from '../src/ubl.ts';
import { parseEndpoint } from '../src/index.ts';
import { sample } from './sample.ts';
import { validate } from './xsd.ts';

const UBL = path.join(import.meta.dirname, 'fixtures/ubl-2.1');

describe('Peppol BIS Billing 3.0', () => {
  it('writes an invoice the UBL 2.1 schema accepts, with the Peppol profile and totals', async () => {
    const xml = toUbl(sample());
    expect(await validate(xml, UBL, 'maindoc/UBL-Invoice-2.1.xsd')).toEqual([]);
    expect(xml).toContain('<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>');
    expect(xml).toContain('<cbc:EndpointID schemeID="0191">10002345</cbc:EndpointID>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">70.00</cbc:PayableAmount>');
    expect(xml).toContain('<cbc:PrepaidAmount currencyID="EUR">20.00</cbc:PrepaidAmount>');
    expect(xml).toContain('Delivery &amp; pickup &lt;zone 1&gt;');
    expect(xml).toContain('<cbc:ID>EE382200221020145685</cbc:ID>');
  });

  it('is checked for real: the schema refuses elements out of order', async () => {
    const xml = toUbl(sample()).replace(/(<cbc:IssueDate>[^<]*<\/cbc:IssueDate>)(<cbc:DueDate>[^<]*<\/cbc:DueDate>)/, '$2$1');
    expect((await validate(xml, UBL, 'maindoc/UBL-Invoice-2.1.xsd')).length).toBeGreaterThan(0);
  });

  it('writes a credit note for the invoice it credits', async () => {
    const xml = toUbl(sample({ type: 'credit_note', number: 'CN-2026-00003', precedingInvoice: { number: 'INV-2026-00042', issueDate: '2026-10-27' }, totals: { lineNet: 7500, taxExclusive: 7500, tax: 1500, taxInclusive: 9000, prepaid: 0, payable: 9000 } }));
    expect(await validate(xml, UBL, 'maindoc/UBL-CreditNote-2.1.xsd')).toEqual([]);
    expect(xml).toContain('<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>');
    expect(xml).toContain('<cac:InvoiceDocumentReference><cbc:ID>INV-2026-00042</cbc:ID>');
  });

  it('writes the reverse charge with its reason and the buyer’s VAT number', async () => {
    const lines = sample().lines.map((l) => ({ ...l, taxAmount: 0, taxRateBp: 0, taxCategory: 'AE' as const }));
    const inv = sample({ lines, taxBreakdown: [{ category: 'AE', rateBp: 0, taxable: 7500, tax: 0 }], totals: { lineNet: 7500, taxExclusive: 7500, tax: 0, taxInclusive: 7500, prepaid: 0, payable: 7500 } });
    const xml = toUbl(inv);
    expect(await validate(xml, UBL, 'maindoc/UBL-Invoice-2.1.xsd')).toEqual([]);
    expect(xml).toContain('<cbc:ID>AE</cbc:ID><cbc:Percent>0</cbc:Percent><cbc:TaxExemptionReason>Reverse charge</cbc:TaxExemptionReason>');
    expect(missing({ ...inv, buyer: { ...inv.buyer, vatId: null } })).toEqual(['buyer.vatId']);
  });

  it('says what Peppol needs that the invoice lacks', () => {
    expect(missing(sample())).toEqual([]);
    expect(missing(sample({ buyerReference: null, orderReference: null, buyer: { ...sample().buyer, endpoint: null } }))).toEqual(['buyer.endpoint', 'buyerReference']);
    expect(parseEndpoint(' 0191:10002345 ')).toEqual({ scheme: '0191', id: '10002345' });
    expect(parseEndpoint('10002345')).toBeNull();
  });

  it('keeps the line amounts adding up to the totals (BR-CO-10, BR-CO-15)', () => {
    const inv = sample();
    expect(inv.lines.reduce((s, l) => s + l.netAmount, 0)).toBe(inv.totals.lineNet);
    expect(inv.totals.taxExclusive + inv.totals.tax).toBe(inv.totals.taxInclusive);
  });
});
