import path from 'node:path';
import { PDFDocument, PDFDict, PDFName, PDFArray, PDFHexString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { embed, missing, toCii } from '../src/index.ts';
import { sample } from './sample.ts';
import { validate } from './xsd.ts';

const CII = path.join(import.meta.dirname, 'fixtures/cii');
const MAIN = 'uncefact/data/standard/CrossIndustryInvoice_100pD16B.xsd';

describe('Factur-X / ZUGFeRD', () => {
  it('writes CII the D16B schema accepts, in the EN 16931 profile', async () => {
    const xml = toCii(sample());
    expect(await validate(xml, CII, MAIN)).toEqual([]);
    expect(xml).toContain('<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID>');
    expect(xml).toContain('<ram:IssueDateTime><udt:DateTimeString format="102">20261027</udt:DateTimeString></ram:IssueDateTime>');
    expect(xml).toContain('<ram:DuePayableAmount>70.00</ram:DuePayableAmount>');
  });

  it('writes a credit note and the reverse charge', async () => {
    const lines = sample().lines.map((l) => ({ ...l, taxAmount: 0, taxRateBp: 0, taxCategory: 'AE' as const }));
    const xml = toCii(sample({ type: 'credit_note', number: 'CN-1', precedingInvoice: { number: 'INV-2026-00042', issueDate: '2026-10-27' }, lines, taxBreakdown: [{ category: 'AE', rateBp: 0, taxable: 7500, tax: 0 }], totals: { lineNet: 7500, taxExclusive: 7500, tax: 0, taxInclusive: 7500, prepaid: 0, payable: 7500 } }));
    expect(await validate(xml, CII, MAIN)).toEqual([]);
    expect(xml).toContain('<ram:TypeCode>381</ram:TypeCode>');
    expect(xml).toContain('<ram:ExemptionReason>Reverse charge</ram:ExemptionReason>');
    expect(missing(sample({ seller: { ...sample().seller, vatId: null } }))).toEqual(['seller.vatId']);
  });

  it('puts the XML inside the PDF as factur-x.xml, with the Factur-X metadata', async () => {
    const src = await PDFDocument.create();
    src.addPage([595, 842]);
    const out = await embed(await src.save(), toCii(sample()), { title: 'INV-2026-00042', date: new Date('2026-10-27T12:00:00Z') });
    const doc = await PDFDocument.load(out);
    const names = doc.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('EmbeddedFiles'), PDFDict).lookup(PDFName.of('Names'), PDFArray);
    expect((names.lookup(0) as PDFHexString).decodeText()).toBe('factur-x.xml');
    expect(doc.catalog.lookup(PDFName.of('AF'), PDFArray).size()).toBe(1);
    const meta = new TextDecoder().decode((doc.catalog.lookup(PDFName.of('Metadata')) as any).contents);
    expect(meta).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(meta).toContain('<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>');
  });
});
