import { currentLocale, t as msg } from '../i18n/index.ts';
import type { Ctx } from '../context.ts';
import { hookContext } from '../plugins/scope.ts';
import { enabledProvider } from '../plugins/index.ts';
import { invalid, type FieldError } from '../errors.ts';
import { many, must, one } from '../sql.ts';
import { quote, type CouponRule, type QuoteBreakdown, type QuoteLineInput, type QuoteOptions } from '../pricing/engine.ts';
import { activeFeeRules, activePriceRules, taxProfileAt, toEngineStructure } from '../catalog/index.ts';
import { resolveSettings } from '../tenancy/settings.ts';

export interface QuoteRequestLine {
  key?: string;
  type?: 'rental' | 'sale' | 'service' | 'fee' | 'discount';
  variant_id?: string | null;
  product_id?: string | null;
  quantity?: number;
  amount?: number | null;
  /** Discount lines: share of the order in basis points, instead of `amount`. */
  percent_bp?: number | null;
  description?: string;
}

export interface QuoteRequest {
  location_id?: string | null;
  starts_at: string | Date;
  ends_at: string | Date;
  lines: QuoteRequestLine[];
  customer_id?: string | null;
  coupon_codes?: string[];
  deposit?: { mode: 'auto' | 'none' | 'fixed' | 'percent'; amount?: number; pct_bp?: number } | null;
  /** Storefront language for line names (display only; orders keep base names). */
  locale?: string | null;
  /** Optional fees chosen and the delivery postcode (FR-PR-8). */
  options?: QuoteOptions | null;
}

export interface ResolvedLine {
  input: QuoteRequestLine;
  engine: QuoteLineInput;
  variant: any | null;
  product: any | null;
  bundleComponents: { variant_id: string; quantity: number; name: string; tracking: string }[];
}

async function taxRateFor(ctx: Ctx, profileId: string | null, cache: Map<string, number>): Promise<number> {
  const key = profileId ?? '__default';
  if (cache.has(key)) return cache.get(key)!;
  const p = profileId
    ? await one(ctx, `SELECT rates FROM tax_profiles WHERE id = $1`, [profileId])
    : await one(ctx, `SELECT rates FROM tax_profiles WHERE is_default AND deleted_at IS NULL LIMIT 1`);
  const rate = (p?.rates ?? []).reduce((a: number, r: any) => a + Number(r.rate_bp ?? 0), 0);
  cache.set(key, rate);
  return rate;
}

