/**
 * Pricing engine (PRD §7.5, FR-PR-1..6). Pure and deterministic: no I/O, `now` is an input.
 * Every step appends to `explanation` so UIs can show why a price is what it is.
 */
import { MINUTE, addLocalDays, localDate, startOfLocalDay, zonedParts } from '../time.ts';
import { t, type MessageKey } from '../i18n/index.ts';

export type PeriodUnit = 'hour' | 'day' | 'week' | 'month';

export const PERIOD_MINUTES: Record<PeriodUnit, number> = {
  hour: 60,
  day: 1440,
  week: 10080,
  month: 43200, // 30 days
};

export interface Tier {
  /** First period (1-based) this percentage applies to; applies until the next tier. */
  from: number;
  pct_bp: number;
}

export interface PriceStructure {
  id: string;
  kind: 'fixed' | 'per_period' | 'tiered' | 'table';
  period_unit: PeriodUnit;
  amount: number;
  rounding: 'up' | 'nearest' | 'down';
  charge_day_rules?: {
    non_billable_weekdays?: number[];
    /** The first day is free when pickup is at or after `pickup_after` (any time when unset). */
    free_pickup_day?: boolean;
    pickup_after?: string | null;
    /** The last day is free when the return is at or before `return_before` (any time when unset). */
    free_return_day?: boolean;
    return_before?: string | null;
  };
  tiers?: Tier[];
  /** Every `every` periods cost at most `charge` × base (e.g. a week costs 4 days). */
  cap?: { every: number; charge: number } | null;
  price_table?: { periods: number; amount: number }[];
  extra_per_period?: number;
}

export interface CouponRule {
  id: string;
  code: string;
  kind: 'percent' | 'fixed';
  value: number;
  scope: { type: 'order' | 'category' | 'product'; ids?: string[] };
  valid_from?: string | Date | null;
  valid_until?: string | Date | null;
  max_uses?: number | null;
  uses_count?: number;
  max_uses_per_customer?: number | null;
  customer_uses?: number;
  min_order?: number;
  combinable?: boolean;
  active?: boolean;
}

/**
 * A price rule (FR-PR-7): a percentage up or down on rental lines, applied after the base price and before
 * coupons. Season, holiday and weekday rules count only for the share of the rental that falls on their days.
 */
export interface PriceRule {
  id: string;
  name: string;
  kind: 'season' | 'weekday' | 'holiday' | 'customer_group' | 'volume' | 'lead_time';
  /** Lower runs first. */
  priority: number;
  /** −1000 = 10 % off, 2500 = 25 % more. */
  adjustment_bp: number;
  stackable: boolean;
  product_ids?: string[];
  category_ids?: string[];
  /** Local dates, both inclusive. */
  starts_on?: string | null;
  ends_on?: string | null;
  /** 0 = Sunday … 6 = Saturday. */
  weekdays?: number[];
  customer_tags?: string[];
  min_quantity?: number | null;
  min_lead_days?: number | null;
  max_lead_days?: number | null;
}

/**
 * A fee added by rule (FR-PR-8). `amount` is minor units, or basis points for `percent`. Only rental
 * lines in scope count; `optional` fees apply when the customer chose them.
 */
export interface FeeRule {
  id: string;
  name: string;
  kind: 'delivery' | 'cleaning' | 'damage_waiver' | 'extension' | 'late';
  calculation: 'flat' | 'per_unit' | 'percent' | 'per_period' | 'zone' | 'per_km';
  amount: number;
  period_unit?: PeriodUnit | null;
  /** Postcode prefixes and their price, for `zone`. */
  zones?: { postcodes: string[]; amount: number }[];
  /** Distance bands for `per_km` (FR-PR-8): the first one the distance fits; `up_to_km` null is any distance. */
  distance_bands?: { up_to_km: number | null; amount: number }[];
  mode: 'auto' | 'optional';
  product_ids?: string[];
  category_ids?: string[];
  tax_rate_bp: number;
}

/** The customer's choices: optional fees by rule id, and the delivery postcode. */
export interface QuoteOptions {
  fees?: string[];
  postcode?: string | null;
  /** Where to deliver, as the customer wrote it (FR-OR-12). */
  address?: string | null;
  /**
   * Set by the quote, not the customer (FR-PR-8): kilometres from the location to `address`, or why
   * there is none (no address, or not found on the map).
   */
  distance?: { km: number } | { error: 'address_required' | 'address_not_found' } | null;
}

export type FeeError = 'postcode_required' | 'postcode_not_served' | 'address_required' | 'address_not_found' | 'address_too_far';

export interface BundleComponentInput {
  variantId: string;
  name: string;
  quantity: number;
  structure: PriceStructure | null;
  depositPerUnit: number;
}

