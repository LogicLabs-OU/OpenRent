import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaxRateRequest } from '@openrent/plugin-sdk';
import { productCodes, taxjarRates, taxRequest } from '../src/index.ts';

const shop = { line1: '1 Pier Rd', postal_code: '94111', city: 'San Francisco', region: 'CA', country: 'US' };
const home = { line1: '5 Elm St', postal_code: '90002', city: 'Los Angeles', region: 'CA', country: 'US' };
const req = (over: Partial<TaxRateRequest> = {}): TaxRateRequest => ({
  currency: 'USD',
  customer: { id: 'cus_1', country: 'US', taxId: null, address: home },
  origin: { country: 'US', address: shop },
  lines: [
    { key: 'l1', type: 'rental', productId: 'p1', variantId: 'v1', taxCode: 'txp_rent', defaultRateBp: 0 },
    { key: 'l2', type: 'discount', productId: null, variantId: null, taxCode: null, defaultRateBp: 0 },
  ],
  ...over,
});
const ctx = (config: Record<string, unknown>) => ({ tenantId: 't1', config: { api_key: 'tj', ...config }, logger: console as any });

afterEach(() => vi.unstubAllGlobals());

describe('TaxJar', () => {
  it('reads product tax codes', () => {
    expect([...productCodes('txp_a=19000, txp_b = 31000, junk')]).toEqual([['txp_a', '19000'], ['txp_b', '31000']]);
  });

  it('asks only for US shops quoting in dollars', () => {
    expect(taxRequest({}, req({ currency: 'EUR' }))).toBeNull();
    expect(taxRequest({}, req({ origin: { country: 'DE', address: { ...shop, country: 'DE' } } }))).toBeNull();
    expect(taxRequest({}, req({ origin: { country: 'US', address: { ...shop, postal_code: undefined } } as any }))).toBeNull();
  });

  it('taxes at the pickup location unless the shop chose the customer address', () => {
    expect(taxRequest({ product_tax_codes: 'txp_rent=19000' }, req())).toMatchObject({
      from_zip: '94111', to_zip: '94111', to_state: 'CA', amount: 100, line_items: [{ id: 'l1', quantity: 1, unit_price: 100, product_tax_code: '19000' }],
    });
    expect(taxRequest({ sourcing: 'customer' }, req())).toMatchObject({ to_zip: '90002', to_city: 'Los Angeles' });
  });

  it('turns TaxJar rates into basis points, and nothing to collect without nexus', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, status: 200, json: async () => ({ tax: { has_nexus: true, breakdown: { line_items: [{ id: 'l1', combined_tax_rate: 0.08625 }] } } }) }));
    vi.stubGlobal('fetch', fetch);
    expect(await taxjarRates(ctx({}), req())).toEqual({ l1: 863 });
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer tj' } });
    // The same question within the hour is answered from the cache.
    await taxjarRates(ctx({}), req());
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ tax: { has_nexus: false } }) }));
    expect(await taxjarRates(ctx({ sourcing: 'customer' }), req())).toEqual({ l1: 0 });
  });

  it('fails loudly so the shop’s own rates apply', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized', detail: 'Not authorized for route' }) }));
    await expect(taxjarRates(ctx({}), req({ origin: { country: 'US', address: { ...shop, postal_code: '94105' } } }))).rejects.toThrow('TaxJar: Not authorized for route');
  });
});
