import type { EInvoiceData, EInvoiceParty } from '@openrent/plugin-sdk';

/**
 * An Estonian e-invoice (e-arve, version 1.2) for the banks' and operators' e-invoice channel. Elements
 * follow the order of the e-arve schema; amounts are euros with two decimals.
 */
export const VERSION = '1.2';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const el = (name: string, value: string | number | null | undefined) => (value === null || value === undefined || value === '' ? '' : `<${name}>${esc(String(value))}</${name}>`);
const wrap = (name: string, inner: string, attrs = '') => (inner ? `<${name}${attrs}>${inner}</${name}>` : '');
const sum = (minor: number) => (minor / 100).toFixed(2);

/**
 * An Estonian payment reference number (viitenumber): the invoice number's digits with a 7-3-1 check
 * digit, as banks check it. At most 20 digits.
 */
export function referenceNumber(invoiceNumber: string): string {
  const base = (invoiceNumber.replace(/\D/g, '').replace(/^0+/, '') || '1').slice(-19);
  const weights = [7, 3, 1];
  let total = 0;
  for (let i = 0; i < base.length; i++) total += Number(base[base.length - 1 - i]) * weights[i % 3]!;
  return `${base}${(10 - (total % 10)) % 10}`;
}

/** An Estonian registry code (8 digits) of a party, from its registry id, else nothing. */
const regCode = (p: EInvoiceParty) => (p.companyId ?? '').replace(/\s+/g, '').slice(0, 15);

function party(tag: 'SellerParty' | 'BuyerParty', p: EInvoiceParty, account?: { iban: string; bic?: string | null } | null) {
  const a = p.address;
  const address = wrap('LegalAddress', el('PostalAddress1', a.lines[0] || p.name) + el('PostalAddress2', a.lines.slice(1).join(', ')) + el('City', a.city || '-') + el('PostalCode', a.postalCode) + el('Country', a.country));
  const contact = wrap('ContactData', el('ContactName', p.contactName) + el('PhoneNumber', p.phone) + el('E-mailAddress', p.email) + address);
  return wrap(
    tag,
    el('Name', p.legalName || p.name) +
      (tag === 'SellerParty' ? el('RegNumber', regCode(p) || '-') : el('RegNumber', regCode(p))) +
      el('VATRegNumber', p.vatId) +
      contact +
      (account ? wrap('AccountInfo', el('AccountNumber', account.iban) + el('IBAN', account.iban) + el('BIC', account.bic)) : ''),
  );
}

/** The e-arve file with one invoice or credit note. */
export function toEarve(inv: EInvoiceData, file: { id: string; date: string }): string {
  const iban = (inv.payment?.iban ?? '').replace(/\s+/g, '').toUpperCase();
  const credit = inv.type === 'credit_note';
  const lines = inv.lines.map((l, i) => {
    const vat = wrap('VAT', el('SumBeforeVAT', sum(l.netAmount)) + el('VATRate', (l.taxRateBp / 100).toFixed(2)) + el('VATSum', sum(l.taxAmount)) + el('SumAfterVAT', sum(l.netAmount + l.taxAmount)), ` vatId="${l.taxCategory === 'S' ? 'TAX' : l.taxCategory === 'E' ? 'TAXEX' : 'NOTTAX'}"`);
    return wrap(
      'ItemEntry',
      el('RowNo', String(i + 1)) +
        el('Description', l.name) +
        wrap('ItemDetailInfo', el('ItemUnit', l.unitCode === 'DAY' ? 'päev' : 'tk') + el('ItemAmount', l.quantity.toFixed(4)) + el('ItemPrice', (l.unitPrice / 100).toFixed(4))) +
        el('ItemSum', (l.netAmount / 100).toFixed(4)) +
        vat +
        el('ItemTotal', ((l.netAmount + l.taxAmount) / 100).toFixed(4)),
    );
  });
  const vats = inv.taxBreakdown.map((t) =>
    wrap('VAT', el('SumBeforeVAT', sum(t.taxable)) + el('VATRate', (t.rateBp / 100).toFixed(2)) + el('VATSum', sum(t.tax)) + el('Currency', inv.currency) + el('SumAfterVAT', sum(t.taxable + t.tax)), ` vatId="${t.category === 'S' ? 'TAX' : t.category === 'E' ? 'TAXEX' : 'NOTTAX'}"`),
  );
  const invoice = wrap(
    'Invoice',
    wrap('InvoiceParties', party('SellerParty', inv.seller, iban ? { iban, bic: inv.payment?.bic } : null) + party('BuyerParty', inv.buyer)) +
      wrap(
        'InvoiceInformation',
        // Type is required even when it holds nothing but its attribute.
        `<Type type="${credit ? 'CRE' : 'DEB'}">${credit && inv.precedingInvoice ? el('SourceInvoice', inv.precedingInvoice.number) : ''}</Type>` +
          el('ContractNumber', inv.buyerReference) +
          el('DocumentName', credit ? 'Kreeditarve' : 'Arve') +
          el('InvoiceNumber', inv.number) +
          el('PaymentReferenceNumber', referenceNumber(inv.number)) +
          el('InvoiceDate', inv.issueDate) +
          el('DueDate', credit ? null : inv.dueDate) +
          el('PaymentTerm', inv.paymentTerms) +
          (inv.period ? wrap('Period', el('StartDate', inv.period.start) + el('EndDate', inv.period.end)) : ''),
      ) +
      wrap(
        'InvoiceSumGroup',
        el('InvoiceSum', (inv.totals.lineNet / 100).toFixed(4)) + vats.join('') + el('TotalVATSum', sum(inv.totals.tax)) + el('TotalSum', sum(inv.totals.taxInclusive)) + el('TotalToPay', sum(inv.totals.payable)) + el('Currency', inv.currency),
      ) +
      wrap('InvoiceItem', wrap('InvoiceItemGroup', lines.join(''))) +
      (inv.note ? wrap('AdditionalInformation', el('InformationName', 'Märkus') + el('InformationContent', inv.note)) : '') +
      wrap(
        'PaymentInfo',
        el('Currency', inv.currency) +
          el('PaymentDescription', inv.number) +
          el('Payable', !credit && inv.totals.payable > 0 ? 'YES' : 'NO') +
          el('PayDueDate', credit ? null : inv.dueDate) +
          el('PaymentTotalSum', sum(inv.totals.payable)) +
          el('PayerName', inv.buyer.legalName || inv.buyer.name) +
          el('PaymentId', inv.number) +
          el('PayToAccount', iban) +
          el('PayToName', inv.seller.legalName || inv.seller.name) +
          el('PayToBIC', inv.payment?.bic),
      ),
    ` invoiceId="${esc(inv.number)}" regNumber="${esc(regCode(inv.buyer))}" sellerRegnumber="${esc(regCode(inv.seller))}"`,
  );
  const header = wrap('Header', el('Date', file.date) + el('FileId', file.id) + el('Version', VERSION));
  const footer = wrap('Footer', el('TotalNumberInvoices', '1') + el('TotalAmount', sum(inv.totals.taxInclusive)));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<E_Invoice xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="e-invoice_ver1.2.EN.xsd">${header}${invoice}${footer}</E_Invoice>\n`;
}

/** What an e-arve needs that an invoice may lack: the seller's registry code and bank account, in euros. */
export function missing(inv: EInvoiceData): string[] {
  const out: string[] = [];
  if (!regCode(inv.seller)) out.push('seller.companyId');
  if (!(inv.payment?.iban ?? '').trim()) out.push('payment.iban');
  if (inv.currency !== 'EUR') out.push('currency');
  return out;
}
