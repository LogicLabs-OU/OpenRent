import { describe, expect, it } from 'vitest';
import { mapHeaders, parseDate, parseMoney } from '../src/imports/spec.ts';

describe('import cell parsers', () => {
  it('reads amounts in European and English notation', () => {
    expect(parseMoney('12.50')).toEqual({ value: 1250 });
    expect(parseMoney('12,50')).toEqual({ value: 1250 });
    expect(parseMoney('€ 1.234,56')).toEqual({ value: 123456 });
    expect(parseMoney('1,234.56')).toEqual({ value: 123456 });
    expect(parseMoney('1,234,567')).toEqual({ value: 123456700 });
    expect(parseMoney('abc')).toHaveProperty('error');
    expect(parseMoney('-5')).toHaveProperty('error');
  });

  it('reads ISO and day-first dates and rejects impossible ones', () => {
    expect(parseDate('2026-12-31')).toEqual({ value: '2026-12-31' });
    expect(parseDate('31.12.2026')).toEqual({ value: '2026-12-31' });
    expect(parseDate('1/2/2026')).toEqual({ value: '2026-02-01' });
    expect(parseDate('31.02.2026')).toHaveProperty('error');
    expect(parseDate('12/31/2026')).toHaveProperty('error');
  });

  it('maps common header names and reports unknown and missing columns', () => {
    const m = mapHeaders('products', ['Product Name', 'Article-Number', 'Rental price', 'Colour']);
    expect(Object.values(m.mapping)).toEqual(['name', 'sku', 'price']);
    expect(m.unknown).toEqual(['Colour']);
    expect(m.missing).toEqual([]);
    expect(mapHeaders('stock_items', ['barcode']).missing).toEqual(['sku']);
  });
});
