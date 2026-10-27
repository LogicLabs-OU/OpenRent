import { definePlugin, type ProviderContext, type TaxIdCheck, type TaxProvider, type TaxRateRequest, type TaxRates } from '@openrent/plugin-sdk';

/**
 * EU VAT numbers checked with VIES, the European Commission's service, and the reverse charge for
 * business customers in another EU country: no VAT on the invoice, and a note that the customer
 * accounts for it (Article 196 of the VAT Directive). Customers without a valid number, in the
 * shop's own country, or outside the EU keep the shop's own tax profiles. A check that VIES cannot
 * answer charges VAT, so an outage never removes tax.
 */
const VIES = 'https://ec.europa.eu/taxation_customs/vies/rest-api';
const DAY = 86_400_000;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** EU member states by ISO code; VIES writes Greece as EL, and Northern Ireland's traders use XI. */
const EU = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK']);
const toIso = (vies: string) => (vies === 'EL' ? 'GR' : vies === 'XI' ? 'GB' : vies);

/** "de 123 456 789" → { country: 'DE', number: '123456789' }; null when it is no EU VAT number. */
export function parseVatNumber(raw: string): { prefix: string; number: string } | null {
  const v = raw.toUpperCase().replace(/[\s.\-_/]/g, '');
  const m = /^([A-Z]{2})([0-9A-Z+*]{2,12})$/.exec(v);
  if (!m) return null;
  const prefix = m[1] === 'GR' ? 'EL' : m[1]!;
  if (!EU.has(toIso(prefix)) && prefix !== 'XI') return null;
  return { prefix, number: m[2]! };
}

/** The legal note on documents for the reverse charge, in the shop's languages. */
export const REVERSE_CHARGE_NOTE = {
  en: 'Reverse charge: VAT to be accounted for by the recipient (Article 196, Council Directive 2006/112/EC).',
  de: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge, Art. 196 MwStSystRL 2006/112/EG).',
  fr: 'Autoliquidation : TVA due par le preneur (article 196 de la directive 2006/112/CE).',
  es: 'Inversión del sujeto pasivo: IVA a cargo del destinatario (artículo 196 de la Directiva 2006/112/CE).',
  et: 'Pöördmaksustamine: käibemaksu tasub saaja (direktiivi 2006/112/EÜ artikkel 196).',
  ja: 'リバースチャージ：付加価値税は受領者が申告・納付します（EU指令2006/112/EC第196条）。',
  nl: 'Btw verlegd: de btw wordt voldaan door de afnemer (artikel 196, Richtlijn 2006/112/EG).',
};

/** Answers kept for a day, as quotes ask again and again while a cart changes. */
const cache = new Map<string, { at: number; check: TaxIdCheck }>();

export async function checkVatNumber(ctx: ProviderContext, raw: string, opts: { fresh?: boolean } = {}): Promise<TaxIdCheck> {
  const now = new Date().toISOString();
  const parsed = parseVatNumber(raw);
  if (!parsed) return { status: 'invalid', country: null, checked_at: now, reason: 'format' };
  const key = `${parsed.prefix}${parsed.number}`;
  const hit = cache.get(key);
  if (hit && !opts.fresh && Date.now() - hit.at < DAY) return hit.check;
  const requester = str(ctx.config.requester_vat) ? parseVatNumber(String(ctx.config.requester_vat)) : null;
  let res: Response;
  try {
    res = await fetch(`${(str(ctx.config.api_url) ?? VIES).replace(/\/$/, '')}/check-vat-number`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ countryCode: parsed.prefix, vatNumber: parsed.number, ...(requester ? { requesterMemberStateCode: requester.prefix, requesterNumber: requester.number } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    ctx.logger.warn({ err }, 'VIES could not be reached');
    return { status: 'unavailable', country: toIso(parsed.prefix), checked_at: now };
  }
  const body: any = await res.json().catch(() => ({}));
  const error = body?.errorWrappers?.[0]?.error ?? (body?.userError && !['VALID', 'INVALID'].includes(body.userError) ? body.userError : null);
  if (error === 'INVALID_INPUT') return { status: 'invalid', country: toIso(parsed.prefix), checked_at: now, reason: 'format' };
  if (!res.ok || error || typeof body?.valid !== 'boolean') return { status: 'unavailable', country: toIso(parsed.prefix), checked_at: now, reason: error ?? `HTTP ${res.status}` };
  const named = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim() !== '---' ? v.trim() : null);
  const check: TaxIdCheck = {
    status: body.valid ? 'valid' : 'invalid',
    country: toIso(parsed.prefix),
    name: named(body.name),
    address: named(body.address),
    ref: str(body.requestIdentifier),
    checked_at: typeof body.requestDate === 'string' ? body.requestDate : now,
  };
  cache.set(key, { at: Date.now(), check });
  return check;
}

/** No VAT when the customer is a business with a valid number in another EU country than the shop. */
export async function viesRates(ctx: ProviderContext, req: TaxRateRequest): Promise<Record<string, number> | TaxRates> {
  // Where the shop is: its location's country, else the country of its own VAT number.
  const own = str(ctx.config.requester_vat) ? parseVatNumber(String(ctx.config.requester_vat)) : null;
  const origin = (req.origin.country ?? str((req.origin.address as any)?.country) ?? (own ? toIso(own.prefix) : '')).toUpperCase();
  const taxId = req.customer?.taxId;
  if (!taxId || !EU.has(origin)) return {};
  const check = req.customer?.taxIdCheck?.status === 'valid' ? req.customer.taxIdCheck : await checkVatNumber(ctx, taxId);
  if (check.status !== 'valid' || !check.country || check.country === origin || !EU.has(check.country)) return {};
  return { rates: Object.fromEntries(req.lines.map((l) => [l.key, 0])), note: REVERSE_CHARGE_NOTE };
}

export function viesProvider(): TaxProvider {
  // Off until the shop gives its own VAT number: it says where the shop is and asks VIES for proof numbers.
  return { id: 'vies', isConfigured: (ctx) => !!str(ctx.config.requester_vat) && !!parseVatNumber(String(ctx.config.requester_vat)), rates: viesRates, checkTaxId: checkVatNumber };
}


export default definePlugin({
  id: 'tax-vies',
  name: 'EU VAT numbers (VIES)',
  version: '0.1.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.8.0',
  permissions: ['network'],
  settings: [
    { key: 'requester_vat', label: 'Your VAT number', type: 'text', required: true, help: 'Sent with each check, so VIES gives a consultation number you can keep as proof' },
    { key: 'api_url', label: 'VIES address (testing only)', type: 'text' },
  ],
  setup(api) {
    api.registerTaxProvider(viesProvider());
  },
});
