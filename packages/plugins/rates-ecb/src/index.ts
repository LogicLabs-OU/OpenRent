import { definePlugin, type RatesProvider } from '@openrent/plugin-sdk';

/**
 * Daily euro reference rates from the European Central Bank (FR-I18N-7), for prices shown in other
 * currencies. The ECB publishes rates against the euro once a working day around 16:00 CET; rates
 * for a shop in another currency are worked out from them (cross rates).
 */
const ECB = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Euro rates and their date from the ECB's daily XML. */
export function parseEcb(xml: string): { date: string; eur: Record<string, number> } {
  const date = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  if (!date) throw new Error('The ECB answer has no date');
  const eur: Record<string, number> = { EUR: 1 };
  for (const m of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) eur[m[1]!] = Number(m[2]);
  return { date, eur };
}

/** Units of each currency one unit of `base` buys, from euro rates. */
export function crossRates(eur: Record<string, number>, base: string, currencies: string[]) {
  const b = eur[base];
  if (!b) throw new Error(`The ECB has no rate for ${base}`);
  return Object.fromEntries(currencies.filter((c) => eur[c]).map((c) => [c, eur[c]! / b]));
}

export function ecbRates(): RatesProvider {
  return {
    id: 'ecb',
    isConfigured: () => true,
    async rates(ctx, base, currencies) {
      const res = await fetch(str(ctx.config.url) ?? ECB, { headers: { accept: 'application/xml' }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`ECB rates: HTTP ${res.status}`);
      const { date, eur } = parseEcb(await res.text());
      return { date, rates: crossRates(eur, base, currencies) };
    },
  };
}

export default definePlugin({
  id: 'rates-ecb',
  name: 'ECB exchange rates',
  version: '0.1.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.7.0',
  permissions: ['network'],
  settings: [{ key: 'url', label: 'Rates URL (testing only)', type: 'text' }],
  setup(api) {
    api.registerRatesProvider(ecbRates());
  },
});
