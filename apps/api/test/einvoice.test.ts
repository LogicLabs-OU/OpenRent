import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { withSystem } from '@openrent/db';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** E-invoices (FR-DOC-6): invoices in the format a company's billing details ask for. */
suite('e-invoices', () => {
  let t: TestApp;
  let admin: Client;
  let customer: any;
  let variant: string;
  let locationId: string;

  beforeAll(async () => {
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
    await admin.patch('/api/v1/tenant', { legal_name: 'Test Rentals OÜ', address: { line1: 'Narva mnt 5', city: 'Tallinn', postal_code: '10117', country: 'EE' }, tax_ids: [{ type: 'VAT', value: 'EE100000001' }] });
    variant = (await admin.post('/api/v1/products', { type: 'rental', name: 'Projector', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 5000 } })).body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId}`, { quantity: 5 });
    customer = (await admin.post('/api/v1/customers', { type: 'company', name: 'Stage Co', company_name: 'Stage Co AS', email: 'stage@test.dev' })).body;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  const invoice = async (from: number) => {
    const o = (await admin.post('/api/v1/orders', { customer_id: customer.id, location_id: locationId, starts_at: isoIn(from), ends_at: isoIn(from + 1), po_number: 'PO-9', lines: [{ variant_id: variant, quantity: 1 }] })).body;
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { notify: false });
    return (await admin.post(`/api/v1/orders/${o.id}/documents`, { type: 'invoice' })).body;
  };

  it('keeps the shop’s registry code and bank account, checking the IBAN', async () => {
    const bad = await admin.patch('/api/v1/tenant/settings', { invoicing: { iban: 'EE38 2200 2210 2014 5684' } });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((e: any) => e.field)).toEqual(['invoicing.iban']);
    const ok = await admin.patch('/api/v1/tenant/settings', { invoicing: { registry_code: '10002345', iban: 'EE38 2200 2210 2014 5685', bic: 'HABAEE2X' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('offers the formats that are set up, and needs a Peppol ID for Peppol', async () => {
    expect((await admin.get('/api/v1/einvoice_formats')).body.data.map((f: any) => f.id).sort()).toEqual(['earve', 'facturx']);
    await admin.patch('/api/v1/plugins/einvoice-peppol', { config: { seller_endpoint: '0191:10002345' } });
    expect((await admin.get('/api/v1/einvoice_formats')).body.data.map((f: any) => [f.id, f.endpoint]).sort()).toEqual([['earve', false], ['facturx', false], ['peppol', true]]);
    const base = { kind: 'company', name: 'Mari', company_name: 'Stage Co AS', tax_id: 'EE102030405', address: { line1: 'Pärnu mnt 10', city: 'Tallinn', postal_code: '10148', country: 'EE' } };
    const noId = await admin.post(`/api/v1/customers/${customer.id}/billing_profiles`, { ...base, einvoice: { format: 'peppol' } });
    expect(noId.status).toBe(422);
    expect(noId.body.errors.map((e: any) => e.field)).toEqual(['einvoice.endpoint']);
    const unknown = await admin.post(`/api/v1/customers/${customer.id}/billing_profiles`, { ...base, einvoice: { format: 'nope' } });
    expect(unknown.body.errors.map((e: any) => e.field)).toEqual(['einvoice.format']);
    const r = await admin.post(`/api/v1/customers/${customer.id}/billing_profiles`, { ...base, einvoice: { format: 'peppol', endpoint: '0191:12345678' } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.einvoice).toEqual({ format: 'peppol', endpoint: '0191:12345678' });
  });

  it('makes a Peppol UBL invoice, prints the bank account, and emails both files', async () => {
    const doc = await invoice(2);
    expect(doc.einvoice_format).toBe('peppol');
    const html = await admin.get(`/api/v1/documents/${doc.id}/html`);
    expect(html.body).toContain('EE38 2200 2210 2014 5685');
    expect(html.body).toContain('Registry code 10002345');
    const res = await admin.get(`/api/v1/documents/${doc.id}/einvoice`);
    expect(res.status, res.body).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.body).toContain('<cbc:EndpointID schemeID="0191">10002345</cbc:EndpointID>');
    expect(res.body).toContain('<cbc:EndpointID schemeID="0191">12345678</cbc:EndpointID>');
    expect(res.body).toContain('<cbc:BuyerReference>PO-9</cbc:BuyerReference>');
    expect(res.body).toContain('<cbc:PayableAmount currencyID="EUR">60.00</cbc:PayableAmount>');
    await admin.post(`/api/v1/documents/${doc.id}/actions/send`);
    const sent = (await withSystem(t.deps.db, (c) => c.query(`SELECT attachments FROM notifications WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`, [doc.order_id]))).rows[0];
    expect(sent.attachments).toEqual([doc.id, `einvoice:${doc.id}`]);
  });

  it('says what is missing instead of making a file a receiver refuses', async () => {
    await admin.patch('/api/v1/plugins/einvoice-peppol', { config: { seller_endpoint: null } });
    const doc = await invoice(4);
    const r = await admin.get(`/api/v1/documents/${doc.id}/einvoice`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('einvoice_unavailable');
    await admin.patch('/api/v1/plugins/einvoice-peppol', { config: { seller_endpoint: '0191:10002345' } });
  });

  it('makes an Estonian e-arve with a payment reference number', async () => {
    const p = (await admin.get(`/api/v1/customers/${customer.id}/billing_profiles`)).body.data[0];
    await admin.patch(`/api/v1/customers/${customer.id}/billing_profiles/${p.id}`, { einvoice: { format: 'earve' } });
    const doc = await invoice(6);
    const res = await admin.get(`/api/v1/documents/${doc.id}/einvoice`);
    expect(res.status, res.body).toBe(200);
    expect(res.body).toContain('<PayToAccount>EE382200221020145685</PayToAccount>');
    expect(res.body).toMatch(/<PaymentReferenceNumber>\d+<\/PaymentReferenceNumber>/);
    expect(res.body).toContain('sellerRegnumber="10002345"');
  });

  it('makes a Factur-X PDF with the invoice’s XML inside', async () => {
    const p = (await admin.get(`/api/v1/customers/${customer.id}/billing_profiles`)).body.data[0];
    await admin.patch(`/api/v1/customers/${customer.id}/billing_profiles/${p.id}`, { einvoice: { format: 'facturx' } });
    const doc = await invoice(8);
    // The PDF as bytes: the test client reads bodies as text.
    const cookie = [...admin.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await t.app.inject({ method: 'GET', url: `/api/v1/documents/${doc.id}/einvoice`, headers: { cookie } });
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    const pdf = await PDFDocument.load(res.rawPayload);
    const names = pdf.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('EmbeddedFiles'), PDFDict).lookup(PDFName.of('Names'), PDFArray);
    expect((names.lookup(0) as PDFHexString).decodeText()).toBe('factur-x.xml');
  }, 120_000);

  it('gives a credit note the e-invoice of its invoice', async () => {
    const doc = await invoice(10);
    const voided = (await admin.post(`/api/v1/documents/${doc.id}/actions/void`, { reason: 'test' })).body;
    expect(voided.credit_note.einvoice_format).toBe('facturx');
  });
});
