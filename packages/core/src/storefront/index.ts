import { t as msg, currentLocale } from '../i18n/index.ts';
import { childThemeFor, storefrontTheme } from '../themes/index.ts';
import type { CheckoutCustomer } from '../customers/index.ts';
import { createHash } from 'node:crypto';
import type { Ctx } from '../context.ts';
import { t as tr } from '../i18n/index.ts';
import { money } from '../crud.ts';
import { AppError, invalid, type FieldError } from '../errors.ts';
import { newId } from '../ids.ts';
import { exec, json, many, must, one } from '../sql.ts';
import { addMinutes, localDate, parseLocalDate, zonedTimeToUtc } from '../time.ts';
import * as availability from '../availability/index.ts';
import { describeStructure, type QuoteOptions } from '../pricing/engine.ts';
import { formatMoney } from '../format.ts';
import { activeFeeRules, listProducts, getProduct, categories, taxProfileAt, toEngineStructure, relationsOf } from '../catalog/index.ts';
import { taxRateFor } from '../orders/quote.ts';
import { fillFromCheckout, findOrCreateByEmail, getProfile, saveProfile, snapshotOf, cleanAddress, type BillingSnapshot } from '../customers/index.ts';
import { accountTermsFor } from '../customers/b2b.ts';
import { checkTaxId } from '../customers/tax-id.ts';

export { sendCartReminders, restoreCart, stopCartReminders } from './reminders.ts';
import { activeProvider, amountDue, createPaymentIntent, createPaymentRequest, upfrontAmount } from '../payments/index.ts';
import { notifyStaff } from '../notifications/index.ts';
import { tenantLocale } from '../i18n/context.ts';
import { storefrontBase } from '../domains/index.ts';
import { enabledProvider, textChannel } from '../plugins/index.ts';
import { checkCheckoutExtra, pluginSectionSchemas, productBadges, renderPluginSections, storefrontExtensions } from '../plugins/storefront.ts';
import { hookContext } from '../plugins/scope.ts';
import { overridesByLocale, overridesFor } from '../strings/index.ts';
import { resolveSettings, type NavItem, type TenantSettings } from '../tenancy/settings.ts';
import { publishedPages } from './pages.ts';
import { breakdownToApi, createOrder, priceQuote, runAction } from '../orders/index.ts';
import { accountCustomer, asCustomerCtx, ownedOrder, canRequestCancel, canRequestExtension, extensionToApi, latestExtensions, latestRequests, orderDocuments, requestToApi } from '../accounts/index.ts';
import { customerAttachments } from '../attachments/index.ts';
import { visibleFields } from '../customfields/index.ts';
import { scheduleDelivery } from '../deliveries/index.ts';
import { richTextHtml, richTextPlain } from './code.ts';

export const termsHash = (text: string) => createHash('sha256').update(text).digest('hex');

/** Rental terms in a storefront language, falling back to the base text. */
export function termsText(s: TenantSettings, locale?: string | null) {
  return (locale && s.terms.translations?.[locale]?.trim()) || s.terms.text;
}

/** Category name in a storefront language (falls back to the base name). */
const categoryName = (c: any, locale?: string | null) => (locale && c.translations?.[locale]?.name?.trim()) || c.name;
/** A search engine text in one language: the language's own, else the base one, else nothing. */
const seoText = (base: { title?: string | null; description?: string | null } | null | undefined, own: { title?: string | null; description?: string | null } | null | undefined) => ({
  title: own?.title?.trim() || base?.title?.trim() || null,
  description: own?.description?.trim() || base?.description?.trim() || null,
});
/** Products and categories keep their other languages' search engine texts beside the name. */
const seoOwn = (tr: { seo_title?: string; seo_description?: string } | null | undefined) => (tr ? { title: tr.seo_title, description: tr.seo_description } : null);

/**
 * `previewThemeId` comes from a verified preview token (themes.verifyPreviewToken). `locale` picks
 * the shop's texts (categories, terms, header and footer HTML) for one storefront language.
 */
/**
 * A child theme renders with its parent's code (`code_id`); its texts sit under the shop's own
 * overrides, its defaults under the saved settings, and its CSS and asset URLs come along (FR-THM-8).
 */
async function withChildTheme(ctx: Ctx, theme0: ReturnType<typeof storefrontTheme>) {
  // Texts the shop changed in Settings → Translations sit on top of the theme's (FR-I18N-6).
  const own = await overridesByLocale(ctx, `theme:${theme0.id}`);
  const theme = { ...theme0, translations: { ...theme0.translations } };
  for (const [l, cat] of Object.entries(own)) theme.translations[l] = { ...(theme.translations[l] ?? {}), ...cat };
  const child = await childThemeFor(ctx, theme.id);
  if (!child) return { ...theme, code_id: theme.id, css: '', assets: {} as Record<string, string> };
  const translations: Record<string, Record<string, string>> = {};
  for (const l of new Set([...Object.keys(child.locales), ...Object.keys(theme.translations)])) translations[l] = { ...(child.locales[l] ?? {}), ...(theme.translations[l] ?? {}) };
  return { ...theme, code_id: child.parent, settings: { ...child.settingsData, ...theme.settings }, translations, sections: theme.sections ?? child.sectionsData, css: child.css, assets: child.assets };
}

/** The HTML of the plugin sections on the home page, rendered here so the storefront needs no second call. */
async function withPluginSections<T extends { sections: unknown[] | null }>(ctx: Ctx, theme: T, locale: string) {
  return { ...theme, plugin_sections: await renderPluginSections(ctx, theme.sections as { id: string; type: string; settings?: Record<string, unknown> }[] | null, locale) };
}

/** The payment provider's origins plus those of plugin scripts (loaded only after consent). */
async function cspFor(ctx: Ctx, pc: Awaited<ReturnType<typeof activeProvider>>) {
  const base = pc?.provider.cspSources?.(pc.pctx) ?? {};
  const list = (await storefrontExtensions(ctx)).scripts;
  if (!list.length) return base;
  const scripts = list.map((s) => new URL(s.src).origin);
  // Where analytics scripts send their beacons (plugin API 1.7).
  const sends = list.flatMap((s) => s.connect);
  return {
    ...base,
    script: [...new Set([...(base.script ?? []), ...scripts])],
    ...(sends.length ? { connect: [...new Set([...(base.connect ?? []), ...sends])], img: [...new Set([...(base.img ?? []), ...sends])] } : {}),
  };
}

