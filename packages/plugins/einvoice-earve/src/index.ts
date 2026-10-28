import { definePlugin } from '@openrent/plugin-sdk';
import { missing, toEarve } from './earve.ts';

export { missing, toEarve, referenceNumber, VERSION } from './earve.ts';

/**
 * Estonian e-invoices (FR-DOC-6): invoices and credit notes in the national e-arve format (1.2), which
 * Estonian banks and e-invoice operators accept. The file goes with the invoice email; sending it to an
 * operator is left to the shop's operator or accounting system.
 */
export default definePlugin({
  id: 'einvoice-earve',
  name: 'Estonian e-invoices (e-arve)',
  version: '1.0.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.9.0',
  permissions: ['documents:read'],
  setup(api) {
    api.registerEInvoiceFormat({
      id: 'earve',
      name: { en: 'Estonian e-invoice (e-arve)', de: 'Estnische E-Rechnung (e-arve)', fr: 'Facture électronique estonienne (e-arve)', es: 'Factura electrónica estonia (e-arve)', et: 'E-arve', ja: 'エストニア電子請求書（e-arve）', nl: 'Estse e-factuur (e-arve)' },
      endpoint: false,
      isConfigured: () => true,
      render(_ctx, invoice) {
        const gaps = missing(invoice);
        if (gaps.length) return { missing: gaps };
        const content = toEarve(invoice, { id: invoice.number, date: invoice.issueDate });
        return { filename: `${invoice.number}.xml`, contentType: 'application/xml', content };
      },
    });
  },
});