export interface QuoteLineInput {
  key: string;
  type: 'rental' | 'sale' | 'service' | 'fee' | 'discount';
  productId?: string | null;
  variantId?: string | null;
  categoryIds?: string[];
  name: string;
  quantity: number;
  structure?: PriceStructure | null;
  /** Explicit unit amount for fee lines or manual overrides; the discount amount for discount lines. */
  amount?: number | null;
  /** Discount lines: a share of the rental, sale and service lines, in basis points (instead of `amount`). */
  percentBp?: number | null;
  taxRateBp: number;
  depositPerUnit?: number;
  bundle?: {
    mode: 'sum' | 'fixed' | 'discount_pct';
    discountBp: number;
    components: BundleComponentInput[];
  } | null;
}

export interface QuoteInput {
  currency: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  lines: QuoteLineInput[];
  coupons?: CouponRule[];
  couponCodes?: string[];
  depositPolicy?: { mode: 'auto' | 'none' | 'fixed' | 'percent'; amount?: number; pct_bp?: number };
  customer?: { depositWaived?: boolean; tags?: string[] } | null;
  /** Active price rules of the shop; only those matching a rental line apply to it. */
  priceRules?: PriceRule[];
  /** Active fee rules of the shop (delivery, cleaning, damage waiver). */
  feeRules?: FeeRule[];
  options?: QuoteOptions;
  /** Language of the explanation texts; defaults to English. */
  locale?: string;
}

/** One step of a price explanation: a catalogue key under `price.explain.` and its parameters. */
export interface Explain {
  key: string;
  params?: Record<string, string | number>;
}

export interface LineBreakdown {
  key: string;
  type: QuoteLineInput['type'];
  name: string;
  quantity: number;
  periods: number;
  charge_periods: number;
  period_unit: PeriodUnit | null;
  unit_price: number;
  subtotal: number;
  discount: number;
  net: number;
  tax_rate_bp: number;
  tax: number;
  total: number;
  deposit: number;
  rule_ids: string[];
  /** Discount lines given as a share. */
  percent_bp?: number;
  /** Fee lines added by a fee rule. */
  fee_rule_id?: string;
  fee_kind?: FeeRule['kind'];
  /** `explanation_items` in the quote's language. */
  explanation: string[];
  explanation_items: Explain[];
  components?: { variant_id: string; name: string; quantity: number; unit_price: number }[];
}

