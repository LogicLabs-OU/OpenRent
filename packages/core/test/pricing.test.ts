import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { allocateProportionally, chargePeriods, countPeriods, quote, unitPrice, type FeeRule, type PriceRule, type PriceStructure, type QuoteInput } from '../src/pricing/engine.ts';

const day = (n: number) => n * 24 * 3600 * 1000;
const start = new Date('2026-11-02T09:00:00Z'); // Monday

const perDay: PriceStructure = { id: 'prs_day', kind: 'per_period', period_unit: 'day', amount: 2500, rounding: 'up' };
const tiered: PriceStructure = {
  id: 'prs_tier',
  kind: 'tiered',
  period_unit: 'day',
  amount: 10000,
  rounding: 'up',
  tiers: [{ from: 1, pct_bp: 10000 }, { from: 2, pct_bp: 5000 }],
  cap: { every: 7, charge: 4 },
};
const table: PriceStructure = {
  id: 'prs_tbl',
  kind: 'table',
  period_unit: 'day',
  amount: 0,
  rounding: 'up',
  price_table: [{ periods: 1, amount: 3000 }, { periods: 3, amount: 6000 }, { periods: 7, amount: 10000 }],
  extra_per_period: 1000,
};

function input(structure: PriceStructure, days: number, extra: Partial<QuoteInput> = {}): QuoteInput {
  return {
    currency: 'EUR',
    startsAt: start,
    endsAt: new Date(start.getTime() + day(days)),
    timezone: 'Europe/Tallinn',
    lines: [{ key: 'a', type: 'rental', name: 'Bike', quantity: 1, structure, taxRateBp: 2000, depositPerUnit: 5000, productId: 'prod_1' }],
    ...extra,
  };
}

describe('periods', () => {
  it('rounds partial periods up by default', () => {
    expect(countPeriods(1441, 'day', 'up')).toBe(2);
    expect(countPeriods(1440, 'day', 'up')).toBe(1);
    expect(countPeriods(30, 'day', 'up')).toBe(1);
    expect(countPeriods(2000, 'day', 'down')).toBe(1);
    expect(countPeriods(2200, 'day', 'nearest')).toBe(2);
  });
});

describe('price structures', () => {
  it('per_period multiplies by periods', () => {
    expect(quote(input(perDay, 3), start).lines[0]!.unit_price).toBe(7500);
  });

  it('tiered: day 1 = 100%, day 2+ = 50%, week = 4 days', () => {
    expect(unitPrice(tiered, 1).amount).toBe(10000);
    expect(unitPrice(tiered, 3).amount).toBe(20000);
    expect(unitPrice(tiered, 7).amount).toBe(40000);
    // 6 days would be 35000 raw; never more than the 7-day price
    expect(unitPrice(tiered, 6).amount).toBe(35000);
  });

  it('table extends the nearest shorter entry, capped by the next longer one', () => {
    expect(unitPrice(table, 2).amount).toBe(4000);
    expect(unitPrice(table, 5).amount).toBe(8000);
    expect(unitPrice(table, 6).amount).toBe(9000);
    expect(unitPrice(table, 7).amount).toBe(10000);
    expect(unitPrice(table, 9).amount).toBe(12000);
  });

  it('non-billable weekdays reduce charge days', () => {
    const s: PriceStructure = { ...perDay, charge_day_rules: { non_billable_weekdays: [0] } };
    const q = quote(input(s, 7), start);
    expect(q.lines[0]!.periods).toBe(7);
    expect(q.lines[0]!.charge_periods).toBe(6);
    expect(q.lines[0]!.unit_price).toBe(15000);
  });
});

