import type { EInvoiceData, EInvoiceParty } from '@openrent/plugin-sdk';

/**
 * A Peppol BIS Billing 3.0 invoice or credit note (UBL 2.1, EN 16931). Elements follow the order the UBL
 * schema demands; amounts are written in major units with the currency's decimals.
 */
const NS = {
  invoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  creditNote: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
};
export const CUSTOMIZATION_ID = 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0';
export const PROFILE_ID = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** An element, or nothing when the value is empty. */
const el = (name: string, value: string | number | null | undefined, attrs: Record<string, string> = {}) =>
  value === null || value === undefined || value === '' ? '' : `<${name}${Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('')}>${esc(String(value))}</${name}>`;
const wrap = (name: string, inner: string) => (inner ? `<${name}>${inner}</${name}>` : '');

/** Decimals of a currency (EUR 2, JPY 0). */
export function decimals(currency: string) {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

export function writer(currency: string) {
  const d = decimals(currency);
  const amount = (minor: number) => (minor / 10 ** d).toFixed(d);
  const money = (name: string, minor: number) => el(name, amount(minor), { currencyID: currency });
  return { amount, money };
}

/** A tax rate in percent, as EN 16931 writes it: 20, 9.5. */
const percent = (bp: number) => String(Number((bp / 100).toFixed(2)));

function party(p: EInvoiceParty) {
  const a = p.address;
  return wrap(
    'cac:Party',
    [
      p.endpoint ? el('cbc:EndpointID', p.endpoint.id, { schemeID: p.endpoint.scheme }) : '',
      wrap('cac:PartyName', el('cbc:Name', p.name)),
      wrap(
        'cac:PostalAddress',
        [el('cbc:StreetName', a.lines[0]), el('cbc:AdditionalStreetName', a.lines.slice(1).join(', ')), el('cbc:CityName', a.city), el('cbc:PostalZone', a.postalCode), wrap('cac:Country', el('cbc:IdentificationCode', a.country))].join(''),
      ),
      p.vatId ? wrap('cac:PartyTaxScheme', el('cbc:CompanyID', p.vatId) + wrap('cac:TaxScheme', el('cbc:ID', 'VAT'))) : '',
      wrap('cac:PartyLegalEntity', el('cbc:RegistrationName', p.legalName || p.name) + el('cbc:CompanyID', p.companyId)),
      wrap('cac:Contact', el('cbc:Name', p.contactName) + el('cbc:Telephone', p.phone) + el('cbc:ElectronicMail', p.email)),
    ].join(''),
  );
}

function taxCategory(tag: 'cac:TaxCategory' | 'cac:ClassifiedTaxCategory', c: { category: string; rateBp: number; exemptionReason?: string | null }) {
  // Categories without tax (reverse charge, exempt, outside the scope) name a reason on the total, not on lines.
  const reason = tag === 'cac:TaxCategory' && ['AE', 'E', 'O', 'K', 'G'].includes(c.category) ? el('cbc:TaxExemptionReason', c.exemptionReason || defaultReason(c.category)) : '';
  return wrap(tag, el('cbc:ID', c.category) + (c.category === 'O' ? '' : el('cbc:Percent', percent(c.rateBp))) + reason + wrap('cac:TaxScheme', el('cbc:ID', 'VAT')));
}

function defaultReason(category: string) {
  return ({ AE: 'Reverse charge', E: 'Exempt from tax', O: 'Not subject to VAT', K: 'Intra-community supply', G: 'Export outside the EU' } as Record<string, string>)[category] ?? '';
}

/** The UBL XML of one invoice or credit note. */
export function toUbl(inv: EInvoiceData): string {
  const credit = inv.type === 'credit_note';
  const { money } = writer(inv.currency);
  const root = credit ? 'CreditNote' : 'Invoice';
  const lineTag = credit ? 'cac:CreditNoteLine' : 'cac:InvoiceLine';
  const qtyTag = credit ? 'cbc:CreditedQuantity' : 'cbc:InvoicedQuantity';
  const lines = inv.lines.map((l, i) =>
    wrap(
      lineTag,
      [
        el('cbc:ID', l.id || String(i + 1)),
        el(qtyTag, String(l.quantity), { unitCode: l.unitCode || 'C62' }),
        money('cbc:LineExtensionAmount', l.netAmount),
        l.period ? wrap('cac:InvoicePeriod', el('cbc:StartDate', l.period.start) + el('cbc:EndDate', l.period.end)) : '',
        wrap('cac:Item', el('cbc:Name', l.name) + taxCategory('cac:ClassifiedTaxCategory', { category: l.taxCategory, rateBp: l.taxRateBp })),
        wrap('cac:Price', el('cbc:PriceAmount', (l.unitPrice / 10 ** decimals(inv.currency)).toFixed(Math.max(2, decimals(inv.currency))), { currencyID: inv.currency })),
      ].join(''),
    ),
  );
  const body = [
    el('cbc:CustomizationID', CUSTOMIZATION_ID),
    el('cbc:ProfileID', PROFILE_ID),
    el('cbc:ID', inv.number),
    el('cbc:IssueDate', inv.issueDate),
    credit ? '' : el('cbc:DueDate', inv.dueDate),
    el(credit ? 'cbc:CreditNoteTypeCode' : 'cbc:InvoiceTypeCode', credit ? '381' : '380'),
    el('cbc:Note', inv.note),
    el('cbc:DocumentCurrencyCode', inv.currency),
    el('cbc:BuyerReference', inv.buyerReference),
    inv.period ? wrap('cac:InvoicePeriod', el('cbc:StartDate', inv.period.start) + el('cbc:EndDate', inv.period.end)) : '',
    inv.orderReference ? wrap('cac:OrderReference', el('cbc:ID', inv.orderReference)) : '',
    inv.precedingInvoice ? wrap('cac:BillingReference', wrap('cac:InvoiceDocumentReference', el('cbc:ID', inv.precedingInvoice.number) + el('cbc:IssueDate', inv.precedingInvoice.issueDate))) : '',
    wrap('cac:AccountingSupplierParty', party(inv.seller)),
    wrap('cac:AccountingCustomerParty', party(inv.buyer)),
    inv.payment?.iban
      ? wrap(
          'cac:PaymentMeans',
          el('cbc:PaymentMeansCode', '58') + el('cbc:PaymentID', inv.payment.reference ?? inv.number) + wrap('cac:PayeeFinancialAccount', el('cbc:ID', inv.payment.iban.replace(/\s+/g, '')) + (inv.payment.bic ? wrap('cac:FinancialInstitutionBranch', el('cbc:ID', inv.payment.bic)) : '')),
        )
      : '',
    inv.paymentTerms ? wrap('cac:PaymentTerms', el('cbc:Note', inv.paymentTerms)) : '',
    wrap(
      'cac:TaxTotal',
      money('cbc:TaxAmount', inv.totals.tax) +
        inv.taxBreakdown.map((t) => wrap('cac:TaxSubtotal', money('cbc:TaxableAmount', t.taxable) + money('cbc:TaxAmount', t.tax) + taxCategory('cac:TaxCategory', t))).join(''),
    ),
    wrap(
      'cac:LegalMonetaryTotal',
      money('cbc:LineExtensionAmount', inv.totals.lineNet) +
        money('cbc:TaxExclusiveAmount', inv.totals.taxExclusive) +
        money('cbc:TaxInclusiveAmount', inv.totals.taxInclusive) +
        (inv.totals.prepaid ? money('cbc:PrepaidAmount', inv.totals.prepaid) : '') +
        money('cbc:PayableAmount', inv.totals.payable),
    ),
    ...lines,
  ].join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${root} xmlns="${credit ? NS.creditNote : NS.invoice}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}">${body}</${root}>\n`;
}

/**
 * What Peppol needs that an invoice may lack (the rules a receiver checks first): both electronic
 * addresses, a buyer or order reference, and the seller's VAT number when tax is charged.
 */
export function missing(inv: EInvoiceData): string[] {
  const out: string[] = [];
  if (!inv.seller.endpoint) out.push('seller.endpoint');
  if (!inv.buyer.endpoint) out.push('buyer.endpoint');
  if (!inv.buyerReference && !inv.orderReference) out.push('buyerReference');
  if (!inv.seller.address.country) out.push('seller.address.country');
  if (!inv.buyer.address.country) out.push('buyer.address.country');
  if (inv.taxBreakdown.some((t) => t.category === 'S') && !inv.seller.vatId) out.push('seller.vatId');
  if (inv.taxBreakdown.some((t) => t.category === 'AE') && !inv.buyer.vatId) out.push('buyer.vatId');
  return out;
}