export interface QuoteBreakdown {
  currency: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  lines: LineBreakdown[];
  subtotal: number;
  discount: number;
  fees: number;
  tax: number;
  total: number;
  deposit: number;
  coupons_applied: { code: string; coupon_id: string; amount: number }[];
  coupon_errors: { code: string; reason: string }[];
  /** Optional fees the customer can add, with what each would cost now. */
  /** `priced_by` says what a delivery's price waits for when it is not known yet: the postcode or the address. */
  optional_fees: { id: string; name: string; kind: FeeRule['kind']; amount: number; selected: boolean; priced_by: 'postcode' | 'distance' | null }[];
  /** Fees that could not be priced, e.g. a delivery postcode outside every zone. */
  fee_errors: { fee_id: string; reason: FeeError }[];
  tax_breakdown: { rate_bp: number; net: number; tax: number }[];
  /** From the tax plugin (plugin API 1.8): printed under the totals, e.g. for the reverse charge. */
  tax_note?: Record<string, string> | null;
  explanation: string[];
  explanation_items: Explain[];
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export function countPeriods(durationMin: number, unit: PeriodUnit, rounding: PriceStructure['rounding']): number {
  const len = PERIOD_MINUTES[unit];
  const raw = durationMin / len;
  // Tolerate float noise (e.g. 2.0000000001 days from DST-free maths).
  const eps = 1e-9;
  let n: number;
  if (rounding === 'down') n = Math.floor(raw + eps);
  else if (rounding === 'nearest') n = Math.round(raw);
  else n = Math.ceil(raw - eps);
  return Math.max(1, n);
}

/** Charge periods after removing non-billable weekdays (day units only, FR-PR-2). */
export function chargePeriods(
  periods: number,
  unit: PeriodUnit,
  startsAt: Date,
  tz: string,
  rules: PriceStructure['charge_day_rules'],
  endsAt?: Date,
): number {
  if (unit !== 'day' || !rules) return periods;
  const skip = rules.non_billable_weekdays ?? [];
  let n = periods;
  if (skip.length) {
    n = 0;
    for (let i = 0; i < periods; i++) {
      const d = new Date(startsAt.getTime() + i * PERIOD_MINUTES.day * MINUTE);
      if (!skip.includes(zonedParts(d, tz).weekday)) n++;
    }
  }
  // Pickup and return days in the shop's time zone (FR-PR-2).
  const clock = (d: Date) => {
    const p = zonedParts(d, tz);
    return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  };
  // A day already skipped by weekday is not taken off twice.
  const charged = (i: number) => !skip.includes(zonedParts(new Date(startsAt.getTime() + i * PERIOD_MINUTES.day * MINUTE), tz).weekday);
  if (periods > 1 && rules.free_pickup_day && charged(0) && (!rules.pickup_after || clock(startsAt) >= rules.pickup_after)) n--;
  if (periods > 1 && endsAt && rules.free_return_day && charged(periods - 1) && (!rules.return_before || clock(endsAt) <= rules.return_before)) n--;
  return Math.max(1, n);
}

function tierPct(tiers: Tier[], period: number): number {
  let pct = 10000;
  for (const t of [...tiers].sort((a, b) => a.from - b.from)) if (period >= t.from) pct = t.pct_bp;
  return pct;
}

function tierSum(s: PriceStructure, m: number): number {
  let sum = 0;
  for (let i = 1; i <= m; i++) sum += (s.amount * tierPct(s.tiers ?? [], i)) / 10000;
  return sum;
}

function rawTiered(s: PriceStructure, m: number): number {
  const cap = s.cap;
  if (!cap || cap.every <= 0) return tierSum(s, m);
  const blocks = Math.floor(m / cap.every);
  const rem = m % cap.every;
  return blocks * cap.charge * s.amount + Math.min(tierSum(s, rem), cap.charge * s.amount);
}

/**
 * Table pricing: the nearest shorter entry plus `extra_per_period` for each period beyond it,
 * never more than the next longer entry (e.g. 1 day €35, 2 days €60, 7 days €150, extra €15:
 * 4 days = €60 + 2 × €15 = €90). Without an extra rate, the next longer entry applies.
 */
function rawTable(s: PriceStructure, m: number): number {
  const table = [...(s.price_table ?? [])].sort((a, b) => a.periods - b.periods);
  if (table.length === 0) return s.amount * m;
  const exact = table.find((r) => r.periods === m);
  if (exact) return exact.amount;
  const below = [...table].reverse().find((r) => r.periods < m);
  const above = table.find((r) => r.periods > m);
  const extra = s.extra_per_period ?? 0;
  if (!below) return above!.amount;
  const extended = extra > 0 ? below.amount + extra * (m - below.periods) : Number.POSITIVE_INFINITY;
  if (!above) return Number.isFinite(extended) ? extended : below.amount;
  return Math.min(extended, above.amount);
}

/**
 * Price of one unit for `n` charge periods. Tiered and table prices are made monotone:
 * a customer never pays more than for a longer rental ("best price" rule).
 */
export function unitPrice(s: PriceStructure, n: number): { amount: number; note: Explain } {
  switch (s.kind) {
    case 'fixed':
      return { amount: s.amount, note: { key: 'fixed', params: { amount: s.amount } } };
    case 'per_period':
      return { amount: s.amount * n, note: { key: 'per_period', params: { count: n, amount: s.amount, unit: s.period_unit } } };
    case 'tiered': {
      const horizon = n + (s.cap?.every ?? 0);
      let best = rawTiered(s, n);
      for (let m = n + 1; m <= horizon; m++) best = Math.min(best, rawTiered(s, m));
      return { amount: Math.round(best), note: { key: 'tiered', params: { count: n, units: s.period_unit } } };
    }
    case 'table': {
      const table = s.price_table ?? [];
      let best = rawTable(s, n);
      for (const r of table) if (r.periods >= n) best = Math.min(best, r.amount);
      return { amount: Math.round(best), note: { key: 'table', params: { count: n, units: s.period_unit } } };
    }
  }
}

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

function couponProblem(c: CouponRule, now: Date, subtotal: number): string | null {
  if (c.active === false) return 'inactive';
  if (c.valid_from && new Date(c.valid_from) > now) return 'not_yet_valid';
  if (c.valid_until && new Date(c.valid_until) < now) return 'expired';
  if (c.max_uses != null && (c.uses_count ?? 0) >= c.max_uses) return 'usage_limit_reached';
  if (c.max_uses_per_customer != null && (c.customer_uses ?? 0) >= c.max_uses_per_customer) return 'customer_limit_reached';
  if ((c.min_order ?? 0) > subtotal) return 'minimum_not_met';
  return null;
}

function eligible(c: CouponRule, line: QuoteLineInput): boolean {
  if (line.type === 'fee') return false;
  if (c.scope.type === 'order') return true;
  const ids = c.scope.ids ?? [];
  if (c.scope.type === 'product') return !!line.productId && ids.includes(line.productId);
  return (line.categoryIds ?? []).some((id) => ids.includes(id));
}

/** Splits `amount` across weights proportionally with largest-remainder rounding. */
export function allocateProportionally(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (amount * w) / total);
  const floors = exact.map(Math.floor);
  let rest = amount - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r);
  for (const { i } of order) {
    if (rest <= 0) break;
    floors[i]! += 1;
    rest -= 1;
  }
  return floors;
}

// ---------------------------------------------------------------------------
// Price rules (FR-PR-7)
// ---------------------------------------------------------------------------

