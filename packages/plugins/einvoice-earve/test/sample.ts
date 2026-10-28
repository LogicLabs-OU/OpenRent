import type { EInvoiceData } from '@openrent/plugin-sdk';

/** A small rental invoice: one rental at 20 % and a delivery fee, paid in part. */
export function sample(over: Partial<EInvoiceData> = {}): EInvoiceData {
  return {
    type: 'invoice', number: 'INV-2026-00042', issueDate: '2026-10-27', dueDate: '2026-11-10', currency: 'EUR', buyerReference: 'PO-77', orderReference: '#1042',
    period: { start: '2026-10-20', end: '2026-10-22' }, note: null, paymentTerms: 'Net 14 days',
    seller: {
      name: 'Tallinn Gear Rental', legalName: 'Tallinn Gear Rental OÜ', companyId: '10002345', vatId: 'EE100000001',
      address: { lines: ['Narva mnt 5'], city: 'Tallinn', postalCode: '10117', country: 'EE' }, endpoint: { scheme: '0191', id: '10002345' }, email: 'shop@gear.ee',
    },
    buyer: {
      name: 'Stage Co', legalName: 'Stage Co AS', companyId: '12345678', vatId: 'EE102030405',
      address: { lines: ['Pärnu mnt 10', 'Hall B'], city: 'Tallinn', postalCode: '10148', country: 'EE' }, endpoint: { scheme: '0191', id: '12345678' }, contactName: 'Mari Maasikas', email: 'buy@stage.ee',
    },
    lines: [
      { id: '1', name: 'Wireless mic, 2 days', quantity: 2, unitCode: 'C62', netAmount: 6000, unitPrice: 3000, taxAmount: 1200, taxRateBp: 2000, taxCategory: 'S', period: { start: '2026-10-20', end: '2026-10-22' } },
      { id: '2', name: 'Delivery & pickup <zone 1>', quantity: 1, unitCode: 'C62', netAmount: 1500, unitPrice: 1500, taxAmount: 300, taxRateBp: 2000, taxCategory: 'S' },
    ],
    taxBreakdown: [{ category: 'S', rateBp: 2000, taxable: 7500, tax: 1500 }],
    totals: { lineNet: 7500, taxExclusive: 7500, tax: 1500, taxInclusive: 9000, prepaid: 2000, payable: 7000 },
    payment: { iban: 'EE38 2200 2210 2014 5685', bic: 'HABAEE2X', reference: null },
    ...over,
  };
}
