import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { bundleAvailable, peakConcurrent, peakConcurrentNaive, type Span } from '../src/availability/sweep.ts';
import { checkBookingRules, isOpenAt } from '../src/availability/rules.ts';

describe('peakConcurrent', () => {
  it('treats touching spans as non-overlapping', () => {
    const spans: Span[] = [{ start: 0, end: 10, quantity: 1 }, { start: 10, end: 20, quantity: 1 }];
    expect(peakConcurrent(spans, 0, 20)).toBe(1);
  });

  it('sums overlapping spans and clips to the window', () => {
    const spans: Span[] = [{ start: 0, end: 10, quantity: 2 }, { start: 5, end: 15, quantity: 3 }, { start: 30, end: 40, quantity: 9 }];
    expect(peakConcurrent(spans, 0, 20)).toBe(5);
    expect(peakConcurrent(spans, 11, 20)).toBe(3);
  });

  it('handles open-ended downtime', () => {
    expect(peakConcurrent([{ start: 5, end: Infinity, quantity: 1 }], 0, 100)).toBe(1);
  });

  it('counts stock rented in for a while as lowering the count, and only then', () => {
    // 3 booked all along; 2 more units are there from 10 to 20: at the tightest instant 3 are out.
    const spans: Span[] = [{ start: 0, end: 30, quantity: 3 }, { start: 10, end: 20, quantity: -2 }];
    expect(peakConcurrent(spans, 0, 30)).toBe(3);
    expect(peakConcurrent(spans, 12, 18)).toBe(1);
    // Rented-in stock that ends as a booking starts does not cover it.
    expect(peakConcurrent([{ start: 0, end: 10, quantity: -2 }, { start: 10, end: 20, quantity: 1 }], 0, 20)).toBe(1);
    // Covering more than is booked: negative, so more than the shop's own stock is free.
    expect(peakConcurrent([{ start: 0, end: 50, quantity: -2 }], 10, 20)).toBe(-2);
  });

  it('matches a brute-force reference', () => {
    const span = fc.record({ start: fc.integer({ min: 0, max: 100 }), len: fc.integer({ min: 1, max: 50 }), quantity: fc.integer({ min: -3, max: 5 }) }).map((s) => ({ start: s.start, end: s.start + s.len, quantity: s.quantity }));
    fc.assert(
      fc.property(fc.array(span, { maxLength: 25 }), fc.integer({ min: 0, max: 120 }), fc.integer({ min: 1, max: 80 }), (spans, from, len) => {
        return peakConcurrent(spans, from, from + len) === peakConcurrentNaive(spans, from, from + len);
      }),
      { numRuns: 500 },
    );
  });
});

describe('bundleAvailable', () => {
  it('is the scarcest component', () => {
    expect(bundleAvailable([{ available: 5, quantity: 1 }, { available: 5, quantity: 2 }])).toBe(2);
    expect(bundleAvailable([{ available: -1, quantity: 1 }])).toBe(0);
  });
});

describe('booking rules', () => {
  const loc = { timezone: 'Europe/Tallinn', opening_hours: { mon: [['09:00', '18:00']] as [string, string][] } };
  const product = { min_duration_min: 60, max_duration_min: null, min_notice_min: 120, increment_min: null };
  it('checks opening hours in the location time zone', () => {
    // 2026-11-02 is a Monday; 07:00Z = 09:00 in Tallinn (UTC+2 in November)
    expect(isOpenAt(loc, new Date('2026-11-02T07:00:00Z'))).toBe(true);
    expect(isOpenAt(loc, new Date('2026-11-02T06:59:00Z'))).toBe(false);
    expect(isOpenAt(loc, new Date('2026-11-03T08:00:00Z'))).toBe(false);
  });
  it('reports notice, duration and hours problems', () => {
    const now = new Date('2026-11-02T07:00:00Z');
    const errs = checkBookingRules(product, loc, [], new Date('2026-11-02T07:30:00Z'), new Date('2026-11-02T08:00:00Z'), now, { enforceHours: true, enforceNotice: true });
    expect(errs.map((e) => e.code).sort()).toEqual(['below_min_duration', 'below_min_notice']);
  });
});