export async function resolveLines(ctx: Ctx, lines: QuoteRequestLine[], locale?: string | null, locationId?: string | null): Promise<ResolvedLine[]> {
  const taxCache = new Map<string, number>();
  const profileOf = await taxProfileAt(ctx, locationId);
  const out: ResolvedLine[] = [];
  let i = 0;
  for (const l of lines) {
    const key = l.key ?? String(i++);
    if (l.type === 'discount') {
      if (l.amount == null && l.percent_bp == null)
        throw invalid(msg('error.discount_lines_need_an_amount'), [{ field: `lines[${key}].amount`, code: 'required', message: msg('error.field.enter_an_amount') }]);
      out.push({
        input: l,
        variant: null,
        product: null,
        bundleComponents: [],
        engine: { key, type: 'discount', name: l.description || msg('order.line.discount'), quantity: 1, amount: l.amount ?? null, percentBp: l.percent_bp ?? null, taxRateBp: 0 },
      });
      continue;
    }
    if (l.type === 'fee' || (!l.variant_id && !l.product_id)) {
      if (l.amount == null) throw invalid(msg('error.fee_lines_need_an_amount'), [{ field: `lines[${key}].amount`, code: 'required', message: msg('error.field.enter_an_amount') }]);
      out.push({
        input: l,
        variant: null,
        product: null,
        bundleComponents: [],
        engine: { key, type: 'fee', name: l.description || msg('order.line.fee'), quantity: l.quantity ?? 1, amount: l.amount, taxRateBp: await taxRateFor(ctx, null, taxCache) },
      });
      continue;
    }
    const variant = l.variant_id
      ? await must<any>(ctx, `SELECT v.*, to_jsonb(ps.*) AS ps FROM variants v LEFT JOIN price_structures ps ON ps.id = v.price_structure_id WHERE v.id = $1 AND v.deleted_at IS NULL`, [l.variant_id], 'variant', l.variant_id)
      : await must<any>(ctx, `SELECT v.*, to_jsonb(ps.*) AS ps FROM variants v LEFT JOIN price_structures ps ON ps.id = v.price_structure_id WHERE v.product_id = $1 AND v.deleted_at IS NULL ORDER BY v.is_default DESC, v.position LIMIT 1`, [l.product_id], 'product', l.product_id!);
    const product = await must<any>(ctx, `SELECT * FROM products WHERE id = $1`, [variant.product_id], 'product');
    const cats = (await many<{ category_id: string }>(ctx, `SELECT category_id FROM product_categories WHERE product_id = $1`, [product.id])).map((c) => c.category_id);
    const type = l.type ?? (product.type === 'rental' || product.type === 'bundle' ? 'rental' : product.type === 'service' ? 'service' : 'sale');
    const pName = (locale && product.translations?.[locale]?.name?.trim()) || product.name;
    const vName = (locale && variant.translations?.[locale]?.name?.trim()) || variant.name;
    const name = variant.name && variant.name !== product.name ? `${pName} – ${vName}` : pName;
    const taxRateBp = await taxRateFor(ctx, profileOf(product.tax_profile_id), taxCache);
    const depositPerUnit = Number(variant.deposit_amount ?? product.deposit_amount ?? 0);
    let bundle: QuoteLineInput['bundle'] = null;
    let bundleComponents: ResolvedLine['bundleComponents'] = [];
    if (product.type === 'bundle') {
      const b = await must<any>(ctx, `SELECT * FROM bundles WHERE product_id = $1`, [product.id], 'bundle');
      const comps = await many(
        ctx,
        `SELECT bc.variant_id, bc.quantity, v.tracking, v.deposit_amount, p.deposit_amount AS product_deposit, to_jsonb(ps.*) AS ps,
                p.name || CASE WHEN v.name <> p.name THEN ' – ' || v.name ELSE '' END AS name
           FROM bundle_components bc JOIN variants v ON v.id = bc.variant_id JOIN products p ON p.id = v.product_id
           LEFT JOIN price_structures ps ON ps.id = v.price_structure_id
          WHERE bc.bundle_id = $1 ORDER BY bc.position`,
        [b.id],
      );
      bundleComponents = comps.map((c) => ({ variant_id: c.variant_id, quantity: c.quantity, name: c.name, tracking: c.tracking }));
      bundle = {
        mode: b.pricing_mode,
        discountBp: b.discount_bp,
        components: comps.map((c) => ({ variantId: c.variant_id, name: c.name, quantity: c.quantity, structure: toEngineStructure(c.ps), depositPerUnit: Number(c.deposit_amount ?? c.product_deposit ?? 0) })),
      };
    }
    out.push({
      input: l,
      variant,
      product,
      bundleComponents,
      engine: {
        key, type, productId: product.id, variantId: variant.id, categoryIds: cats, name, quantity: l.quantity ?? 1,
        structure: toEngineStructure(variant.ps), amount: l.amount ?? null, taxRateBp, depositPerUnit: product.type === 'bundle' && depositPerUnit === 0 ? 0 : depositPerUnit, bundle,
      },
    });
  }
  return out;
}

export async function loadCoupons(ctx: Ctx, codes: string[], customerId?: string | null): Promise<CouponRule[]> {
  if (!codes.length) return [];
  const rows = await many(ctx, `SELECT * FROM coupons WHERE lower(code) = ANY($1)`, [codes.map((c) => c.toLowerCase())]);
  const out: CouponRule[] = [];
  for (const r of rows) {
    const uses = customerId
      ? (await one<{ n: number }>(ctx, `SELECT count(*)::int AS n FROM orders WHERE customer_id = $1 AND $2 = ANY(coupon_codes) AND status NOT IN ('cancelled','expired','draft')`, [customerId, r.code]))?.n ?? 0
      : 0;
    out.push({ ...r, value: Number(r.value), min_order: Number(r.min_order), customer_uses: uses });
  }
  return out;
}

/**
 * Rates from a tax plugin (FR-PLG-1) replace the shop's own per line before pricing; the engine is
 * unchanged. If the service fails, the shop's rates apply and the quote still works.
 */
async function applyTaxProvider(ctx: Ctx, resolved: ResolvedLine[], q: { currency: string; locationId: string | null; customerId: string | null; customer: any }) {
  const tax = await enabledProvider(ctx, ctx.plugins.taxProvider());
  if (!tax || !resolved.length) return;
  const loc = await one<any>(ctx, q.locationId ? `SELECT address FROM locations WHERE id = $1` : `SELECT address FROM locations WHERE is_default AND deleted_at IS NULL LIMIT 1`, q.locationId ? [q.locationId] : []);
  // Where the customer gets the gear (a delivery address), else where they are billed.
  const address = q.customer?.addresses?.shipping ?? q.customer?.addresses?.billing ?? null;
  try {
    const rates = await tax.provider.rates(tax.pctx, {
      currency: q.currency,
      customer: q.customerId ? { id: q.customerId, country: address?.country ?? null, taxId: q.customer?.tax_id ?? null, address } : null,
      origin: { country: loc?.address?.country ?? null, address: loc?.address ?? null },
      lines: resolved.map((r) => ({ key: r.engine.key, type: r.engine.type, productId: r.product?.id ?? null, variantId: r.variant?.id ?? null, taxCode: r.product?.tax_profile_id ?? null, defaultRateBp: r.engine.taxRateBp })),
    });
    for (const r of resolved) {
      const rate = rates[r.engine.key];
      if (Number.isInteger(rate) && rate! >= 0 && rate! <= 10_000) r.engine.taxRateBp = rate!;
    }
  } catch (err) {
    ctx.logger.warn({ err, plugin: tax.pluginId }, 'tax provider failed; the shop’s own rates apply');
  }
}

