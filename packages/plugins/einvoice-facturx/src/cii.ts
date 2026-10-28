import type { EInvoiceData, EInvoiceParty } from '@openrent/plugin-sdk';

/**
 * The XML of a Factur-X / ZUGFeRD invoice in the EN 16931 profile: UN/CEFACT Cross Industry Invoice
 * (CII D16B). Elements follow the order the CII schema demands.
 */
export const GUIDELINE = 'urn:cen.eu:en16931:2017';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const el = (name: string, value: string | number | null | undefined, attrs: Record<string, string> = {}) =>
  value === null || value === undefined || value === '' ? '' : `<${name}${Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('')}>${esc(String(value))}</${name}>`;
const wrap = (name: string, inner: string) => (inner ? `<${name}>${inner}</${name}>` : '');
/** CII dates: `20261027`. */
const date = (tag: string, iso: string, ns: 'udt' | 'qdt' = 'udt') => wrap(tag, el(`${ns}:DateTimeString`, iso.replace(/-/g, '').slice(0, 8), { format: '102' }));
const percent = (bp: number) => String(Number((bp / 100).toFixed(2)));

function decimals(currency: string) {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

function party(tag: string, p: EInvoiceParty) {
  const a = p.address;
  return wrap(
    tag,
    [
      el('ram:Name', p.legalName || p.name),
      p.companyId ? wrap('ram:SpecifiedLegalOrganization', el('ram:ID', p.companyId)) : '',
      p.contactName || p.phone || p.email
        ? wrap('ram:DefinedTradeContact', el('ram:PersonName', p.contactName) + (p.phone ? wrap('ram:TelephoneUniversalCommunication', el('ram:CompleteNumber', p.phone)) : '') + (p.email ? wrap('ram:EmailURIUniversalCommunication', el('ram:URIID', p.email)) : ''))
        : '',
      wrap('ram:PostalTradeAddress', el('ram:PostcodeCode', a.postalCode) + el('ram:LineOne', a.lines[0]) + el('ram:LineTwo', a.lines.slice(1).join(', ')) + el('ram:CityName', a.city) + el('ram:CountryID', a.country)),
      p.endpoint ? wrap('ram:URIUniversalCommunication', el('ram:URIID', p.endpoint.id, { schemeID: p.endpoint.scheme })) : p.email ? wrap('ram:URIUniversalCommunication', el('ram:URIID', p.email, { schemeID: 'EM' })) : '',
      p.vatId ? wrap('ram:SpecifiedTaxRegistration', el('ram:ID', p.vatId, { schemeID: 'VA' })) : '',
    ].join(''),
  );
}

function tax(c: { category: string; rateBp: number; exemptionReason?: string | null }, amounts?: { taxable: number; tax: number }, amount?: (n: number) => string) {
  const exempt = ['AE', 'E', 'O', 'K', 'G'].includes(c.category);
  return wrap(
    'ram:ApplicableTradeTax',
    (amounts ? el('ram:CalculatedAmount', amount!(amounts.tax)) : '') +
      el('ram:TypeCode', 'VAT') +
      (amounts && exempt ? el('ram:ExemptionReason', c.exemptionReason || (c.category === 'AE' ? 'Reverse charge' : 'Exempt')) : '') +
      (amounts ? el('ram:BasisAmount', amount!(amounts.taxable)) : '') +
      el('ram:CategoryCode', c.category) +
      (c.category === 'O' ? '' : el('ram:RateApplicablePercent', percent(c.rateBp))),
  );
}

/** The CII XML of one invoice or credit note. */
export function toCii(inv: EInvoiceData): string {
  const d = decimals(inv.currency);
  const amount = (minor: number) => (minor / 10 ** d).toFixed(d);
  const lines = inv.lines.map((l, i) =>
    wrap(
      'ram:IncludedSupplyChainTradeLineItem',
      wrap('ram:AssociatedDocumentLineDocument', el('ram:LineID', l.id || String(i + 1))) +
        wrap('ram:SpecifiedTradeProduct', el('ram:Name', l.name)) +
        wrap('ram:SpecifiedLineTradeAgreement', wrap('ram:NetPriceProductTradePrice', el('ram:ChargeAmount', (l.unitPrice / 10 ** d).toFixed(Math.max(2, d))))) +
        wrap('ram:SpecifiedLineTradeDelivery', el('ram:BilledQuantity', String(l.quantity), { unitCode: l.unitCode || 'C62' })) +
        wrap(
          'ram:SpecifiedLineTradeSettlement',
          tax({ category: l.taxCategory, rateBp: l.taxRateBp }) +
            (l.period ? wrap('ram:BillingSpecifiedPeriod', date('ram:StartDateTime', l.period.start) + date('ram:EndDateTime', l.period.end)) : '') +
            wrap('ram:SpecifiedTradeSettlementLineMonetarySummation', el('ram:LineTotalAmount', amount(l.netAmount))),
        ),
    ),
  );
  const iban = inv.payment?.iban?.replace(/\s+/g, '');
  const settlement = [
    el('ram:PaymentReference', inv.payment?.reference ?? inv.number),
    el('ram:InvoiceCurrencyCode', inv.currency),
    iban ? wrap('ram:SpecifiedTradeSettlementPaymentMeans', el('ram:TypeCode', '58') + wrap('ram:PayeePartyCreditorFinancialAccount', el('ram:IBANID', iban)) + (inv.payment?.bic ? wrap('ram:PayeeSpecifiedCreditorFinancialInstitution', el('ram:BICID', inv.payment.bic)) : '')) : '',
    ...inv.taxBreakdown.map((t) => tax(t, t, amount)),
    inv.period ? wrap('ram:BillingSpecifiedPeriod', date('ram:StartDateTime', inv.period.start) + date('ram:EndDateTime', inv.period.end)) : '',
    inv.paymentTerms || (inv.dueDate && inv.type === 'invoice') ? wrap('ram:SpecifiedTradePaymentTerms', el('ram:Description', inv.paymentTerms) + (inv.dueDate && inv.type === 'invoice' ? date('ram:DueDateDateTime', inv.dueDate) : '')) : '',
    wrap(
      'ram:SpecifiedTradeSettlementHeaderMonetarySummation',
      el('ram:LineTotalAmount', amount(inv.totals.lineNet)) +
        el('ram:TaxBasisTotalAmount', amount(inv.totals.taxExclusive)) +
        el('ram:TaxTotalAmount', amount(inv.totals.tax), { currencyID: inv.currency }) +
        el('ram:GrandTotalAmount', amount(inv.totals.taxInclusive)) +
        (inv.totals.prepaid ? el('ram:TotalPrepaidAmount', amount(inv.totals.prepaid)) : '') +
        el('ram:DuePayableAmount', amount(inv.totals.payable)),
    ),
    inv.precedingInvoice ? wrap('ram:InvoiceReferencedDocument', el('ram:IssuerAssignedID', inv.precedingInvoice.number) + date('ram:FormattedIssueDateTime', inv.precedingInvoice.issueDate, 'qdt')) : '',
  ].join('');
  const body = [
    wrap('rsm:ExchangedDocumentContext', wrap('ram:GuidelineSpecifiedDocumentContextParameter', el('ram:ID', GUIDELINE))),
    wrap('rsm:ExchangedDocument', el('ram:ID', inv.number) + el('ram:TypeCode', inv.type === 'credit_note' ? '381' : '380') + date('ram:IssueDateTime', inv.issueDate) + (inv.note ? wrap('ram:IncludedNote', el('ram:Content', inv.note)) : '')),
    wrap(
      'rsm:SupplyChainTradeTransaction',
      lines.join('') +
        wrap(
          'ram:ApplicableHeaderTradeAgreement',
          el('ram:BuyerReference', inv.buyerReference) + party('ram:SellerTradeParty', inv.seller) + party('ram:BuyerTradeParty', inv.buyer) + (inv.orderReference ? wrap('ram:BuyerOrderReferencedDocument', el('ram:IssuerAssignedID', inv.orderReference)) : ''),
        ) +
        '<ram:ApplicableHeaderTradeDelivery/>' +
        wrap('ram:ApplicableHeaderTradeSettlement', settlement),
    ),
  ].join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">${body}</rsm:CrossIndustryInvoice>\n`;
}

/** What EN 16931 needs that an invoice may lack: countries, and the seller's VAT number when tax is charged. */
export function missing(inv: EInvoiceData): string[] {
  const out: string[] = [];
  if (!inv.seller.address.country) out.push('seller.address.country');
  if (!inv.buyer.address.country) out.push('buyer.address.country');
  if (inv.taxBreakdown.some((t) => t.category === 'S') && !inv.seller.vatId) out.push('seller.vatId');
  if (inv.taxBreakdown.some((t) => t.category === 'AE') && !inv.buyer.vatId) out.push('buyer.vatId');
  return out;
}