describe('quote', () => {
  it('computes tax, total and deposit', () => {
    const q = quote(input(perDay, 2), start);
    expect(q.subtotal).toBe(5000);
    expect(q.tax).toBe(1000);
    expect(q.total).toBe(6000);
    expect(q.deposit).toBe(5000);
  });

  it('applies a percent coupon and rejects unknown ones', () => {
    const q = quote(
      input(perDay, 2, {
        coupons: [{ id: 'cpn_1', code: 'AUTUMN10', kind: 'percent', value: 1000, scope: { type: 'order' } }],
        couponCodes: ['autumn10', 'NOPE'],
      }),
      start,
    );
    expect(q.discount).toBe(500);
    expect(q.total).toBe(5400);
    expect(q.coupon_errors).toEqual([{ code: 'NOPE', reason: 'not_found' }]);
  });

  it('rejects expired coupons and enforces combinability', () => {
    const q = quote(
      input(perDay, 2, {
        coupons: [
          { id: 'c1', code: 'A', kind: 'fixed', value: 100, scope: { type: 'order' } },
          { id: 'c2', code: 'B', kind: 'fixed', value: 100, scope: { type: 'order' }, combinable: true },
          { id: 'c3', code: 'OLD', kind: 'fixed', value: 100, scope: { type: 'order' }, valid_until: '2020-01-01' },
        ],
        couponCodes: ['A', 'B', 'OLD'],
      }),
      start,
    );
    expect(q.coupons_applied.map((c) => c.code)).toEqual(['A']);
    expect(q.coupon_errors.map((e) => e.reason).sort()).toEqual(['expired', 'not_combinable']);
  });

  it('waives deposits for flagged customers', () => {
    expect(quote(input(perDay, 2, { customer: { depositWaived: true } }), start).deposit).toBe(0);
  });

  it('prices bundles from components with a discount', () => {
    const q = quote(
      {
        ...input(perDay, 2),
        lines: [
          {
            key: 'b',
            type: 'rental',
            name: 'Camera kit',
            quantity: 1,
            taxRateBp: 2000,
            bundle: {
              mode: 'discount_pct',
              discountBp: 1000,
              components: [
                { variantId: 'v1', name: 'Body', quantity: 1, structure: perDay, depositPerUnit: 1000 },
                { variantId: 'v2', name: 'Lens', quantity: 2, structure: perDay, depositPerUnit: 500 },
              ],
            },
          },
        ],
      },
      start,
    );
    expect(q.lines[0]!.unit_price).toBe(Math.round(15000 * 0.9));
    expect(q.deposit).toBe(2000);
  });
});

describe('properties', () => {
  const structures = fc.constantFrom(perDay, tiered, table);

  it('a longer rental is never cheaper', () => {
    fc.assert(
      fc.property(structures, fc.integer({ min: 1, max: 60 }), fc.integer({ min: 0, max: 30 }), (s, d, extra) => {
        const a = quote(input(s, d), start).total;
        const b = quote(input(s, d + extra), start).total;
        return b >= a;
      }),
    );
  });

  it('total equals net plus tax, and line totals sum to the order total', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ q: fc.integer({ min: 1, max: 9 }), rate: fc.constantFrom(0, 900, 2000, 2400), amt: fc.integer({ min: 1, max: 99999 }) }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 5000 }),
        (ls, pct) => {
          const q = quote(
            {
              currency: 'EUR',
              startsAt: start,
              endsAt: new Date(start.getTime() + day(3)),
              timezone: 'UTC',
              lines: ls.map((l, i) => ({ key: String(i), type: 'rental', name: 'x', quantity: l.q, taxRateBp: l.rate, structure: { ...perDay, amount: l.amt } })),
              coupons: [{ id: 'c', code: 'P', kind: 'percent', value: pct, scope: { type: 'order' } }],
              couponCodes: ['P'],
            },
            start,
          );
          const lineSum = q.lines.reduce((a, l) => a + l.total, 0);
          const taxSum = q.lines.reduce((a, l) => a + l.tax, 0);
          return q.total === q.subtotal - q.discount + q.fees + q.tax && lineSum === q.total && taxSum === q.tax && q.discount <= q.subtotal;
        },
      ),
    );
  });

  it('is deterministic', () => {
    fc.assert(fc.property(structures, fc.integer({ min: 1, max: 40 }), (s, d) => JSON.stringify(quote(input(s, d), start)) === JSON.stringify(quote(input(s, d), start))));
  });

  it('proportional allocation preserves the total', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100000 }), fc.array(fc.integer({ min: 1, max: 10000 }), { minLength: 1, maxLength: 10 }), (amount, w) => {
        const parts = allocateProportionally(amount, w);
        return parts.reduce((a, b) => a + b, 0) === amount && parts.every((p) => p >= 0);
      }),
    );
  });
});

