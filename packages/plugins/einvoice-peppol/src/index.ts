import { definePlugin } from '@openrent/plugin-sdk';
import { missing, toUbl } from './ubl.ts';

export { missing, toUbl, CUSTOMIZATION_ID, PROFILE_ID } from './ubl.ts';

/** `0191:10002345` → `{ scheme: '0191', id: '10002345' }`: a Peppol participant id with its scheme. */
export function parseEndpoint(v: unknown): { scheme: string; id: string } | null {
  const m = /^\s*(\d{4}):([^\s:]{1,50})\s*$/.exec(String(v ?? ''));
  return m ? { scheme: m[1]!, id: m[2]! } : null;
}

/**
 * Peppol e-invoices (FR-DOC-6): invoices and credit notes as Peppol BIS Billing 3.0 (UBL 2.1, EN 16931),
 * for customers whose billing details ask for them. The file goes with the invoice email; sending it over
 * the Peppol network is left to the shop's access point or accounting system.
 */
export default definePlugin({
  id: 'einvoice-peppol',
  name: 'Peppol e-invoices',
  version: '1.0.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.9.0',
  permissions: ['documents:read'],
  settings: [
    { key: 'seller_endpoint', label: 'Your Peppol ID', type: 'text', required: true, help: 'Scheme and identifier, for example 0191:10002345 (Estonian registry code) or 0088:5790000435951 (GLN)' },
  ],
  setup(api) {
    api.registerEInvoiceFormat({
      id: 'peppol',
      name: { en: 'Peppol (UBL)', de: 'Peppol (UBL)', fr: 'Peppol (UBL)', es: 'Peppol (UBL)', et: 'Peppol (UBL)', ja: 'Peppol（UBL）', nl: 'Peppol (UBL)' },
      endpoint: true,
      isConfigured: (ctx) => !!parseEndpoint(ctx.config.seller_endpoint),
      render(ctx, invoice) {
        const data = { ...invoice, seller: { ...invoice.seller, endpoint: invoice.seller.endpoint ?? parseEndpoint(ctx.config.seller_endpoint) } };
        const gaps = missing(data);
        if (gaps.length) return { missing: gaps };
        return { filename: `${invoice.number}.xml`, contentType: 'application/xml', content: toUbl(data) };
      },
    });
  },
});