export async function storefrontSettings(ctx: Ctx, opts: { previewThemeId?: string | null; locale?: string | null } = {}) {
  const t = await must<any>(ctx, `SELECT * FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const s = resolveSettings(t.settings);
  const locations = await many<any>(ctx, `SELECT id, name, address, timezone, opening_hours, delivery_windows, is_default, phone, email FROM locations WHERE deleted_at IS NULL ORDER BY is_default DESC, name`);
  // Days each location is closed in the next 60 days (holidays, stocktaking), for the locations section.
  const closed = await many<{ location_id: string; starts_at: string; ends_at: string; reason: string | null }>(
    ctx,
    `SELECT location_id, lower(period) AS starts_at, upper(period) AS ends_at, reason FROM location_blackouts WHERE period && tstzrange(now(), now() + interval '60 days') ORDER BY lower(period) LIMIT 200`,
  );
  for (const l of locations) l.closures = closed.filter((c) => c.location_id === l.id).map((c) => ({ starts_at: new Date(c.starts_at).toISOString(), ends_at: new Date(c.ends_at).toISOString(), reason: c.reason }));
  const pc = s.storefront.payment === 'stripe' ? await activeProvider(ctx) : null;
  const cats = await categories.list(ctx, { limit: 200 });
  return {
    object: 'storefront_settings',
    tenant: { id: t.id, slug: t.slug, name: t.name, currency: t.currency.trim(), locale: t.locale, timezone: t.timezone, branding: t.branding },
    locations,
    categories: cats.data.map((c: any) => ({ ...c, name: categoryName(c, opts.locale), seo: seoText(c.seo, seoOwn(opts.locale ? c.translations?.[opts.locale] : null)) })),
    // The shop's menus as ready links (paths without the language prefix, or other sites' addresses).
    navigation: await resolveNavigation(ctx, s, cats.data, opts.locale),
    // Canonical links, the sitemap and shared links use the shop's own address; the home page's texts.
    seo: { base_url: await storefrontBase(ctx), ...seoText(s.seo, opts.locale ? s.seo.translations?.[opts.locale] : null), image_url: s.seo.image_url ?? (t.branding?.logo_url || null) },
    locales: s.storefront.locales,
    default_locale: s.storefront.default_locale,
    display_prices_including_tax: includesTax(s, opts.locale ?? t.locale),
    // Other currencies prices may be shown in, approximately (FR-I18N-7); the shop's own is charged.
    currencies: {
      base: t.currency.trim(),
      display: s.display_currencies.currencies.filter((c) => c !== t.currency.trim() && (s.display_currencies.rates[c] ?? 0) > 0).map((c) => ({ code: c, rate: s.display_currencies.rates[c]! })),
      updated_at: s.display_currencies.updated_at,
    },
    terms: { text: termsText(s, opts.locale), version: s.terms.version, hash: termsHash(termsText(s, opts.locale)) },
    cancellation_policy: s.cancellation_policy,
    payment: pc ? { provider: pc.provider.id, ...pc.provider.publicConfig(pc.pctx) } : null,
    // The shop's wording of storefront texts in this language (FR-I18N-6).
    strings: await overridesFor(ctx, 'storefront', opts.locale ?? t.locale),
    // Plugins' checkout fields, consent-gated scripts (FR-PLG-5) and home page section types (FR-THM-12).
    extensions: { ...(await storefrontExtensions(ctx, opts.locale)), sections: await pluginSectionSchemas(ctx, opts.locale ?? t.locale) },
    // Booking updates the customer may ask for at checkout and in the account (FR-NOT-4).
    messaging: { sms: !!(await textChannel(ctx, 'sms')), whatsapp: !!(await textChannel(ctx, 'whatsapp')) },
    // Origins the storefront adds to its Content-Security-Policy for this shop (FR-THM-7).
    csp: await cspFor(ctx, pc),
    theme: await withPluginSections(ctx, await withChildTheme(ctx, storefrontTheme(s, opts.previewThemeId, opts.locale)), opts.locale ?? t.locale),
    code: {
      css: s.storefront_code.css,
      header_html: (opts.locale && s.storefront_code.translations?.[opts.locale]?.header_html) || s.storefront_code.header_html,
      footer_html: (opts.locale && s.storefront_code.translations?.[opts.locale]?.footer_html) || s.storefront_code.footer_html,
    },
  };
}

/**
 * Menu items as links in one language. A category, page or product that is gone, hidden or a draft
 * is left out, so a menu never links to a page that is not there.
 */
async function resolveNavigation(ctx: Ctx, s: TenantSettings, cats: any[], locale?: string | null) {
  const items = [...s.navigation.header, ...s.navigation.footer];
  const pages = items.some((i) => i.kind === 'page') ? await publishedPages(ctx, locale) : [];
  const productIds = items.filter((i) => i.kind === 'product').map((i) => i.target);
  const products = productIds.length ? await many<any>(ctx, `SELECT id, slug, name, translations FROM products WHERE id = ANY($1) AND deleted_at IS NULL AND visibility = 'public'`, [productIds]) : [];
  const link = (it: NavItem): { label: string; href: string; external: boolean } | null => {
    const label = (fallback: string) => (locale && it.translations?.[locale]?.trim()) || it.label?.trim() || fallback;
    switch (it.kind) {
      case 'home':
        return { label: label(''), href: '/', external: false };
      case 'search':
        return { label: label(''), href: '/search', external: false };
      case 'url':
        return it.target ? { label: label(it.target), href: it.target, external: /^https?:\/\//i.test(it.target) } : null;
      case 'category': {
        const c = cats.find((x) => x.id === it.target);
        return c ? { label: label(categoryName(c, locale)), href: `/c/${c.slug}`, external: false } : null;
      }
      case 'page': {
        const p = pages.find((x) => x.id === it.target);
        return p ? { label: label(p.title), href: `/pages/${p.slug}`, external: false } : null;
      }
      case 'product': {
        const p = products.find((x) => x.id === it.target);
        return p ? { label: label(translate(p, locale ?? undefined).name), href: `/p/${p.slug}`, external: false } : null;
      }
    }
  };
  // One link per address: themes key their menus by it.
  const resolve = (list: NavItem[]) => {
    const seen = new Set<string>();
    return list.map(link).filter((x): x is NonNullable<typeof x> => !!x && !!x.label && !seen.has(x.href) && !!seen.add(x.href));
  };
  return { header: resolve(s.navigation.header), footer: resolve(s.navigation.footer) };
}

/** With or without tax in this storefront language (FR-I18N-7): the language's own rule, else the shop's. */
export function includesTax(s: TenantSettings, locale?: string | null) {
  const own = locale ? s.tax_display?.[locale] : undefined;
  return own ? own === 'incl' : s.display_prices_including_tax;
}

/**
 * How catalogue prices are shown in one language: with tax at each product's rate, or as entered; and
 * in the visitor's currency when the shop offers it (the descriptions; amounts stay in the shop's).
 */
async function priceDisplay(ctx: Ctx, locale: string, displayCurrency?: string | null) {
  const t = await must<any>(ctx, `SELECT currency, settings FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const s = resolveSettings(t.settings);
  const incl = includesTax(s, locale);
  const profileOf = await taxProfileAt(ctx, null);
  const cache = new Map<string, number>();
  const rate = displayCurrency && displayCurrency !== t.currency.trim() && s.display_currencies.currencies.includes(displayCurrency) ? s.display_currencies.rates[displayCurrency] : undefined;
  return {
    incl,
    rateOf: async (profileId: string | null) => (incl ? taxRateFor(ctx, profileOf(profileId), cache) : 0),
    shown: rate ? { code: displayCurrency!, rate } : null,
  };
}

/** A price structure with tax on every amount it names (tiers are shares, so they follow). */
function withTax<T extends { amount: number; price_table?: { periods: number; amount: number }[]; extra_per_period?: number }>(s: T, bp: number): T {
  if (!bp) return s;
  const g = (n: number) => Math.round((n * (10000 + bp)) / 10000);
  return { ...s, amount: g(s.amount), price_table: s.price_table?.map((r) => ({ ...r, amount: g(r.amount) })), extra_per_period: s.extra_per_period ? g(s.extra_per_period) : s.extra_per_period };
}

function publicVariant(v: any, currency: string, locale: string, tax: { incl: boolean; bp: number } = { incl: false, bp: 0 }, shown: { code: string; rate: number } | null = null) {
  const fmt = (n: number) => (shown ? `≈ ${formatMoney(Math.round(n * shown.rate), shown.code, locale)}` : formatMoney(n, currency, locale));
  const raw = toEngineStructure(v.price_structure ? { ...v.price_structure, amount: v.price_structure.amount.amount ?? v.price_structure.amount } : null);
  const structure = raw ? withTax(raw, tax.bp) : null;
  return {
    id: v.id,
    name: v.translations?.[locale]?.name?.trim() || v.name,
    options: v.options,
    tracking: v.tracking,
    price: structure
      ? { kind: structure.kind, period_unit: structure.period_unit, amount: money(structure.amount, currency), includes_tax: tax.incl, description: describeStructure(structure, fmt, locale), from: fromPrice(structure, currency) }
      : null,
    deposit_amount: v.deposit_amount,
  };
}

/** The price of the shortest rental: one period, or a price table's first row (for "from" prices and structured data). */
function fromPrice(s: { kind: string; amount: number; price_table?: { periods: number; amount: number }[] }, currency: string) {
  const first = s.kind === 'table' ? [...(s.price_table ?? [])].sort((a, b) => a.periods - b.periods)[0] : null;
  return first ? { amount: money(first.amount, currency), periods: first.periods } : { amount: money(s.amount, currency), periods: 1 };
}

/** Uploaded gallery first; older products may still carry image URLs in seo.images. */
function publicImages(p: any, name: string, locale: string) {
  if (p.images?.length) {
    return p.images.map((i: any) => ({ url: i.url, url_sm: i.url_sm, width: i.width, height: i.height, alt: i.alt?.[locale] ?? i.alt?.en ?? Object.values(i.alt ?? {})[0] ?? name }));
  }
  return p.seo?.images ?? [];
}

function translate(p: any, locale?: string) {
  const tr = locale ? p.translations?.[locale] : null;
  // A language added later may have empty texts: those fall back to the product's own.
  return { name: tr?.name?.trim() || p.name, description: tr?.description?.trim() ? tr.description : p.description, seo: seoText(p.seo, seoOwn(tr)) };
}

/** A product for the storefront; `detail` (its own page) adds what goes with it and each bundle option's availability. */
async function publicProduct(ctx: Ctx, p: any, opts: { locale?: string; from?: Date; to?: Date; locationId?: string; detail?: boolean; displayCurrency?: string | null }) {
  const t = await must<any>(ctx, `SELECT currency, locale FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const currency = t.currency.trim();
  const locale = opts.locale ?? t.locale;
  const show = await priceDisplay(ctx, locale, opts.displayCurrency);
  const tax = { incl: show.incl, bp: await show.rateOf(p.tax_profile_id ?? null) };
  const variants = p.variants.map((v: any) => publicVariant(v, currency, locale, tax, show.shown));
  if (opts.from && opts.to) {
    const loc = opts.locationId ?? (await one(ctx, `SELECT id FROM locations WHERE deleted_at IS NULL ORDER BY is_default DESC LIMIT 1`))?.id;
    for (const v of variants) {
      const r = await availability.check(ctx, { variantId: v.id, locationId: loc, from: opts.from, to: opts.to });
      v.available = r.available;
      // On its own page, a variant gone at this location names the other locations that have it free.
      if (opts.detail && r.available === 0) {
        const all = await availability.checkAcrossLocations(ctx, { variantId: v.id, from: opts.from, to: opts.to });
        v.elsewhere = all.filter((x) => x.location_id !== loc && (x.available === null || x.available > 0)).map((x) => ({ location_id: x.location_id, name: x.location_name, available: x.available }));
      }
    }
  }
  const tr = translate(p, opts.locale);
  return {
    id: p.id, object: 'product', type: p.type, slug: p.slug, name: tr.name, description: richTextPlain(tr.description), description_html: richTextHtml(tr.description), tags: p.tags, category_ids: p.category_ids,
    fields: await visibleFields(ctx, 'product', p.custom_fields, 'storefront', locale),
    badges: await productBadges(ctx, p.tags, locale),
    deposit_amount: money(p.deposit_amount, currency), min_duration_min: p.min_duration_min, max_duration_min: p.max_duration_min, min_notice_min: p.min_notice_min,
    increment_min: p.increment_min, images: publicImages(p, tr.name, opts.locale ?? locale), seo: tr.seo, updated_at: p.updated_at, variants, bundle: p.bundle ? await publicBundle(ctx, p.bundle, opts) : null,
    ...(opts.detail ? await publicRelations(ctx, p.id, currency, opts.locale ?? locale, opts.displayCurrency) : {}),
  };
}

/**
 * Accessories offered with the product, and products that go with it (FR-CAT-7): staff's related ones
 * first, then those often rented with it. Public products only.
 */
async function publicRelations(ctx: Ctx, productId: string, currency: string, locale: string, displayCurrency?: string | null) {
  const r = (await relationsOf(ctx, [productId], { publicOnly: true })).get(productId)!;
  const ids = [...new Set([...r.accessory, ...r.related, ...r.often_rented_with].map((x) => x.id))];
  if (!ids.length) return { accessories: [], related: [] };
  const full = (await listProducts(ctx, { filters: { id: { eq: ids } }, limit: 50 })).data;
  const show = await priceDisplay(ctx, locale, displayCurrency);
  const bps = new Map<string, number>();
  for (const p of full) bps.set(p.id, await show.rateOf(p.tax_profile_id ?? null));
  const card = (id: string) => {
    const p = full.find((x: any) => x.id === id);
    if (!p) return null;
    const tr = translate(p, locale);
    const price = p.variants[0] ? publicVariant(p.variants[0], currency, locale, { incl: show.incl, bp: bps.get(p.id) ?? 0 }, show.shown).price : null;
    return { id: p.id, name: tr.name, slug: p.slug, type: p.type, variant_id: p.variants[0]?.id ?? null, price, image: publicImages(p, tr.name, locale)[0] ?? null };
  };
  const accessories = r.accessory.map((x) => card(x.id)).filter(Boolean);
  const seen = new Set(r.accessory.map((x) => x.id));
  const related = [...r.related, ...r.often_rented_with].filter((x) => !seen.has(x.id) && (seen.add(x.id), true)).map((x) => card(x.id)).filter(Boolean).slice(0, 6);
  return { accessories, related };
}

/** A bundle for the storefront: what always comes with it, and each slot with its options (FR-CAT-6). */
async function publicBundle(ctx: Ctx, b: any, opts: { from?: Date; to?: Date; locationId?: string; detail?: boolean }) {
  const comps = b.components as { variant_id: string; quantity: number; name: string; slot_name: string | null }[];
  const loc = opts.detail && opts.from && opts.to ? (opts.locationId ?? (await one(ctx, `SELECT id FROM locations WHERE deleted_at IS NULL ORDER BY is_default DESC LIMIT 1`))?.id) : null;
  const slots: { name: string; options: { variant_id: string; name: string; quantity: number; available: number | null }[] }[] = [];
  for (const c of comps.filter((x) => x.slot_name)) {
    let slot = slots.find((s) => s.name === c.slot_name);
    if (!slot) slots.push((slot = { name: c.slot_name!, options: [] }));
    const available = loc ? (await availability.check(ctx, { variantId: c.variant_id, locationId: loc, from: opts.from!, to: opts.to! })).available : null;
    slot.options.push({ variant_id: c.variant_id, name: c.name, quantity: c.quantity, available: available === null ? null : Math.floor(available / c.quantity) });
  }
  return { components: comps.filter((c) => !c.slot_name).map((c) => ({ name: c.name, quantity: c.quantity })), slots };
}

const SORTS: Record<string, string | undefined> = { relevance: undefined, name: 'name', newest: '-created_at' };

/**
 * Public catalogue. `q` searches names and descriptions (prefix matches first unless `sort` is set);
 * `available` keeps only products with a free unit for `from`–`to`.
 */
export { cleanCss, cleanHtml, getStorefrontCode, saveStorefrontCode, type StorefrontCode } from './code.ts';
export { sitemap } from './sitemap.ts';
export { sendContactMessage, type ContactInput } from './contact.ts';
export { listPages, getPage, createPage, updatePage, deletePage, updatePageSections, updatePageContent, publicPage, storefrontPage, publishedPages, pageToApi, RESERVED_PAGE_SLUGS, type PageInput } from './pages.ts';

/**
 * Search through a search plugin (FR-PLG-1) when the shop has one: its ids, best first, limited to
 * public products. Null means OpenRent's own search runs (no plugin, no query, or the plugin failed).
 */
async function pluginSearch(ctx: Ctx, q: { q?: string; locale?: string; limit?: number; cursor?: string }, categoryId?: string) {
  const text = q.q?.trim();
  if (!text || q.cursor) return null;
  const sp = await enabledProvider(ctx, ctx.plugins.searchProvider());
  if (!sp) return null;
  let ids: string[];
  try {
    ids = (await sp.provider.search(sp.pctx, { q: text, locale: q.locale ?? null, limit: Math.min(q.limit ?? 48, 100) })).filter((id) => typeof id === 'string').slice(0, 100);
  } catch (err) {
    ctx.logger.warn({ err, plugin: sp.pluginId }, 'search plugin failed; using built-in search');
    return null;
  }
  if (!ids.length) return { data: [], has_more: false, next_cursor: null };
  const found = await listProducts(ctx, { limit: 100, filters: { visibility: { eq: ['public'] }, id: { eq: ids } }, categoryId });
  const rank = new Map(ids.map((id, i) => [id, i]));
  return { data: found.data.sort((a: any, b: any) => rank.get(a.id)! - rank.get(b.id)!), has_more: false, next_cursor: null };
}

export async function catalogProducts(ctx: Ctx, q: { category?: string; q?: string; from?: string; to?: string; location_id?: string; locale?: string; limit?: number; cursor?: string; sort?: string; available?: boolean; display_currency?: string | null }) {
  let categoryId: string | undefined;
  if (q.category) {
    const c = await one(ctx, `SELECT id FROM categories WHERE (slug = $1 OR id = $1) AND deleted_at IS NULL`, [q.category]);
    if (!c) return { data: [], has_more: false, next_cursor: null };
    categoryId = c.id;
  }
  const page = (await pluginSearch(ctx, q, categoryId)) ?? (await listProducts(ctx, { limit: q.limit ?? 48, cursor: q.cursor, q: q.q?.trim() || undefined, sort: SORTS[q.sort ?? 'relevance'], filters: { visibility: { eq: ['public'] } }, categoryId }));
  const from = q.from ? new Date(q.from) : undefined;
  const to = q.to ? new Date(q.to) : undefined;
  const data = [];
  for (const p of page.data) {
    const pp = await publicProduct(ctx, p, { locale: q.locale, from, to, locationId: q.location_id, displayCurrency: q.display_currency });
    // Untracked variants (available = null) are always free.
    if (q.available && from && to && !pp.variants.some((v: any) => v.available === null || v.available === undefined || v.available > 0)) continue;
    data.push(pp);
  }
  return { ...page, data };
}

export async function catalogProduct(ctx: Ctx, slug: string, q: { from?: string; to?: string; location_id?: string; locale?: string; display_currency?: string | null }) {
  const p = await getProduct(ctx, slug);
  if (p.visibility !== 'public') throw new AppError('not_found', 404, msg('error.product_not_found'));
  return publicProduct(ctx, p, { locale: q.locale, from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined, locationId: q.location_id, detail: true, displayCurrency: q.display_currency });
}

/** Only public products may be booked through the storefront. */
async function assertPublicVariants(ctx: Ctx, lines: { variant_id: string }[]) {
  for (const l of lines) {
    const v = await one(ctx, `SELECT p.visibility FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1 AND v.deleted_at IS NULL AND p.deleted_at IS NULL`, [l.variant_id]);
    if (!v || v.visibility !== 'public') throw invalid(msg('error.a_product_in_the_cart_is_not'), [{ field: 'lines', code: 'not_public', message: msg('error.field.remove_this_product') }]);
  }
}

// ---------------------------------------------------------------------------
// Checkout sessions (FR-SF-1, FR-SF-3): server-created and short-lived
// ---------------------------------------------------------------------------

export interface CheckoutLine {
  variant_id: string;
  quantity: number;
  /** Choice bundles (FR-CAT-6): the option picked per slot. */
  picks?: Record<string, string> | null;
}

/** A cart line as stored: picks only as a small map of slot name to variant id. */
function cartLine(l: CheckoutLine): CheckoutLine {
  const picks = l.picks && typeof l.picks === 'object' ? Object.fromEntries(Object.entries(l.picks).filter(([k, v]) => typeof k === 'string' && typeof v === 'string').slice(0, 10)) : null;
  return { variant_id: l.variant_id, quantity: l.quantity, ...(picks && Object.keys(picks).length ? { picks } : {}) };
}

async function sessionRow(ctx: Ctx, id: string) {
  const s = await must<any>(ctx, `SELECT * FROM checkout_sessions WHERE id = $1`, [id], 'checkout_session', id);
  if (s.status === 'open' && new Date(s.expires_at) < ctx.now) {
    await exec(ctx, `UPDATE checkout_sessions SET status = 'expired' WHERE id = $1`, [id]);
    s.status = 'expired';
  }
  return s;
}

/** Cart lines with their product and variant names in the visitor's language, and the product's address. */
async function namedLines(ctx: Ctx, lines: CheckoutLine[], locale?: string | null) {
  if (!lines.length) return lines;
  const rows = await many<any>(
    ctx,
    `SELECT v.id, v.name AS variant_name, v.translations AS variant_tr, p.name AS product_name, p.slug, p.translations AS product_tr
       FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ANY($1)`,
    [lines.map((l) => l.variant_id)],
  );
  const by = new Map(rows.map((r) => [r.id, r]));
  return lines.map((l) => {
    const r = by.get(l.variant_id);
    if (!r) return l;
    const pick = (tr: any, base: string) => (locale && tr?.[locale]?.name?.trim()) || base;
    return { ...l, product_name: pick(r.product_tr, r.product_name), product_slug: r.slug, variant_name: pick(r.variant_tr, r.variant_name) };
  });
}

export async function sessionToApi(ctx: Ctx, s: any, locale?: string | null) {
  let quote = null;
  const availabilityCheck: any[] = [];
  let quoteError: unknown = null;
  if (s.starts_at && s.ends_at && s.lines.length) {
    try {
      const q = await priceQuote(ctx, { location_id: s.location_id, starts_at: s.starts_at, ends_at: s.ends_at, lines: s.lines.map((l: any) => ({ variant_id: l.variant_id, quantity: l.quantity, picks: l.picks ?? null })), coupon_codes: s.coupon_codes, locale, options: s.options ?? {} });
      quote = breakdownToApi(q.breakdown);
      for (const l of s.lines) {
        const r = await availability.check(ctx, { variantId: l.variant_id, locationId: s.location_id, from: new Date(s.starts_at), to: new Date(s.ends_at) });
        const rules = await availability.assertBookable(ctx, { variantId: l.variant_id, locationId: s.location_id, startsAt: new Date(s.starts_at), endsAt: new Date(s.ends_at), strict: true });
        availabilityCheck.push({ variant_id: l.variant_id, requested: l.quantity, available: r.available, ok: (r.available === null || r.available >= l.quantity) && rules.length === 0, problems: rules });
      }
    } catch (err: any) {
      quoteError = { code: err.code ?? 'error', message: err.message };
    }
  }
  return {
    id: s.id, object: 'checkout_session', status: s.status, location_id: s.location_id, starts_at: s.starts_at, ends_at: s.ends_at, lines: await namedLines(ctx, s.lines, locale),
    customer: s.customer, coupon_codes: s.coupon_codes, options: { fees: s.options?.fees ?? [], postcode: s.options?.postcode ?? null, address: s.options?.address ?? null }, order_id: s.order_id, expires_at: s.expires_at,
    quote, availability: availabilityCheck, quote_error: quoteError,
  };
}

export async function createCheckoutSession(ctx: Ctx, input: { location_id?: string; starts_at?: string; ends_at?: string; lines?: CheckoutLine[]; coupon_codes?: string[] }) {
  const loc = input.location_id ? await must(ctx, `SELECT id FROM locations WHERE id = $1 AND deleted_at IS NULL`, [input.location_id], 'location') : await must(ctx, `SELECT id FROM locations WHERE deleted_at IS NULL ORDER BY is_default DESC LIMIT 1`, [], 'location');
  const lines = (input.lines ?? []).filter((l) => l.quantity > 0).map(cartLine);
  await assertPublicVariants(ctx, lines);
  const row = (
    await many(ctx, `INSERT INTO checkout_sessions (id, tenant_id, location_id, starts_at, ends_at, lines, coupon_codes, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [
      newId('cs'), ctx.tenantId, loc.id, input.starts_at ?? null, input.ends_at ?? null, json(lines), input.coupon_codes ?? [], addMinutes(ctx.now, 180),
    ])
  )[0];
  return sessionToApi(ctx, row);
}

export async function getCheckoutSession(ctx: Ctx, id: string, locale?: string | null) {
  return sessionToApi(ctx, await sessionRow(ctx, id), locale);
}

export async function updateCheckoutSession(
  ctx: Ctx,
  id: string,
  patch: { location_id?: string; starts_at?: string | null; ends_at?: string | null; lines?: CheckoutLine[]; coupon_codes?: string[]; customer?: Record<string, unknown>; options?: QuoteOptions },
) {
  const s = await sessionRow(ctx, id);
  if (s.status !== 'open') throw new AppError('checkout_closed', 409, msg('error.this_checkout_is', { status: s.status }));
  const lines = patch.lines ? patch.lines.filter((l) => l.quantity > 0).map(cartLine) : s.lines;
  if (patch.lines) await assertPublicVariants(ctx, lines);
  const row = (
    await many(
      ctx,
      `UPDATE checkout_sessions SET location_id = coalesce($2, location_id), starts_at = CASE WHEN $3::boolean THEN $4::timestamptz ELSE starts_at END,
         ends_at = CASE WHEN $5::boolean THEN $6::timestamptz ELSE ends_at END, lines = $7, coupon_codes = coalesce($8, coupon_codes), customer = customer || $9,
         expires_at = $10, options = coalesce($11, options) WHERE id = $1 RETURNING *`,
      [
        id, patch.location_id ?? null, patch.starts_at !== undefined, patch.starts_at ?? null, patch.ends_at !== undefined, patch.ends_at ?? null, json(lines),
        patch.coupon_codes ?? null, json(patch.customer ?? {}), addMinutes(ctx.now, 180), patch.options ? json(await checkedOptions(ctx, patch.options)) : null,
      ],
    )
  )[0];
  return sessionToApi(ctx, row);
}

/**
 * A delivery fee chosen at checkout books the delivery and the collection (FR-OR-12): two-hour windows
 * before pickup and after the return, at the address the customer gave. Staff adjust them on the day board.
 */
type Windows = { delivery: { start: Date; end: Date }; collection: { start: Date; end: Date } };

async function bookChosenDelivery(ctx: Ctx, order: any, options: QuoteOptions, windows: Windows | null) {
  const delivery = (await activeFeeRules(ctx, null, ['delivery'])).find((f) => (options.fees ?? []).includes(f.id));
  if (!delivery) return;
  const address = { line1: options.address ?? '', postal_code: options.postcode ?? '' };
  const start = new Date(order.starts_at);
  const end = new Date(order.ends_at);
  // The windows the customer chose, else two hours before pickup and after the return.
  const d = windows?.delivery ?? { start: addMinutes(start, -120), end: start };
  const c = windows?.collection ?? { start: end, end: addMinutes(end, 120) };
  await scheduleDelivery(ctx, order.id, { kind: 'delivery', window_start: d.start.toISOString(), window_end: d.end.toISOString(), address });
  await scheduleDelivery(ctx, order.id, { kind: 'collection', window_start: c.start.toISOString(), window_end: c.end.toISOString(), address });
}

const WEEKDAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * The delivery and collection windows chosen at checkout (`extra['delivery.window']` and
 * `extra['collection.window']`, "HH:MM-HH:MM" on the pickup and return days in the location's time).
 * Only for a delivery, and only when the location offers windows; then both are needed.
 */
async function chosenWindows(ctx: Ctx, s: any, extra: Record<string, unknown>): Promise<Windows | null> {
  const delivery = (await activeFeeRules(ctx, null, ['delivery'])).find((f) => (s.options?.fees ?? []).includes(f.id));
  if (!delivery) return null;
  const loc = await must<any>(ctx, `SELECT timezone, delivery_windows FROM locations WHERE id = $1`, [s.location_id], 'location');
  const offered = (loc.delivery_windows ?? {}) as Record<string, [string, string][]>;
  if (!Object.values(offered).some((l) => l?.length)) return null;
  const errors: FieldError[] = [];
  const pick = (kind: 'delivery' | 'collection', at: Date) => {
    const date = localDate(at, loc.timezone);
    const { year, month, day } = parseLocalDate(date);
    const slots = offered[WEEKDAY[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!] ?? [];
    const field = `extra.${kind}.window`;
    if (!slots.length) return void errors.push({ field, code: 'no_window', message: tr(`checkout.${kind}_no_window`) });
    const raw = String(extra[`${kind}.window`] ?? '');
    const slot = slots.find(([a, b]) => `${a}-${b}` === raw);
    if (!slot) return void errors.push({ field, code: 'required', message: tr(`checkout.${kind}_window_required`) });
    const time = (hm: string) => zonedTimeToUtc(year, month, day, Number(hm.slice(0, 2)), Number(hm.slice(3, 5)), loc.timezone);
    return { start: time(slot[0]), end: time(slot[1]) };
  };
  const d = pick('delivery', new Date(s.starts_at));
  const c = pick('collection', new Date(s.ends_at));
  if (errors.length || !d || !c) throw invalid(tr('checkout.window_invalid'), errors);
  return { delivery: d, collection: c };
}

/** Only optional fees the shop offers may be chosen; the postcode is kept short and trimmed. */
async function checkedOptions(ctx: Ctx, o: QuoteOptions): Promise<QuoteOptions> {
  const offered = new Set((await activeFeeRules(ctx)).filter((f) => f.mode === 'optional').map((f) => f.id));
  const fees = [...new Set(o.fees ?? [])].filter((id) => offered.has(id));
  const postcode = typeof o.postcode === 'string' && o.postcode.trim() ? o.postcode.trim().slice(0, 20) : null;
  const address = typeof o.address === 'string' && o.address.trim() ? o.address.trim().slice(0, 300) : null;
  return { fees, postcode, address };
}

export interface CompleteInput {
  customer: CheckoutCustomer;
  terms_accepted: boolean;
  terms_hash: string;
  notes?: string;
  /** Values of plugins' checkout fields, by `<plugin id>.<key>` (FR-PLG-5). */
  extra?: Record<string, unknown>;
  /**
   * Widget checkout (FR-SF-2): the embedding page to come back to after paying on the provider's page.
   * Its origin must be one of settings.widget_origins (or the storefront), so it cannot redirect anywhere.
   */
  return_url?: string;
}

/** A return URL on an allowed site, or a 422 on `return_url`. */
async function checkedReturnUrl(ctx: Ctx, settings: TenantSettings, url: string) {
  let origin: string | null = null;
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') origin = u.origin;
  } catch {
    origin = null;
  }
  const allowed = new Set([...settings.widget_origins.map((o) => o.replace(/\/$/, '').toLowerCase()), new URL(await storefrontBase(ctx)).origin]);
  if (!origin || !allowed.has(origin.toLowerCase())) throw invalid(tr('checkout.return_url_not_allowed'), [{ field: 'return_url', code: 'not_allowed', message: tr('checkout.return_url_not_allowed') }]);
  return url;
}

/** Account checks of a booking on account appear next to the checkout's account fields. */
const B2B_FIELDS: Record<string, string> = { po_number: 'extra.b2b.po_number', customer_id: 'extra.b2b.pay_on_account' };
function asCheckoutErrors(err: unknown): never {
  if (err instanceof AppError && err.code === 'validation_error' && err.errors) {
    throw invalid(err.message, err.errors.map((e) => ({ ...e, field: B2B_FIELDS[e.field] ?? e.field })));
  }
  throw err;
}

/**
 * Turns a checkout into an order. With online payment the order holds stock as a short quote
 * until the provider confirms payment; without it the order is reserved immediately (pay at pickup).
 * A signed-in customer on account (`accountEmail`) may book on account: reserved at once, paid on the invoice.
 */
export async function completeCheckout(ctx: Ctx, id: string, input: CompleteInput, accountEmail: string | null = null) {
  const s = await sessionRow(ctx, id);
  if (s.status !== 'open') throw new AppError('checkout_closed', 409, msg('error.this_checkout_is', { status: s.status }));
  if (!s.starts_at || !s.ends_at) throw invalid(msg('error.choose_rental_dates'), [{ field: 'starts_at', code: 'required', message: msg('error.field.choose_dates') }]);
  if (!s.lines.length) throw invalid(tr('checkout.cart_empty'), [{ field: 'lines', code: 'required', message: tr('checkout.add_product') }]);
  if (!input.customer?.name || !input.customer?.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.customer.email)) {
    throw invalid(tr('checkout.contact_required'), [{ field: 'customer.email', code: 'invalid', message: tr('checkout.invalid_email') }]);
  }
  const t = await must<any>(ctx, `SELECT settings FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const settings = resolveSettings(t.settings);
  // Each storefront language shows its own terms text; accepting any of them counts.
  const accepted = new Set([settings.terms.text, ...settings.storefront.locales.map((l) => termsText(settings, l))].map(termsHash));
  if (!input.terms_accepted || !accepted.has(input.terms_hash)) {
    throw invalid(tr('checkout.terms_required'), [{ field: 'terms_accepted', code: 'terms_required', message: tr('checkout.accept_terms') }]);
  }
  // The account fields (FR-CUS-7) are the runtime's own; the rest belong to plugins.
  const onAccount = input.extra?.['b2b.pay_on_account'] === true;
  const poRaw = input.extra?.['b2b.po_number'];
  const po = typeof poRaw === 'string' && poRaw.trim() ? poRaw.trim().slice(0, 100) : null;
  // Text message updates asked for at checkout (FR-NOT-4), also the runtime's own fields.
  const wants = {
    sms_opt_in: input.customer.sms_opt_in === true || input.extra?.['messages.sms'] === true,
    whatsapp_opt_in: input.customer.whatsapp_opt_in === true || input.extra?.['messages.whatsapp'] === true,
  };
  const extra = await checkCheckoutExtra(ctx, Object.fromEntries(Object.entries(input.extra ?? {}).filter(([k]) => !k.startsWith('b2b.') && !k.startsWith('messages.') && !k.startsWith('billing.') && !k.startsWith('delivery.') && !k.startsWith('collection.'))));
  const account = onAccount && accountEmail && accountEmail.toLowerCase() === input.customer.email.trim().toLowerCase() ? await accountTermsFor(ctx, accountEmail) : null;
  if (onAccount && !account) throw invalid(tr('checkout.account_sign_in'), [{ field: 'extra.b2b.pay_on_account', code: 'not_on_account', message: tr('checkout.account_sign_in') }]);
  const billing = await checkoutBilling(ctx, input, accountEmail);
  const windows = await chosenWindows(ctx, s, input.extra ?? {});
  // A plugin may still refuse the booking (HookVeto), e.g. a delivery postcode it does not serve.
  await ctx.plugins.runHook('before', 'checkout.complete', { session_id: id, customer: input.customer, extra: input.extra ?? {} }, hookContext(ctx));
  for (const l of s.lines) {
    const errs = await availability.assertBookable(ctx, { variantId: l.variant_id, locationId: s.location_id, startsAt: new Date(s.starts_at), endsAt: new Date(s.ends_at), strict: true });
    if (errs.length) throw invalid(msg('error.these_dates_cannot_be_booked'), errs);
  }
  // Booking on account: the account's own record, with what was typed filling its empty fields.
  if (account) await fillFromCheckout(ctx, await must<any>(ctx, `SELECT * FROM customers WHERE id = $1`, [account.customer_id], 'customer'), { ...input.customer, ...wants });
  const customer = account ? { id: account.customer_id, flags: (await one<any>(ctx, `SELECT flags FROM customers WHERE id = $1`, [account.customer_id]))?.flags } : await findOrCreateByEmail(ctx, { ...input.customer, ...wants });
  if (customer.flags?.blocked) throw new AppError('customer_blocked', 403, msg('error.online_booking_is_not_available_for_this'));
  const order = await createOrder(ctx, {
    customer_id: customer.id,
    location_id: s.location_id,
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    lines: s.lines.map((l: CheckoutLine) => ({ variant_id: l.variant_id, quantity: l.quantity, picks: l.picks ?? null })),
    coupon_codes: s.coupon_codes,
    options: s.options ?? {},
    notes: input.notes ? { customer: input.notes } : undefined,
    po_number: po,
    billing,
    source: 'storefront',
  });
  const acceptance = { version: settings.terms.version, text_sha256: input.terms_hash, accepted_at: ctx.now.toISOString(), ip: ctx.ip ?? null, user_agent: ctx.userAgent ?? null, name: input.customer.name };
  await exec(ctx, `UPDATE orders SET terms_acceptance = $2, custom_fields = coalesce(custom_fields, '{}'::jsonb) || $3::jsonb WHERE id = $1`, [order.id, json(acceptance), json(extra)]);
  const pc = settings.storefront.payment === 'stripe' ? await activeProvider(ctx) : null;
  const total = order.totals.total.amount;
  let payment = null;
  let final;
  if (account) {
    final = await runAction(ctx, order.id, 'reserve', {}).catch(asCheckoutErrors);
  } else if (pc && total > 0) {
    // Hold stock while the customer pays; the quote expires if payment never arrives.
    final = await runAction(ctx, order.id, 'send_quote', { ttl_hours: settings.storefront_hold_minutes / 60, notify: false, hold_stock: true });
    // A down payment is a payment request for part of the total; the balance is requested before pickup.
    const upfront = upfrontAmount(settings.payment_terms, total);
    if (input.return_url) {
      // The widget pays on the provider's page and comes back to the embedding site; without a hosted
      // page the customer pays on the shop's order page. Only listed sites may be returned to.
      const returnUrl = await checkedReturnUrl(ctx, settings, input.return_url);
      const request = await createPaymentRequest(ctx, order.id, { amount: upfront, kind: 'upfront', notify: false, returnUrl });
      payment = { object: 'payment_redirect', url: request.url ?? `${await storefrontBase(ctx)}/order/${final.public_token}`, request_id: request.id };
    } else {
      const request = upfront < total ? await createPaymentRequest(ctx, order.id, { amount: upfront, kind: 'upfront', notify: false }) : null;
      payment = await createPaymentIntent(ctx, order.id, { purpose: 'rental', amount: upfront, paymentRequestId: request?.id ?? null });
    }
  } else {
    final = await runAction(ctx, order.id, 'reserve', {});
  }
  await bookChosenDelivery(ctx, final, s.options ?? {}, windows);
  await exec(ctx, `UPDATE checkout_sessions SET status = 'completed', order_id = $2, customer = $3 WHERE id = $1`, [id, order.id, json(input.customer)]);
  return { object: 'checkout_result', order: { id: final.id, number: final.number, status: final.status, token: final.public_token, totals: final.totals }, payment };
}

/**
 * The billing details for a storefront order (ADR 0012): billing details the signed-in customer saved
 * (`extra['billing.profile_id']`), else the company, tax number and address typed at checkout, saved
 * for next time when asked (`extra['billing.save']`). None of them: the customer's own apply.
 * A VAT number the register says is not valid is refused here, where the customer can fix it; if the
 * register cannot answer, the booking goes ahead with tax.
 */
async function checkoutBilling(ctx: Ctx, input: CompleteInput, accountEmail: string | null): Promise<BillingSnapshot | null> {
  const signedIn = accountEmail && accountEmail.toLowerCase() === input.customer.email.trim().toLowerCase() ? await accountCustomer(ctx, accountEmail).catch(() => null) : null;
  const profileId = input.extra?.['billing.profile_id'];
  if (typeof profileId === 'string' && profileId) {
    const p = signedIn ? await getProfile(ctx, signedIn.id, profileId).catch(() => null) : null;
    if (!p) throw invalid(tr('checkout.billing_profile_unknown'), [{ field: 'extra.billing.profile_id', code: 'not_found', message: tr('checkout.billing_profile_unknown') }]);
    return snapshotOf(p);
  }
  const c = input.customer;
  const company = c.company_name?.trim() || null;
  const taxId = c.tax_id?.trim() || null;
  const address = cleanAddress(c.billing_address);
  if (!company && !taxId && !address.line1) return null;
  const check = taxId ? await checkTaxId(ctx, taxId) : null;
  if (check?.status === 'invalid') throw invalid(tr('checkout.tax_id_invalid'), [{ field: 'customer.tax_id', code: 'invalid', message: tr('checkout.tax_id_invalid') }]);
  const billing: BillingSnapshot = { kind: company || taxId ? 'company' : 'private', name: c.name.trim(), company_name: company, tax_id: taxId, tax_id_check: check ?? null, address };
  if (signedIn && input.extra?.['billing.save'] === true) {
    await saveProfile(asCustomerCtx(ctx, signedIn.id), signedIn.id, { kind: billing.kind, name: billing.name, company_name: company, tax_id: taxId, address }).catch((err) => {
      // An address too incomplete to keep still bills this booking.
      ctx.logger.info({ err: String(err?.message ?? err) }, 'billing details from checkout not saved');
    });
  }
  return billing;
}

/**
 * A new cart with the items of one of the customer's bookings, without dates (the customer picks new
 * ones), at the same location. Items the shop no longer offers are left out and named.
 */
export async function bookAgain(ctx: Ctx, email: string, orderId: string) {
  const { order: o } = await ownedOrder(ctx, email, orderId);
  const lines = await many<any>(
    ctx,
    `SELECT l.variant_id, l.quantity, l.description, l.price_snapshot, p.visibility, p.deleted_at AS product_deleted, v.deleted_at AS variant_deleted
       FROM order_lines l LEFT JOIN variants v ON v.id = l.variant_id LEFT JOIN products p ON p.id = v.product_id
      WHERE l.order_id = $1 AND l.parent_line_id IS NULL AND l.type IN ('rental', 'sale') AND l.variant_id IS NOT NULL ORDER BY l.position, l.created_at`,
    [o.id],
  );
  const kept = lines.filter((l) => l.visibility === 'public' && !l.product_deleted && !l.variant_deleted);
  const skipped = lines.filter((l) => !kept.includes(l)).map((l) => String(l.description));
  if (!kept.length) throw new AppError('nothing_to_book', 409, msg('account.book_again_nothing'));
  const cart = await createCheckoutSession(ctx, {
    location_id: o.location_id,
    lines: kept.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity, picks: l.price_snapshot?.picks ?? null })),
  });
  return { object: 'book_again', cart_id: cart.id, skipped };
}

/**
 * Confirms storefront orders whose rental payment succeeded (called from provider webhooks).
 * Runs in a savepoint: if stock is gone the payment stays recorded and staff are alerted,
 * instead of failing the webhook (which the provider would retry forever).
 */
export async function confirmPaidOrder(ctx: Ctx, orderId: string) {
  const o = await one(ctx, `SELECT status, source FROM orders WHERE id = $1`, [orderId]);
  if (!o || !['quote', 'expired'].includes(o.status)) return;
  const sys: Ctx = { ...ctx, actor: { type: 'system', id: null } };
  await ctx.db.query('SAVEPOINT confirm_paid');
  try {
    if (o.status === 'expired') await runAction(sys, orderId, 'reopen', {});
    await runAction(sys, orderId, 'reserve', {});
    await ctx.db.query('RELEASE SAVEPOINT confirm_paid');
  } catch (err: any) {
    await ctx.db.query('ROLLBACK TO SAVEPOINT confirm_paid');
    ctx.logger.warn({ err, orderId }, 'payment received but the order could not be reserved');
    await notifyStaff(ctx, orderId, 'staff_payment_failed', { error: msg('payment.error.paid_not_confirmed', { error: String(err?.message ?? err) }, await tenantLocale(ctx)) });
  }
}

/** Damage charges the customer is asked to pay, with the ids of their photos (FR-PAY-6). */
async function customerDamageCharges(ctx: Ctx, orderId: string, currency: string) {
  // What the customer owes: a damage waiver pays the covered part (FR-PAY-8).
  const rows = await many<any>(
    ctx,
    `SELECT id, description, amount - covered_amount AS amount, status FROM damage_charges WHERE order_id = $1 AND status <> 'waived' AND amount - covered_amount > 0 ORDER BY created_at`,
    [orderId],
  );
  const photos = rows.length ? await many<{ id: string; owner_id: string }>(ctx, `SELECT id, owner_id FROM files WHERE owner_type = 'damage_charge' AND owner_id = ANY($1) AND kind = 'photo' ORDER BY created_at`, [rows.map((r) => r.id)]) : [];
  return rows.map((r) => ({ id: r.id, description: r.description, amount: money(r.amount, currency), status: r.status, photo_ids: photos.filter((p) => p.owner_id === r.id).map((p) => p.id) }));
}

/** A photo of a damage charge on the booking behind a public order link. */
export async function damagePhotoForToken(ctx: Ctx, orderId: string, token: string, fileId: string) {
  const o = token && token.length >= 16 ? await one<{ id: string }>(ctx, `SELECT id FROM orders WHERE (id = $1 OR public_token = $1) AND public_token = $2`, [orderId, token]) : null;
  const ok = o ? await one(ctx, `SELECT 1 FROM files f JOIN damage_charges d ON d.id = f.owner_id WHERE f.id = $1 AND f.owner_type = 'damage_charge' AND d.order_id = $2 AND d.status <> 'waived'`, [fileId, o.id]) : null;
  if (!ok) throw new AppError('not_found', 404, msg('error.order_not_found'));
  return fileId;
}

export async function publicOrder(ctx: Ctx, id: string, token: string) {
  const o = await one(ctx, `SELECT * FROM orders WHERE (id = $1 OR public_token = $1) AND public_token = $2`, [id, token]);
  if (!o) throw new AppError('not_found', 404, msg('error.order_not_found'));
  const lines = await many(ctx, `SELECT description, quantity, total FROM order_lines WHERE order_id = $1 AND parent_line_id IS NULL ORDER BY position`, [o.id]);
  const loc = await one(ctx, `SELECT name, address, timezone FROM locations WHERE id = $1`, [o.location_id]);
  const c = o.currency.trim();
  // A closed booking can still be owed when the customer books on account (FR-CUS-7).
  const due = ['cancelled', 'expired'].includes(o.status) ? { amount: 0, request_id: null } : await amountDue(ctx, o.id);
  const pc = due.amount > 0 ? await activeProvider(ctx) : null;
  const request = (await latestRequests(ctx, [o.id])).get(o.id);
  const extension = (await latestExtensions(ctx, [o.id])).get(o.id);
  const docs = await orderDocuments(ctx, [o.id]);
  const files = await customerAttachments(ctx, [o.id]);
  return {
    id: o.id, object: 'order', number: o.number, status: o.status, payment_status: o.payment_status, starts_at: o.starts_at, ends_at: o.ends_at,
    timezone: o.timezone, location: loc, currency: c, lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, total: money(l.total, c) })),
    totals: { total: money(o.totals?.total, c), deposit: money(o.totals?.deposit, c), paid: money(o.totals?.paid, c), balance: money(o.totals?.balance ?? o.totals?.total, c) },
    payment_pending: o.status === 'quote' && !!pc, payable: !!pc, amount_due: money(due.amount, c), payment_request_id: due.request_id, qr_payload: `openrent:order:${o.public_token}`,
    cancellation_request: requestToApi(request), can_request_cancellation: canRequestCancel(ctx, o, request),
    extension_request: extensionToApi(extension), can_request_extension: canRequestExtension(ctx, o, extension),
    documents: docs.map((d) => ({ id: d.id, type: d.type, number: d.number })),
    attachments: files.map(({ order_id: _o, ...a }) => a),
    fields: await visibleFields(ctx, 'order', o.custom_fields, 'portal', currentLocale()),
    damage_charges: await customerDamageCharges(ctx, o.id, c),
  };
}
