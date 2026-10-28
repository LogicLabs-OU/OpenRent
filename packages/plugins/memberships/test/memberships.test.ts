import { describe, expect, it } from 'vitest';
import { addInterval, overLimit } from '../src/index.ts';
import { all, text } from '../src/texts.ts';

describe('memberships', () => {
  it('ends a period on the same day a month or a year later, or the month’s last day', () => {
    expect(addInterval(new Date('2026-01-15T10:00:00Z'), 'month').toISOString()).toBe('2026-02-15T10:00:00.000Z');
    expect(addInterval(new Date('2026-01-31T10:00:00Z'), 'month').toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addInterval(new Date('2026-12-31T00:00:00Z'), 'month').toISOString()).toBe('2027-01-31T00:00:00.000Z');
    expect(addInterval(new Date('2028-02-29T00:00:00Z'), 'year').toISOString()).toBe('2029-02-28T00:00:00.000Z');
  });

  it('refuses a booking only over the plan’s limit', () => {
    expect(overLimit(2, 1, 1)).toBe(false);
    expect(overLimit(2, 1, 2)).toBe(true);
    expect(overLimit(null, 50, 50)).toBe(false);
  });

  it('has every text in every language, with the same placeholders', () => {
    const en = all('limit');
    expect(Object.keys(en)).toEqual(['en', 'de', 'fr', 'es', 'et', 'ja', 'nl']);
    for (const v of Object.values(en)) expect([...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()).toEqual(['count', 'max', 'plan']);
    expect(text('benefit_max', 'de', { count: 3 })).toBe('Bis zu 3 Artikel gleichzeitig.');
    expect(text('benefit_max', 'xx', { count: 3 })).toBe('Up to 3 items at a time.');
  });
});