/** Minutes of [a, b) that fall inside [c, d). */
const overlapMin = (a: number, b: number, c: number, d: number) => Math.max(0, Math.min(b, d) - Math.max(a, c)) / MINUTE;

/**
 * How much of a rental line a rule covers: 0 (not at all) to 1 (all of it). Date and weekday rules give
 * the share of the rental's time on their days; the others apply fully or not at all.
 */
export function ruleShare(
  r: PriceRule,
  q: { startsAt: Date; endsAt: Date; timezone: string; now: Date; quantity: number; productId?: string | null; categoryIds?: string[]; customerTags?: string[] },
): number {
  const products = r.product_ids ?? [];
  const cats = r.category_ids ?? [];
  if ((products.length || cats.length) && !(q.productId && products.includes(q.productId)) && !(q.categoryIds ?? []).some((c) => cats.includes(c))) return 0;
  const start = q.startsAt.getTime();
  const end = q.endsAt.getTime();
  const total = (end - start) / MINUTE;
  if (total <= 0) return 0;
  switch (r.kind) {
    case 'season':
    case 'holiday': {
      if (!r.starts_on && !r.ends_on) return 0;
      const from = r.starts_on ? startOfLocalDay(r.starts_on, q.timezone).getTime() : Number.NEGATIVE_INFINITY;
      const to = r.ends_on ? startOfLocalDay(addLocalDays(r.ends_on, 1), q.timezone).getTime() : Number.POSITIVE_INFINITY;
      return Math.min(1, overlapMin(start, end, from, to) / total);
    }
    case 'weekday': {
      const days = new Set(r.weekdays ?? []);
      if (!days.size) return 0;
      let covered = 0;
      const last = localDate(new Date(end - 1), q.timezone);
      for (let d = localDate(q.startsAt, q.timezone), n = 0; d <= last && n < 4000; d = addLocalDays(d, 1), n++) {
        if (!days.has(new Date(`${d}T00:00:00Z`).getUTCDay())) continue;
        covered += overlapMin(start, end, startOfLocalDay(d, q.timezone).getTime(), startOfLocalDay(addLocalDays(d, 1), q.timezone).getTime());
      }
      return Math.min(1, covered / total);
    }
    case 'customer_group':
      return (r.customer_tags ?? []).some((t) => (q.customerTags ?? []).includes(t)) ? 1 : 0;
    case 'volume':
      return r.min_quantity != null && q.quantity >= r.min_quantity ? 1 : 0;
    case 'lead_time': {
      const lead = Math.floor((start - q.now.getTime()) / (1440 * MINUTE));
      if (r.min_lead_days == null && r.max_lead_days == null) return 0;
      return (r.min_lead_days == null || lead >= r.min_lead_days) && (r.max_lead_days == null || lead <= r.max_lead_days) ? 1 : 0;
    }
  }
}

/**
 * The rules that apply to a line, in priority order: the first matching rule always applies; later ones
 * join only while every applied rule is stackable. Adjustments add up on the base unit price.
 */
export function applyPriceRules(
  rules: PriceRule[],
  unit: number,
  q: Parameters<typeof ruleShare>[1],
): { unit: number; ruleIds: string[]; notes: Explain[] } {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const applied: { r: PriceRule; share: number }[] = [];
  for (const r of sorted) {
    const share = ruleShare(r, q);
    if (share <= 0) continue;
    if (!applied.length || (r.stackable && applied.every((a) => a.r.stackable))) applied.push({ r, share });
  }
  let delta = 0;
  const notes: Explain[] = [];
  for (const { r, share } of applied) {
    const d = Math.round((unit * r.adjustment_bp * share) / 10000);
    delta += d;
    const params = { name: r.name, percent: Math.abs(r.adjustment_bp), amount: Math.abs(d), share_percent: Math.round(share * 10000) };
    const kind = r.adjustment_bp < 0 ? 'rule_discount' : 'rule_surcharge';
    notes.push({ key: share < 1 ? `${kind}_part` : kind, params });
  }
  return { unit: Math.max(0, unit + delta), ruleIds: applied.map((a) => a.r.id), notes };
}

// ---------------------------------------------------------------------------
// Fee rules (FR-PR-8)
// ---------------------------------------------------------------------------

/** Delivery zone price for a postcode: the zone with the longest matching prefix. */
export function zoneAmount(zones: FeeRule['zones'], postcode: string | null | undefined): number | null {
  const pc = (postcode ?? '').replace(/\s+/g, '').toUpperCase();
  if (!pc) return null;
  let best: { len: number; amount: number } | null = null;
  for (const z of zones ?? [])
    for (const p of z.postcodes) {
      const prefix = p.replace(/\s+/g, '').toUpperCase();
      if (prefix && pc.startsWith(prefix) && (!best || prefix.length > best.len)) best = { len: prefix.length, amount: z.amount };
    }
  return best ? best.amount : null;
}

