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

  it('matches a brute-force reference', () => {
    const span = fc.record({ start: fc.integer({ min: 0, max: 100 }), len: fc.integer({ min: 1, max: 50 }), quantity: fc.integer({ min: 1, max: 5 }) }).map((s) => ({ start: s.start, end: s.start + s.len, quantity: s.quantity }));
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