describe('manual discount lines (FR-OR-2)', () => {
  const mixed = (lines: QuoteInput['lines']): QuoteInput => ({ currency: 'EUR', startsAt: start, endsAt: new Date(start.getTime() + day(2)), timezone: 'Europe/Tallinn', lines });
  const rental = (key: string, rate: number): QuoteInput['lines'][number] => ({ key, type: 'rental', name: key, quantity: 1, structure: perDay, taxRateBp: rate });
  it('spreads a fixed discount over the lines so tax per rate stays exact', () => {
    const q = quote(mixed([rental('a', 2400), rental('b', 900), { key: 'd', type: 'discount', name: 'Loyal customer', quantity: 1, amount: 1000, taxRateBp: 0 }]), start);
    expect(q.discount).toBe(1000);
    expect(q.lines.find((l) => l.key === 'd')!.total).toBe(0);
    expect(q.lines.find((l) => l.key === 'd')!.unit_price).toBe(1000);
    // Each line keeps its own rate; the sum of line taxes equals the per-rate totals.
    const tax = q.lines.reduce((a, l) => a + l.tax, 0);
    expect(tax).toBe(q.tax_breakdown.reduce((a, r) => a + r.tax, 0));
    expect(q.total).toBe(q.subtotal - 1000 + q.tax);
  });
  it('takes a percentage and never more than the order', () => {
    const pct = quote(mixed([rental('a', 0), { key: 'd', type: 'discount', name: 'Promo', quantity: 1, percentBp: 1000, taxRateBp: 0 }]), start);
    expect(pct.discount).toBe(500);
    const big = quote(mixed([rental('a', 0), { key: 'd', type: 'discount', name: 'Promo', quantity: 1, amount: 99999, taxRateBp: 0 }]), start);
    expect(big.total).toBe(0);
  });
});

describe('free pickup and return days (FR-PR-2)', () => {
  const rules = { free_pickup_day: true, pickup_after: '16:00', free_return_day: true, return_before: '10:00' };
  it('drops the pickup and return day by time of day in the shop time zone', () => {
    // Friday 16:30 → Monday 09:30 in Tallinn: 3 periods, Friday and Monday free.
    const from = new Date('2026-11-06T14:30:00Z');
    const to = new Date('2026-11-09T07:30:00Z');
    expect(chargePeriods(3, 'day', from, 'Europe/Tallinn', rules, to)).toBe(1);
    // Picked up in the morning: the pickup day is charged.
    expect(chargePeriods(3, 'day', new Date('2026-11-06T07:00:00Z'), 'Europe/Tallinn', rules, to)).toBe(2);
    // Never below one period.
    expect(chargePeriods(2, 'day', from, 'Europe/Tallinn', rules, new Date('2026-11-08T07:30:00Z'))).toBe(1);
  });
  it('works across a daylight-saving change and does not take a skipped weekday off twice', () => {
    // 24 → 27 October 2026 crosses the end of summer time in Tallinn.
    const from = new Date('2026-10-24T14:00:00Z');
    const to = new Date('2026-10-27T07:00:00Z');
    expect(chargePeriods(3, 'day', from, 'Europe/Tallinn', { ...rules, non_billable_weekdays: [6] }, to)).toBe(1);
  });
  it('leaves hour prices alone', () => {
    expect(chargePeriods(5, 'hour', start, 'UTC', rules, new Date(start.getTime() + 5 * 3600_000))).toBe(5);
  });
});

describe('explanations', () => {
  it('are written in the quote language with structured steps', () => {
    const q = quote({ ...input(perDay, 2), locale: 'de' }, start);
    expect(q.lines[0]!.explanation_items[0]).toEqual({ key: 'per_period', params: { count: 2, amount: 2500, unit: 'day' } });
    expect(q.lines[0]!.explanation[0]!.replace(/\s/g, ' ')).toBe('2 × 25,00 € pro Tag');
  });
});