/**
 * Prices one fee rule against the rental lines it covers. Null when it does not apply (no line in scope),
 * or `{ error }` when it needs a postcode the shop does not serve.
 */
export function feeAmount(
  f: FeeRule,
  lines: { productId?: string | null; categoryIds?: string[]; quantity: number; subtotal: number; type: string }[],
  q: { durationMin: number; postcode?: string | null; distance?: QuoteOptions['distance'] },
): { amount: number } | { error: FeeError } | null {
  const products = f.product_ids ?? [];
  const cats = f.category_ids ?? [];
  const inScope = lines.filter(
    (l) => l.type === 'rental' && (!(products.length || cats.length) || (!!l.productId && products.includes(l.productId)) || (l.categoryIds ?? []).some((c) => cats.includes(c))),
  );
  if (!inScope.length) return null;
  switch (f.calculation) {
    case 'flat':
      return { amount: f.amount };
    case 'per_unit':
      return { amount: f.amount * inScope.reduce((a, l) => a + l.quantity, 0) };
    case 'percent':
      return { amount: Math.round((inScope.reduce((a, l) => a + l.subtotal, 0) * f.amount) / 10000) };
    case 'per_period':
      return { amount: f.amount * Math.max(1, countPeriods(q.durationMin, f.period_unit ?? 'day', 'up')) };
    case 'zone': {
      if (!q.postcode?.trim()) return { error: 'postcode_required' };
      const a = zoneAmount(f.zones, q.postcode);
      return a === null ? { error: 'postcode_not_served' } : { amount: a };
    }
    case 'per_km': {
      const d = q.distance ?? { error: 'address_required' as const };
      if ('error' in d) return { error: d.error };
      const band = bandFor(f.distance_bands, d.km);
      return band === null ? { error: 'address_too_far' } : { amount: band };
    }
  }
}

/** The price of the first distance band a distance fits; null when it is beyond the last. */
export function bandFor(bands: FeeRule['distance_bands'], km: number): number | null {
  const sorted = [...(bands ?? [])].sort((a, b) => (a.up_to_km ?? Infinity) - (b.up_to_km ?? Infinity));
  return sorted.find((b) => b.up_to_km === null || km <= b.up_to_km)?.amount ?? null;
}

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------

