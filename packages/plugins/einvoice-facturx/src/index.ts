import { definePlugin } from '@openrent/plugin-sdk';
import { AFRelationship, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { missing, toCii } from './cii.ts';

export { missing, toCii, GUIDELINE } from './cii.ts';

/** The XMP metadata Factur-X readers look for: PDF/A-3 B and the Factur-X extension schema. */
export function xmp(o: { title: string; date: Date }) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(o.title)}</rdf:li></rdf:Alt></dc:title></rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreateDate>${o.date.toISOString()}</xmp:CreateDate><xmp:ModifyDate>${o.date.toISOString()}</xmp:ModifyDate></rdf:Description>
  <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>factur-x.xml</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>EN 16931</fx:ConformanceLevel></rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
   <pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">
    <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
    <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
    <pdfaSchema:prefix>fx</pdfaSchema:prefix>
    <pdfaSchema:property><rdf:Seq>
     <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The name of the embedded XML document</pdfaProperty:description></rdf:li>
     <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The type of the hybrid document in capital letters</pdfaProperty:description></rdf:li>
     <rdf:li rdf:parseType="Resource"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The version of the standard</pdfaProperty:description></rdf:li>
     <rdf:li rdf:parseType="Resource"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The conformance level of the embedded XML document</pdfaProperty:description></rdf:li>
    </rdf:Seq></pdfaSchema:property>
   </rdf:li></rdf:Bag></pdfaExtension:schemas>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * The invoice PDF with its CII XML inside as `factur-x.xml` (relationship Alternative) and the Factur-X
 * metadata. Readers of Factur-X and ZUGFeRD take the XML; people read the PDF.
 */
export async function embed(pdf: Uint8Array, xml: string, o: { title: string; date: Date }) {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  await doc.attach(new TextEncoder().encode(xml), 'factur-x.xml', {
    mimeType: 'text/xml', description: 'Factur-X invoice', creationDate: o.date, modificationDate: o.date, afRelationship: AFRelationship.Alternative,
  });
  doc.setTitle(o.title);
  doc.setCreationDate(o.date);
  doc.setModificationDate(o.date);
  doc.setProducer('OpenRent');
  const meta = doc.context.stream(xmp(o), { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(meta));
  doc.catalog.set(PDFName.of('Lang'), PDFString.of('en'));
  return doc.save({ useObjectStreams: false });
}

/**
 * Factur-X / ZUGFeRD e-invoices (FR-DOC-6): the invoice PDF with its EN 16931 XML inside, as French and
 * German buyers expect. One file serves both people and their accounting software.
 */
export default definePlugin({
  id: 'einvoice-facturx',
  name: 'Factur-X / ZUGFeRD e-invoices',
  version: '1.0.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.9.0',
  permissions: ['documents:read'],
  setup(api) {
    api.registerEInvoiceFormat({
      id: 'facturx',
      name: { en: 'Factur-X / ZUGFeRD (PDF)', de: 'ZUGFeRD / Factur-X (PDF)', fr: 'Factur-X (PDF)', es: 'Factur-X / ZUGFeRD (PDF)', et: 'Factur-X / ZUGFeRD (PDF)', ja: 'Factur-X / ZUGFeRD（PDF）', nl: 'Factur-X / ZUGFeRD (PDF)' },
      endpoint: false,
      isConfigured: () => true,
      async render(_ctx, invoice, files) {
        const gaps = missing(invoice);
        if (gaps.length) return { missing: gaps };
        const pdf = await files.pdf();
        if (!pdf) return { missing: ['pdf'] };
        const content = await embed(pdf, toCii(invoice), { title: invoice.number, date: new Date(`${invoice.issueDate}T12:00:00Z`) });
        return { filename: `${invoice.number}.pdf`, contentType: 'application/pdf', content: Buffer.from(content) };
      },
    });
  },
});