describe('price rules (FR-PR-7)', () => {
  const now = new Date('2026-10-01T09:00:00Z');
  const rule = (r: Partial<PriceRule> & Pick<PriceRule, 'kind' | 'adjustment_bp'>): PriceRule => ({ id: `rule_${r.kind}_${r.adjustment_bp}`, name: r.kind, priority: 100, stackable: false, ...r });
  const line = (q: QuoteInput, rules: PriceRule[], customer?: QuoteInput['customer']) => quote({ ...q, priceRules: rules, customer }, now).lines[0]!;

  it('prices a season by the share of the rental inside it', () => {
    // Mon 2 Nov 11:00 → Wed 4 Nov 11:00 in Tallinn; high season from 3 Nov 00:00: 35 of the 48 hours.
    const l = line(input(perDay, 2), [rule({ kind: 'season', adjustment_bp: 2000, starts_on: '2026-11-03', ends_on: '2026-11-30' })]);
    expect(l.unit_price).toBe(5000 + Math.round(1000 * (35 / 48)));
    expect(l.rule_ids).toEqual(['prs_day', 'rule_season_2000']);
    expect(l.explanation_items.at(-1)).toMatchObject({ key: 'rule_surcharge_part', params: { share_percent: Math.round((35 / 48) * 10000) } });
    expect(line(input(perDay, 2), [rule({ kind: 'season', adjustment_bp: 2000, starts_on: '2026-12-01', ends_on: '2026-12-31' })]).unit_price).toBe(5000);
  });

  it('applies weekday, volume, lead-time and customer-group rules', () => {
    // Mon 11:00 → Sat 11:00 in Tallinn covers Saturday 00:00–11:00: 11 h of 120 h.
    const weekend = line(input(perDay, 5), [rule({ kind: 'weekday', adjustment_bp: 10000, weekdays: [0, 6] })]);
    expect(weekend.unit_price).toBe(12500 + Math.round(12500 * (11 / 120)));
    const qty = { ...input(perDay, 1), lines: [{ ...input(perDay, 1).lines[0]!, quantity: 5 }] };
    expect(line(qty, [rule({ kind: 'volume', adjustment_bp: -1000, min_quantity: 5 })]).subtotal).toBe(5 * 2250);
    expect(line(input(perDay, 1), [rule({ kind: 'volume', adjustment_bp: -1000, min_quantity: 5 })]).unit_price).toBe(2500);
    expect(line(input(perDay, 1), [rule({ kind: 'lead_time', adjustment_bp: -1500, min_lead_days: 30 })]).unit_price).toBe(2125);
    expect(line(input(perDay, 1), [rule({ kind: 'lead_time', adjustment_bp: 2000, max_lead_days: 2 })]).unit_price).toBe(2500);
    const vip = rule({ kind: 'customer_group', adjustment_bp: -2000, customer_tags: ['vip'] });
    expect(line(input(perDay, 1), [vip], { tags: ['vip'] }).unit_price).toBe(2000);
    expect(line(input(perDay, 1), [vip], { tags: ['regular'] }).unit_price).toBe(2500);
  });

  it('runs the first rule by priority and stacks only stackable rules', () => {
    const early = rule({ kind: 'lead_time', adjustment_bp: -1000, min_lead_days: 7, priority: 10 });
    const vol = rule({ kind: 'volume', adjustment_bp: -500, min_quantity: 1, priority: 20 });
    expect(line(input(perDay, 1), [vol, early]).rule_ids).toEqual(['prs_day', early.id]);
    const both = line(input(perDay, 1), [{ ...early, stackable: true }, { ...vol, stackable: true }]);
    expect(both.unit_price).toBe(2500 - 250 - 125);
    expect(both.rule_ids).toEqual(['prs_day', early.id, vol.id]);
  });

  it('keeps rules to their products and categories, and away from manual prices', () => {
    const scoped = rule({ kind: 'volume', adjustment_bp: -1000, min_quantity: 1, product_ids: ['prod_other'] });
    expect(line(input(perDay, 1), [scoped]).unit_price).toBe(2500);
    const byCat = rule({ kind: 'volume', adjustment_bp: -1000, min_quantity: 1, category_ids: ['cat_bikes'] });
    const q = input(perDay, 1);
    expect(line({ ...q, lines: [{ ...q.lines[0]!, categoryIds: ['cat_bikes'] }] }, [byCat]).unit_price).toBe(2250);
    expect(line({ ...q, lines: [{ ...q.lines[0]!, amount: 4000 }] }, [rule({ kind: 'volume', adjustment_bp: -1000, min_quantity: 1 })]).unit_price).toBe(4000);
  });

  it('applies before coupons and never goes below zero', () => {
    const q = input(perDay, 1, { coupons: [{ id: 'cpn_1', code: 'TEN', kind: 'percent', value: 1000, scope: { type: 'order' } }], couponCodes: ['TEN'] });
    const l = line(q, [rule({ kind: 'volume', adjustment_bp: -2000, min_quantity: 1 })]);
    expect([l.unit_price, l.discount, l.net]).toEqual([2000, 200, 1800]);
    expect(line(input(perDay, 1), [rule({ kind: 'volume', adjustment_bp: -10000, min_quantity: 1 })]).unit_price).toBe(0);
  });
});