export function quote(input: QuoteInput, now: Date): QuoteBreakdown {
  const durationMin = Math.max(0, (input.endsAt.getTime() - input.startsAt.getTime()) / MINUTE);
  const say = (e: Explain) => explainText(e, input.currency, input.locale, input.timezone);
  const explanation: Explain[] = [{ key: 'period', params: { from: input.startsAt.toISOString(), to: input.endsAt.toISOString() } }];

  const priceOne = (structure: PriceStructure | null | undefined, lineType: QuoteLineInput['type']) => {
    if (!structure) return { amount: 0, periods: 1, charge: 1, unit: null as PeriodUnit | null, notes: [{ key: 'none' }] as Explain[], ruleIds: [] as string[] };
    if (lineType !== 'rental' || structure.kind === 'fixed') {
      return { amount: structure.amount, periods: 1, charge: 1, unit: null, notes: [{ key: 'unit_price', params: { amount: structure.amount } }] as Explain[], ruleIds: [structure.id] };
    }
    const periods = countPeriods(durationMin, structure.period_unit, structure.rounding);
    const charge = chargePeriods(periods, structure.period_unit, input.startsAt, input.timezone, structure.charge_day_rules, input.endsAt);
    const up = unitPrice(structure, charge);
    const notes: Explain[] = charge !== periods ? [up.note, { key: 'non_billable', params: { count: periods - charge } }] : [up.note];
    return { amount: up.amount, periods, charge, unit: structure.period_unit, notes, ruleIds: [structure.id] };
  };

  const lines: LineBreakdown[] = input.lines.map((l) => {
    const qty = Math.max(1, Math.floor(l.quantity));
    const lineExp: Explain[] = [];
    let unit: number;
    let periods = 1;
    let charge = 1;
    let periodUnit: PeriodUnit | null = null;
    let ruleIds: string[] = [];
    let components: LineBreakdown['components'];
    let depositPerUnit = l.depositPerUnit ?? 0;

    if (l.type === 'discount') {
      // Spread over the other lines once coupons are applied; the line itself carries no amount.
      unit = 0;
    } else if (l.type === 'fee' || l.amount != null) {
      unit = Math.max(0, Math.round(l.amount ?? 0));
      lineExp.push({ key: 'amount', params: { amount: unit } });
    } else if (l.bundle) {
      components = l.bundle.components.map((c) => {
        const p = priceOne(c.structure, 'rental');
        periods = p.periods;
        charge = p.charge;
        periodUnit = p.unit ?? periodUnit;
        ruleIds.push(...p.ruleIds);
        return { variant_id: c.variantId, name: c.name, quantity: c.quantity, unit_price: p.amount };
      });
      const sum = components.reduce((a, c) => a + c.unit_price * c.quantity, 0);
      if (l.bundle.mode === 'fixed') {
        const p = priceOne(l.structure, 'rental');
        unit = p.amount;
        ruleIds = [...p.ruleIds];
        lineExp.push({ key: 'bundle_fixed' }, ...p.notes);
      } else if (l.bundle.mode === 'discount_pct') {
        unit = Math.round((sum * (10000 - l.bundle.discountBp)) / 10000);
        lineExp.push({ key: 'bundle_discount', params: { amount: sum, percent: l.bundle.discountBp } });
      } else {
        unit = sum;
        lineExp.push({ key: 'bundle_sum', params: { amount: sum } });
      }
      if (!depositPerUnit) depositPerUnit = l.bundle.components.reduce((a, c) => a + c.depositPerUnit * c.quantity, 0);
    } else {
      const p = priceOne(l.structure, l.type);
      unit = p.amount;
      periods = p.periods;
      charge = p.charge;
      periodUnit = p.unit;
      ruleIds = p.ruleIds;
      lineExp.push(...p.notes);
    }
    if (l.type === 'rental' && l.amount == null && unit > 0 && input.priceRules?.length) {
      const adj = applyPriceRules(input.priceRules, unit, {
        startsAt: input.startsAt, endsAt: input.endsAt, timezone: input.timezone, now, quantity: qty,
        productId: l.productId, categoryIds: l.categoryIds, customerTags: input.customer?.tags,
      });
      unit = adj.unit;
      ruleIds.push(...adj.ruleIds);
      lineExp.push(...adj.notes);
    }
    const subtotal = unit * qty;
    return {
      key: l.key,
      type: l.type,
      name: l.name,
      quantity: qty,
      periods,
      charge_periods: charge,
      period_unit: periodUnit,
      unit_price: unit,
      subtotal,
      discount: 0,
      net: subtotal,
      tax_rate_bp: l.taxRateBp,
      tax: 0,
      total: subtotal,
      deposit: l.type === 'rental' ? depositPerUnit * qty : 0,
      rule_ids: ruleIds,
      explanation: [] as string[],
      explanation_items: lineExp,
      ...(components ? { components } : {}),
    };
  });

  // --- coupons ---------------------------------------------------------------
  const subtotalBefore = lines.filter((l) => l.type !== 'fee').reduce((a, l) => a + l.subtotal, 0);
  const coupons_applied: QuoteBreakdown['coupons_applied'] = [];
  const coupon_errors: QuoteBreakdown['coupon_errors'] = [];
  const byCode = new Map((input.coupons ?? []).map((c) => [c.code.toLowerCase(), c]));
  const requested = [...new Set((input.couponCodes ?? []).map((c) => c.trim()).filter(Boolean))];
  const valid: CouponRule[] = [];
  for (const code of requested) {
    const c = byCode.get(code.toLowerCase());
    if (!c) {
      coupon_errors.push({ code, reason: 'not_found' });
      continue;
    }
    const problem = couponProblem(c, now, subtotalBefore);
    if (problem) coupon_errors.push({ code, reason: problem });
    else valid.push(c);
  }
  let toApply = valid;
  if (valid.length > 1 && valid.some((c) => !c.combinable)) {
    toApply = [valid[0]!];
    for (const c of valid.slice(1)) coupon_errors.push({ code: c.code, reason: 'not_combinable' });
  }
  for (const c of toApply) {
    const idx = input.lines.map((l, i) => (eligible(c, l) ? i : -1)).filter((i) => i >= 0);
    const base = idx.reduce((a, i) => a + lines[i]!.net, 0);
    if (base <= 0) {
      coupon_errors.push({ code: c.code, reason: 'no_eligible_lines' });
      continue;
    }
    const amount = c.kind === 'percent' ? Math.round((base * Math.min(c.value, 10000)) / 10000) : Math.min(c.value, base);
    const parts = allocateProportionally(amount, idx.map((i) => lines[i]!.net));
    idx.forEach((i, k) => {
      const line = lines[i]!;
      line.discount += parts[k]!;
      line.net -= parts[k]!;
      line.rule_ids.push(c.id);
      line.explanation_items.push({ key: 'coupon_line', params: { code: c.code, amount: parts[k]! } });
    });
    coupons_applied.push({ code: c.code, coupon_id: c.id, amount });
    explanation.push({ key: 'coupon', params: { code: c.code, amount } });
  }

  // --- manual discount lines (FR-OR-2): spread like a coupon so tax stays right per rate ---------
  input.lines.forEach((d, di) => {
    if (d.type !== 'discount') return;
    const idx = input.lines.map((l, i) => (l.type === 'rental' || l.type === 'sale' || l.type === 'service' ? i : -1)).filter((i) => i >= 0);
    const base = idx.reduce((a, i) => a + lines[i]!.net, 0);
    const wanted = d.percentBp != null ? Math.round((base * Math.min(Math.max(d.percentBp, 0), 10000)) / 10000) : Math.max(0, Math.round(d.amount ?? 0));
    const amount = Math.min(wanted, base);
    const parts = allocateProportionally(amount, idx.map((i) => lines[i]!.net));
    idx.forEach((i, k) => {
      const line = lines[i]!;
      line.discount += parts[k]!;
      line.net -= parts[k]!;
      line.rule_ids.push(`manual_discount:${d.key}`);
      line.explanation_items.push({ key: 'discount_line', params: { name: d.name, amount: parts[k]! } });
    });
    const own = lines[di]!;
    own.unit_price = amount;
    if (d.percentBp != null) own.percent_bp = d.percentBp;
    own.explanation_items.push(d.percentBp != null ? { key: 'discount_percent', params: { percent: d.percentBp, amount } } : { key: 'amount', params: { amount } });
  });

  // --- fee rules (FR-PR-8): after rental prices, not touched by coupons ------------------------
  const optional_fees: QuoteBreakdown['optional_fees'] = [];
  const fee_errors: QuoteBreakdown['fee_errors'] = [];
  const chosen = new Set(input.options?.fees ?? []);
  const priced = input.lines.map((l, i) => ({ productId: l.productId, categoryIds: l.categoryIds, type: l.type, quantity: lines[i]!.quantity, subtotal: lines[i]!.subtotal }));
  for (const f of input.feeRules ?? []) {
    if (f.kind === 'extension' || f.kind === 'late') continue;
    const priced_by = f.calculation === 'zone' ? 'postcode' : f.calculation === 'per_km' ? 'distance' : null;
    const wanted = f.mode === 'auto' || chosen.has(f.id);
    const r = feeAmount(f, priced, { durationMin, postcode: input.options?.postcode, distance: input.options?.distance });
    if (!r) continue;
    if ('error' in r) {
      if (wanted) fee_errors.push({ fee_id: f.id, reason: r.error });
      if (f.mode === 'optional') optional_fees.push({ id: f.id, name: f.name, kind: f.kind, amount: 0, selected: chosen.has(f.id), priced_by });
      continue;
    }
    if (f.mode === 'optional') optional_fees.push({ id: f.id, name: f.name, kind: f.kind, amount: r.amount, selected: chosen.has(f.id), priced_by });
    if (!wanted) continue;
    lines.push({
      key: `fee:${f.id}`, type: 'fee', name: f.name, quantity: 1, periods: 1, charge_periods: 1, period_unit: null, unit_price: r.amount, subtotal: r.amount,
      discount: 0, net: r.amount, tax_rate_bp: f.tax_rate_bp, tax: 0, total: r.amount, deposit: 0, rule_ids: [f.id], fee_rule_id: f.id, fee_kind: f.kind,
      explanation: [], explanation_items: [{ key: 'fee_rule', params: { name: f.name, amount: r.amount } }],
    });
  }

  // --- tax: computed per line, rounded per invoice (FR-PR-3) -----------------
  const byRate = new Map<number, { net: number; exact: number }>();
  for (const l of lines) {
    const exact = (l.net * l.tax_rate_bp) / 10000;
    l.tax = Math.round(exact);
    l.total = l.net + l.tax;
    const r = byRate.get(l.tax_rate_bp) ?? { net: 0, exact: 0 };
    r.net += l.net;
    r.exact += exact;
    byRate.set(l.tax_rate_bp, r);
  }
  const tax_breakdown = [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate_bp, r]) => ({ rate_bp, net: r.net, tax: Math.round(r.exact) }));
  const tax = tax_breakdown.reduce((a, r) => a + r.tax, 0);
  // Reconcile line taxes with the invoice-level rounding so lines sum to the total.
  for (const r of tax_breakdown) {
    const ls = lines.filter((l) => l.tax_rate_bp === r.rate_bp);
    const drift = r.tax - ls.reduce((a, l) => a + l.tax, 0);
    if (drift !== 0 && ls.length) {
      const target = ls.reduce((a, b) => (b.net > a.net ? b : a));
      target.tax += drift;
      target.total = target.net + target.tax;
    }
  }

  const subtotal = lines.filter((l) => l.type !== 'fee').reduce((a, l) => a + l.subtotal, 0);
  const fees = lines.filter((l) => l.type === 'fee').reduce((a, l) => a + l.subtotal, 0);
  const discount = lines.reduce((a, l) => a + l.discount, 0);
  const net = lines.reduce((a, l) => a + l.net, 0);

  // --- deposit (FR-PAY-4) -----------------------------------------------------
  const policy = input.depositPolicy ?? { mode: 'auto' };
  let deposit = 0;
  if (input.customer?.depositWaived) {
    explanation.push({ key: 'deposit_waived' });
    for (const l of lines) l.deposit = 0;
  } else if (policy.mode === 'none') {
    for (const l of lines) l.deposit = 0;
  } else if (policy.mode === 'fixed') {
    deposit = Math.max(0, policy.amount ?? 0);
    explanation.push({ key: 'deposit_fixed', params: { amount: deposit } });
  } else if (policy.mode === 'percent') {
    const rentalNet = lines.filter((l) => l.type === 'rental').reduce((a, l) => a + l.net, 0);
    deposit = Math.round((rentalNet * (policy.pct_bp ?? 0)) / 10000);
    explanation.push({ key: 'deposit_percent', params: { percent: policy.pct_bp ?? 0 } });
  } else {
    deposit = lines.reduce((a, l) => a + l.deposit, 0);
    if (deposit) explanation.push({ key: 'deposit_products', params: { amount: deposit } });
  }

  for (const l of lines) l.explanation = l.explanation_items.map(say);

  return {
    currency: input.currency,
    starts_at: input.startsAt.toISOString(),
    ends_at: input.endsAt.toISOString(),
    duration_minutes: durationMin,
    lines,
    subtotal,
    discount,
    fees,
    tax,
    total: net + tax,
    deposit,
    coupons_applied,
    coupon_errors,
    optional_fees,
    fee_errors,
    tax_breakdown,
    explanation: explanation.map(say),
    explanation_items: explanation,
  };
}

