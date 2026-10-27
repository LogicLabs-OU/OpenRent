import type { Category, Location, OpeningHours, Product } from '@openrent/theme-sdk';
import { isLocale } from '@openrent/i18n';

/** What a page tells search engines and link previews; the layout puts it in the head. */
export interface PageMeta {
  title?: string | null;
  description?: string | null;
  image?: string | null;
  type?: 'website' | 'product';
  /** Structured data (schema.org) for this page. */
  jsonld?: Record<string, unknown>[];
  noindex?: boolean;
}

export interface ShopSeo {
  base_url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
}

const PRIVATE = /^\/(cart|checkout|order|sign|account|search|_or)(\/|$)/;

/** Carts, checkout, private links, the account and search results: never listed by search engines. */
export function isPrivatePath(pathname: string): boolean {
  const first = pathname.split('/')[1] ?? '';
  const rest = isLocale(first) ? pathname.slice(first.length + 1) || '/' : pathname;
  return PRIVATE.test(rest);
}

/** Structured data inside `<script type="application/ld+json">`: nothing in it can end the script element. */
export function jsonLdScript(data: unknown): string {
  const body = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<script type="application/ld+json">${body}</script>`;
}

/** Up to `max` characters at a word boundary, for descriptions taken from longer text. */
export function shorten(text: string | null | undefined, max = 160): string | null {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

const absolute = (url: string, base: string) => {
  try {
    return new URL(url, `${base}/`).href;
  } catch {
    return url;
  }
};

// UN/CEFACT unit codes, as schema.org prices per unit use them.
const UNIT = { hour: 'HUR', day: 'DAY', week: 'WEE', month: 'MON' } as const;

/** A product as schema.org sees it: the lowest price for the shortest rental, for so many periods where it has them. */
export function productLd(p: Product, url: string, base: string, shopName: string): Record<string, unknown> {
  const from = (v: Product['variants'][number]) => v.price!.from ?? { amount: v.price!.amount, periods: 1 };
  const low = p.variants.filter((v) => v.price && from(v).amount.amount > 0).sort((a, b) => from(a).amount.amount - from(b).amount.amount)[0];
  const known = p.variants.filter((v) => typeof v.available === 'number');
  let offers: Record<string, unknown> | undefined;
  if (low?.price) {
    const f = from(low);
    const price = (f.amount.amount / 100).toFixed(2);
    const currency = f.amount.currency;
    const unit = low.price.kind === 'fixed' ? undefined : UNIT[low.price.period_unit];
    offers = {
      '@type': 'Offer',
      url,
      price,
      priceCurrency: currency,
      businessFunction: 'http://purl.org/goodrelations/v1#LeaseOut',
      priceSpecification: { '@type': 'UnitPriceSpecification', price, priceCurrency: currency, ...(unit ? { unitCode: unit, referenceQuantity: { '@type': 'QuantitativeValue', value: f.periods, unitCode: unit } } : {}) },
      ...(known.length ? { availability: known.some((v) => (v.available ?? 0) > 0) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' } : {}),
      seller: { '@type': 'Organization', name: shopName },
    };
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    url,
    ...(p.description ? { description: shorten(p.description, 5000) } : {}),
    ...(p.images.length ? { image: p.images.slice(0, 5).map((i) => absolute(i.url, base)) } : {}),
    sku: p.slug,
    ...(offers ? { offers } : {}),
  };
}

export function breadcrumbLd(items: { name: string; url: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
  };
}

/** The shop, its search, and each location with its address and opening hours: for the home page. */
export function shopLd(o: { name: string; base: string; home: string; logo?: string | null; locations: Location[] }): Record<string, unknown>[] {
  const org = { '@context': 'https://schema.org', '@type': 'Organization', name: o.name, url: o.base, ...(o.logo ? { logo: absolute(o.logo, o.base) } : {}) };
  const site = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: o.name,
    url: o.home,
    potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${o.home.replace(/\/$/, '')}/search?q={search_term_string}` }, 'query-input': 'required name=search_term_string' },
  };
  const places = o.locations.filter((l) => l.address && Object.values(l.address).some(Boolean)).map((l) => locationLd(l, o.name, o.home));
  return [org, site, ...places];
}

const DAYS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' } as const;

export function openingHoursLd(hours: OpeningHours): Record<string, unknown>[] {
  return (Object.keys(DAYS) as (keyof typeof DAYS)[]).flatMap((d) => (hours[d] ?? []).map(([opens, closes]) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: `https://schema.org/${DAYS[d]}`, opens, closes })));
}

export function locationLd(l: Location, shopName: string, url: string): Record<string, unknown> {
  const a = l.address ?? {};
  const street = [a.line1, a.line2].filter(Boolean).join(', ');
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: l.name === shopName ? shopName : `${shopName} – ${l.name}`,
    url,
    address: { '@type': 'PostalAddress', ...(street ? { streetAddress: street } : {}), ...(a.city ? { addressLocality: a.city } : {}), ...(a.region ? { addressRegion: a.region } : {}), ...(a.postal_code ? { postalCode: a.postal_code } : {}), ...(a.country ? { addressCountry: a.country } : {}) },
    ...(l.phone ? { telephone: l.phone } : {}),
    ...(l.email ? { email: l.email } : {}),
    ...(Object.keys(l.opening_hours ?? {}).length ? { openingHoursSpecification: openingHoursLd(l.opening_hours) } : {}),
  };
}

/** A category page: its title and description, else the category name. */
export function categoryMeta(c: Category, crumbs: { name: string; url: string }[]): PageMeta {
  return { title: c.seo?.title || c.name, description: c.seo?.description ?? null, jsonld: [breadcrumbLd(crumbs)] };
}