export async function priceQuote(ctx: Ctx, req: QuoteRequest): Promise<{ breakdown: QuoteBreakdown; resolved: ResolvedLine[]; timezone: string; currency: string }> {
  const startsAt = new Date(req.starts_at);
  const endsAt = new Date(req.ends_at);
  const errors: FieldError[] = [];
  if (Number.isNaN(startsAt.getTime())) errors.push({ field: 'starts_at', code: 'invalid', message: msg('error.field.invalid_date_time') });
  if (Number.isNaN(endsAt.getTime())) errors.push({ field: 'ends_at', code: 'invalid', message: msg('error.field.invalid_date_time') });
  if (!errors.length && endsAt <= startsAt) errors.push({ field: 'ends_at', code: 'invalid_range', message: msg('error.the_return_must_be_after_the_pickup') });
  if (errors.length) throw invalid(msg('error.invalid_rental_period'), errors);
  const tenant = await must<any>(ctx, `SELECT currency, timezone, settings FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const loc = req.location_id ? await must<any>(ctx, `SELECT timezone FROM locations WHERE id = $1`, [req.location_id], 'location') : null;
  const timezone = loc?.timezone ?? tenant.timezone;
  const resolved = await resolveLines(ctx, req.lines, req.locale, req.location_id);
  const customer = req.customer_id ? await one(ctx, `SELECT flags, addresses, tax_id, tags FROM customers WHERE id = $1`, [req.customer_id]) : null;
  await applyTaxProvider(ctx, resolved, { currency: tenant.currency.trim(), locationId: req.location_id ?? null, customerId: req.customer_id ?? null, customer });
  const settings = resolveSettings(tenant.settings);
  const breakdown = quote(
    {
      currency: tenant.currency.trim(),
      startsAt,
      endsAt,
      timezone,
      lines: resolved.map((r) => r.engine),
      coupons: await loadCoupons(ctx, req.coupon_codes ?? [], req.customer_id),
      couponCodes: req.coupon_codes ?? [],
      depositPolicy: req.deposit ?? settings.deposit_policy,
      customer: customer ? { depositWaived: !!customer.flags?.deposit_waived, tags: (customer.tags ?? []).filter(Boolean) } : null,
      priceRules: await activePriceRules(ctx),
      feeRules: await activeFeeRules(ctx, req.locale, undefined, req.location_id),
      options: req.options ?? {},
      locale: req.locale ?? currentLocale(),
    },
    ctx.now,
  );
  await ctx.plugins.runHook('after', 'pricing.quote', breakdown, hookContext(ctx));
  return { breakdown, resolved, timezone, currency: tenant.currency.trim() };
}

const m = (amount: number, currency: string) => ({ amount, currency });

/** API shape of a quote breakdown (money as {amount, currency}). */
export function breakdownToApi(b: QuoteBreakdown) {
  const c = b.currency;
  return {
    object: 'price_quote',
    currency: c,
    starts_at: b.starts_at,
    ends_at: b.ends_at,
    duration_minutes: b.duration_minutes,
    lines: b.lines.map((l) => ({
      key: l.key, type: l.type, name: l.name, quantity: l.quantity, periods: l.periods, charge_periods: l.charge_periods, period_unit: l.period_unit,
      unit_price: m(l.unit_price, c), subtotal: m(l.subtotal, c), discount: m(l.discount, c), tax_rate_bp: l.tax_rate_bp, tax: m(l.tax, c),
      total: m(l.total, c), deposit: m(l.deposit, c), rule_ids: l.rule_ids, explanation: l.explanation, explanation_items: l.explanation_items, components: l.components,
      fee_rule_id: l.fee_rule_id ?? null, fee_kind: l.fee_kind ?? null,
    })),
    subtotal: m(b.subtotal, c),
    discount: m(b.discount, c),
    fees: m(b.fees, c),
    tax: m(b.tax, c),
    total: m(b.total, c),
    deposit: m(b.deposit, c),
    coupons_applied: b.coupons_applied.map((x) => ({ ...x, amount: m(x.amount, c) })),
    coupon_errors: b.coupon_errors,
    optional_fees: b.optional_fees.map((f) => ({ ...f, amount: m(f.amount, c) })),
    fee_errors: b.fee_errors,
    tax_breakdown: b.tax_breakdown.map((t) => ({ rate_bp: t.rate_bp, net: m(t.net, c), tax: m(t.tax, c) })),
    explanation: b.explanation,
    explanation_items: b.explanation_items,
  };
}