/** "3 days" in `locale`. */
export function periodsText(count: number, unit: PeriodUnit, locale = 'en'): string {
  return t('price.desc.periods', { count, unit: t(`price.unit.${unit}` as MessageKey, { count }, locale) }, locale);
}

/**
 * One explanation step as text in `locale`: `*amount` parameters are money, `*percent` parameters are basis points,
 * `unit` is a period unit in the singular and `units` one agreeing with `count`, and `from`/`to` are times in the shop's time zone.
 */
export function explainText(e: Explain, currency: string, locale = 'en', timezone = 'UTC'): string {
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(e.params ?? {})) {
    if (k.endsWith('amount') && typeof v === 'number') params[k] = new Intl.NumberFormat(locale, { style: 'currency', currency }).format(v / 100);
    else if (k.endsWith('percent') && typeof v === 'number') params[k] = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(v / 10000);
    else if (k === 'unit') params[k] = t(`price.unit.${v}` as MessageKey, { count: 1 }, locale);
    else if (k === 'units') params[k] = t(`price.unit.${v}` as MessageKey, { count: Number(e.params?.count ?? 1) }, locale);
    else if (k === 'from' || k === 'to') params[k] = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(String(v)));
    else params[k] = v;
  }
  return t(`price.explain.${e.key}` as MessageKey, params, locale);
}

