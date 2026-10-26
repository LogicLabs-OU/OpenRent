import { definePlugin, type ProviderContext, type TaxProvider, type TaxRateRequest } from '@openrent/plugin-sdk';

/**
 * US sales tax from TaxJar: the combined state, county, city and district rate for each line, at the
 * shop's location (pickup) or, if the shop chooses, at the customer's delivery address. Shops outside
 * the US, or quotes in another currency, keep their own tax profiles. Rates are cached for an hour, as
 * a quote is priced many times while dates and items change.
 */
const API = 'https://api.taxjar.com';
const CACHE_MS = 3_600_000;
const cache = new Map<string, { at: number; rates: Record<string, number> }>();

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
type Address = { line1?: string; postal_code?: string; city?: string; region?: string; country?: string };

/** "txp_123=19000, txp_456=31000" → tax profile id → TaxJar product tax code. */
export const productCodes = (s: unknown) =>
  new Map(
    String(s ?? '')
      .split(/[,\n]/)
      .map((p) => p.split('=').map((x) => x.trim()))
      .filter((p) => p.length === 2 && p[0] && p[1]) as [string, string][],
  );

/** TaxJar's `from_`/`to_` fields for an address. */
function place(prefix: 'from' | 'to', a: Address) {
  return { [`${prefix}_country`]: a.country, [`${prefix}_zip`]: a.postal_code, [`${prefix}_state`]: a.region, [`${prefix}_city`]: a.city, [`${prefix}_street`]: a.line1 };
}

/** The body for POST /v2/taxes, or null when TaxJar has nothing to say (not US, not USD, no ZIP). */
export function taxRequest(config: Record<string, unknown>, req: TaxRateRequest) {
  const origin = (req.origin.address ?? {}) as Address;
  if (req.currency.toUpperCase() !== 'USD' || (req.origin.country ?? origin.country) !== 'US' || !origin.postal_code) return null;
  const customer = (req.customer?.address ?? null) as Address | null;
  const to = config.sourcing === 'customer' && customer?.country === 'US' && customer.postal_code ? customer : origin;
  const codes = productCodes(config.product_tax_codes);
  // Discounts follow their line; OpenRent applies the rate it gets for the line itself.
  const lines = req.lines.filter((l) => l.type !== 'discount');
  if (!lines.length) return null;
  return {
    ...place('from', { ...origin, country: 'US' }), ...place('to', to),
    amount: lines.length * 100, shipping: 0,
    line_items: lines.map((l) => ({ id: l.key, quantity: 1, unit_price: 100, product_tax_code: (l.taxCode && codes.get(l.taxCode)) || undefined })),
  };
}

export async function taxjarRates(ctx: ProviderContext, req: TaxRateRequest): Promise<Record<string, number>> {
  const body = taxRequest(ctx.config, req);
  if (!body) return {};
  const key = JSON.stringify(body);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rates;
  const res = await fetch(`${str(ctx.config.api_base_url) ?? API}/v2/taxes`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ctx.config.api_key}`, 'content-type': 'application/json', 'x-api-version': '2022-01-24' },
    body: key,
    signal: AbortSignal.timeout(8000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`TaxJar: ${data?.detail ?? data?.error ?? `HTTP ${res.status}`}`);
  const rates: Record<string, number> = {};
  // No nexus in that state: nothing to collect.
  if (data?.tax?.has_nexus === false) for (const l of body.line_items) rates[l.id] = 0;
  else for (const l of data?.tax?.breakdown?.line_items ?? []) if (typeof l.combined_tax_rate === 'number') rates[l.id] = Math.round(Number((l.combined_tax_rate * 10_000).toFixed(6)));
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), rates });
  return rates;
}

export const taxjarProvider: TaxProvider = {
  id: 'taxjar',
  isConfigured: (ctx) => !!str(ctx.config.api_key),
  rates: taxjarRates,
};

export default definePlugin({
  id: 'tax-taxjar',
  name: 'TaxJar US sales tax',
  version: '0.1.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.1.0',
  permissions: ['network'],
  settings: [
    { key: 'api_key', label: 'API token', type: 'secret', required: true, help: 'TaxJar → Account → SmartCalcs API' },
    { key: 'sourcing', label: 'Tax by', type: 'select', options: ['origin', 'customer'], help: 'origin: the pickup location; customer: the delivery address when there is one' },
    { key: 'product_tax_codes', label: 'Product tax codes', type: 'text', help: 'Tax profile id = TaxJar code, e.g. txp_123=19000' },
    { key: 'api_base_url', label: 'API base URL', type: 'text', help: 'https://api.sandbox.taxjar.com for testing' },
  ],
  setup(api) {
    api.setDefaultConfig({ api_key: api.env('TAXJAR_API_KEY') });
    api.registerTaxProvider(taxjarProvider);
  },
});
