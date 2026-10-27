import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startViesFake, type ViesFake } from '@openrent/tax-fakes';
import { checkVatNumber, parseVatNumber, viesRates } from '../src/index.ts';

const logger = { info() {}, warn() {}, error() {}, debug() {} } as any;

describe('EU VAT numbers with VIES', () => {
  let vies: ViesFake;
  beforeAll(async () => {
    vies = await startViesFake({ numbers: { DE123456789: { name: 'Bühne GmbH', address: 'Hauptstr. 1\n10115 Berlin' }, EL094259216: { name: 'Skini AE', address: 'Athina' }, EE100931558: { name: 'Oma OÜ', address: 'Tallinn' } } });
  });
  afterAll(() => vies?.close());
  const ctx = (config: Record<string, unknown> = {}) => ({ tenantId: 't', logger, config: { api_url: vies.url, ...config } });
  const req = (taxId: string | null, origin = 'EE') => ({
    currency: 'EUR',
    customer: taxId ? { id: 'cus_1', country: null, taxId, address: null } : null,
    origin: { country: origin, address: { country: origin } },
    lines: [{ key: '0', type: 'rental', productId: 'prd_1', variantId: 'var_1', taxCode: null, defaultRateBp: 2200 }, { key: 'fee:x', type: 'fee', productId: null, variantId: null, taxCode: null, defaultRateBp: 2200 }],
  });

  it('reads numbers as people type them', () => {
    expect(parseVatNumber('de 123.456-789')).toEqual({ prefix: 'DE', number: '123456789' });
    expect(parseVatNumber('GR094259216')).toEqual({ prefix: 'EL', number: '094259216' });
    expect(parseVatNumber('US123456789')).toBeNull();
    expect(parseVatNumber('12345')).toBeNull();
  });

  it('checks a number, names the trader and keeps the answer', async () => {
    const c = await checkVatNumber(ctx({ requester_vat: 'EE100931558' }), 'DE 123456789');
    expect(c).toMatchObject({ status: 'valid', country: 'DE', name: 'Bühne GmbH', address: 'Hauptstr. 1\n10115 Berlin' });
    expect(c.ref).toMatch(/^WAPI/);
    expect(vies.requests.at(-1)).toEqual({ countryCode: 'DE', vatNumber: '123456789', requester: 'EE100931558' });
    const before = vies.requests.length;
    await checkVatNumber(ctx(), 'DE123456789');
    expect(vies.requests.length).toBe(before);
    expect(await checkVatNumber(ctx(), 'DE999999999')).toMatchObject({ status: 'invalid', country: 'DE', name: null });
    expect(await checkVatNumber(ctx(), 'XX1')).toMatchObject({ status: 'invalid', reason: 'format' });
  });

  it('says when a member state cannot answer', async () => {
    vies.down.add('FR');
    expect(await checkVatNumber(ctx(), 'FR12345678901')).toMatchObject({ status: 'unavailable', country: 'FR', reason: 'MS_UNAVAILABLE' });
    expect(await checkVatNumber(ctx({ api_url: 'http://127.0.0.1:9' }), 'FR12345678902')).toMatchObject({ status: 'unavailable' });
  });

  it('takes VAT off for a valid business in another EU country, with the legal note', async () => {
    const r: any = await viesRates(ctx(), req('DE123456789'));
    expect(r.rates).toEqual({ '0': 0, 'fee:x': 0 });
    expect(r.note.en).toContain('Article 196');
    expect(r.note.de).toContain('Reverse Charge');
    // Greece is EL in VIES and GR elsewhere.
    expect((await viesRates(ctx(), req('GR094259216')) as any).rates['0']).toBe(0);
  });

  it('keeps VAT at home, outside the EU, without a valid number and when VIES is down', async () => {
    expect(await viesRates(ctx(), req('EE100931558'))).toEqual({});
    expect(await viesRates(ctx(), req('DE123456789', 'US'))).toEqual({});
    expect(await viesRates(ctx(), req(null))).toEqual({});
    expect(await viesRates(ctx(), req('DE999999999'))).toEqual({});
    expect(await viesRates(ctx(), req('FR12345678901'))).toEqual({});
  });
});