describe('fee rules (FR-PR-8)', () => {
  const now = new Date('2026-10-01T09:00:00Z');
  const fee = (f: Partial<FeeRule> & Pick<FeeRule, 'calculation' | 'amount'>): FeeRule => ({ id: `fee_${f.calculation}`, name: f.calculation, kind: 'cleaning', mode: 'auto', tax_rate_bp: 2000, ...f });
  const run = (q: QuoteInput, fees: FeeRule[], options?: QuoteInput['options']) => quote({ ...q, feeRules: fees, options }, now);
  const two = (days: number) => { const q = input(perDay, days); return { ...q, lines: [{ ...q.lines[0]!, quantity: 2 }] }; };

  it('adds auto fees as their own lines, untouched by coupons', () => {
    const q = { ...two(3), coupons: [{ id: 'cpn_1', code: 'HALF', kind: 'percent' as const, value: 5000, scope: { type: 'order' as const } }], couponCodes: ['HALF'] };
    const b = run(q, [fee({ calculation: 'flat', amount: 1500 }), fee({ calculation: 'per_unit', amount: 300 }), fee({ calculation: 'per_period', amount: 100, period_unit: 'day' })]);
    const fees = b.lines.filter((l) => l.type === 'fee');
    expect(fees.map((l) => [l.fee_rule_id, l.subtotal, l.discount])).toEqual([['fee_flat', 1500, 0], ['fee_per_unit', 600, 0], ['fee_per_period', 300, 0]]);
    expect(b.fees).toBe(2400);
    expect(b.subtotal).toBe(15000);
    expect(b.discount).toBe(7500);
    expect(b.total).toBe(Math.round((7500 + 2400) * 1.2));
  });

  it('prices a damage waiver as a share of the rental, and only when chosen if optional', () => {
    const waiver = fee({ id: 'fee_dw', kind: 'damage_waiver', calculation: 'percent', amount: 1000, mode: 'optional' });
    const offered = run(two(3), [waiver]);
    expect(offered.lines.some((l) => l.type === 'fee')).toBe(false);
    expect(offered.optional_fees).toEqual([{ id: 'fee_dw', name: 'percent', kind: 'damage_waiver', amount: 1500, selected: false, priced_by: null }]);
    const taken = run(two(3), [waiver], { fees: ['fee_dw'] });
    expect(taken.lines.find((l) => l.type === 'fee')).toMatchObject({ subtotal: 1500, fee_kind: 'damage_waiver' });
    expect(taken.optional_fees[0]!.selected).toBe(true);
  });

  it('prices delivery by the longest matching postcode prefix', () => {
    const delivery = fee({ id: 'fee_del', kind: 'delivery', calculation: 'zone', amount: 0, mode: 'optional', zones: [{ postcodes: ['10'], amount: 2000 }, { postcodes: ['101', '102'], amount: 1000 }] });
    expect(run(two(1), [delivery], { fees: ['fee_del'], postcode: '10115' }).fees).toBe(1000);
    expect(run(two(1), [delivery], { fees: ['fee_del'], postcode: '10999' }).fees).toBe(2000);
    expect(run(two(1), [delivery], { fees: ['fee_del'], postcode: '50000' }).fee_errors).toEqual([{ fee_id: 'fee_del', reason: 'postcode_not_served' }]);
    expect(run(two(1), [delivery], { fees: ['fee_del'] }).fee_errors).toEqual([{ fee_id: 'fee_del', reason: 'postcode_required' }]);
  });

  it('skips fees whose products are not in the order, and extension or late fees', () => {
    expect(run(two(1), [fee({ calculation: 'flat', amount: 999, product_ids: ['prod_other'] })]).fees).toBe(0);
    expect(run(two(1), [fee({ calculation: 'flat', amount: 999, kind: 'late' })]).fees).toBe(0);
  });
});
