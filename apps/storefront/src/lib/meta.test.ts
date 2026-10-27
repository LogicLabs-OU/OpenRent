import { describe, expect, it } from 'vitest';
import type { Location, Product } from '@openrent/theme-sdk';
import { isPrivatePath, jsonLdScript, locationLd, productLd, shorten } from './meta.ts';

const product = (over: Partial<Product> = {}): Product => ({
  id: 'prd_1', slug: 'camera', type: 'rental', name: 'Camera', description: 'A camera', tags: [], category_ids: [], images: [{ url: 'https://api.example/files/1/lg' }],
  deposit_amount: { amount: 0, currency: 'EUR' }, min_duration_min: null, max_duration_min: null, min_notice_min: 0, increment_min: null, bundle: null,
  variants: [
    { id: 'v1', name: 'Body', options: {}, tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: { amount: 4500, currency: 'EUR' }, description: '€45 / day' }, available: 0 },
    { id: 'v2', name: 'Kit', options: {}, tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: { amount: 2500, currency: 'EUR' }, description: '€25 / day' }, available: 2 },
  ],
  ...over,
});

describe('structured data', () => {
  it('cannot end the script element or open a comment, whatever the shop typed', () => {
    const html = jsonLdScript({ name: '</script><script>alert(1)</script> & <!--  ' });
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).not.toContain('<!--');
    expect(html).not.toContain(' ');
    const body = html.slice('<script type="application/ld+json">'.length, -'</script>'.length);
    expect(JSON.parse(body).name).toBe('</script><script>alert(1)</script> & <!--  ');
  });

  it('offers the lowest price for rent per day, in stock when a variant is free', () => {
    const ld = productLd(product(), 'https://shop.example/p/camera', 'https://shop.example', 'Shop') as any;
    expect(ld['@type']).toBe('Product');
    expect(ld.offers.price).toBe('25.00');
    expect(ld.offers.priceCurrency).toBe('EUR');
    expect(ld.offers.priceSpecification.unitCode).toBe('DAY');
    expect(ld.offers.businessFunction).toContain('LeaseOut');
    expect(ld.offers.availability).toBe('https://schema.org/InStock');
    expect(ld.image).toEqual(['https://api.example/files/1/lg']);
  });

  it('uses a price table’s shortest rental', () => {
    const table = productLd(product({ variants: [{ id: 'v', name: 'x', options: {}, tracking: 'serialized', price: { kind: 'table', period_unit: 'day', amount: { amount: 0, currency: 'EUR' }, description: '', from: { amount: { amount: 6000, currency: 'EUR' }, periods: 2 } } }] }), 'u', 'https://s', 'Shop') as any;
    expect(table.offers.price).toBe('60.00');
    expect(table.offers.priceSpecification.referenceQuantity).toEqual({ '@type': 'QuantitativeValue', value: 2, unitCode: 'DAY' });
  });

  it('says nothing about stock when no dates were chosen, and has no offer without a price', () => {
    const noDates = productLd(product({ variants: product().variants.map((v) => ({ ...v, available: undefined })) }), 'u', 'https://s', 'Shop') as any;
    expect(noDates.offers.availability).toBeUndefined();
    const free = productLd(product({ variants: [{ id: 'v', name: 'x', options: {}, tracking: 'none', price: null }] }), 'u', 'https://s', 'Shop') as any;
    expect(free.offers).toBeUndefined();
  });

  it('lists a location with its address and opening hours', () => {
    const loc: Location = { id: 'loc', name: 'Harbour', address: { line1: 'Kai 1', city: 'Tallinn', postal_code: '10111', country: 'EE' }, timezone: 'Europe/Tallinn', is_default: true, phone: '+372 555', opening_hours: { mon: [['09:00', '18:00']], sat: [['10:00', '14:00']] } };
    const ld = locationLd(loc, 'Shop', 'https://shop.example/') as any;
    expect(ld.name).toBe('Shop – Harbour');
    expect(ld.address).toMatchObject({ streetAddress: 'Kai 1', addressLocality: 'Tallinn', postalCode: '10111', addressCountry: 'EE' });
    expect(ld.telephone).toBe('+372 555');
    expect(ld.openingHoursSpecification).toEqual([
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Monday', opens: '09:00', closes: '18:00' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Saturday', opens: '10:00', closes: '14:00' },
    ]);
  });
});

describe('page meta', () => {
  it('keeps carts, checkout, private links, the account and search out of search engines, in every language', () => {
    for (const p of ['/cart', '/checkout', '/order/abc', '/sign/abc/document', '/account', '/account/login', '/search', '/de/cart', '/nl/order/x', '/_or/cart']) expect(isPrivatePath(p), p).toBe(true);
    for (const p of ['/', '/de', '/p/camera', '/de/p/camera', '/c/lenses', '/pages/terms', '/cartography']) expect(isPrivatePath(p), p).toBe(false);
  });

  it('shortens long descriptions at a word', () => {
    expect(shorten('  short   text ')).toBe('short text');
    expect(shorten('')).toBeNull();
    const long = shorten('word '.repeat(60), 40)!;
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith('word…')).toBe(true);
  });
});