/** Plain-words description of a price structure for the storefront ("€25/day, from day 3 €15"). */
/**
 * A one-line price summary for shoppers ("€25.00 per day, from day 2 €20.00"), in `locale`.
 * Wording comes from the core catalogues (`price.desc.*`, `price.unit.*`).
 */
export function describeStructure(s: PriceStructure, formatMoney: (n: number) => string, locale = 'en'): string {
  const unit = s.period_unit;
  const units = (count: number) => t(`price.unit.${unit}` as MessageKey, { count }, locale);
  const sep = t('price.desc.separator', {}, locale);
  switch (s.kind) {
    case 'fixed':
      return t('price.desc.fixed', { amount: formatMoney(s.amount) }, locale);
    case 'per_period':
      return t('price.desc.per_period', { amount: formatMoney(s.amount), unit: units(1) }, locale);
    case 'tiered': {
      const parts = [t('price.desc.per_period', { amount: formatMoney(s.amount), unit: units(1) }, locale)];
      for (const tier of [...(s.tiers ?? [])].sort((a, b) => a.from - b.from)) {
        if (tier.from > 1) parts.push(t('price.desc.from', { unit: units(1), n: tier.from, amount: formatMoney(Math.round((s.amount * tier.pct_bp) / 10000)) }, locale));
      }
      if (s.cap) parts.push(t('price.desc.cap', { periods: t('price.desc.periods', { count: s.cap.every, unit: units(s.cap.every) }, locale), charge: s.cap.charge }, locale));
      return parts.join(sep);
    }
    case 'table': {
      const rows = [...(s.price_table ?? [])].sort((a, b) => a.periods - b.periods);
      const base = rows.map((r) => t('price.desc.table_row', { periods: t('price.desc.periods', { count: r.periods, unit: units(r.periods) }, locale), amount: formatMoney(r.amount) }, locale)).join(sep);
      return s.extra_per_period ? t('price.desc.then', { base, amount: formatMoney(s.extra_per_period), unit: units(1) }, locale) : base;
    }
  }
}
