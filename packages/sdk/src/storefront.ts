import type { CalendarDay, Cart, Category, Location, Money, PriceQuote, Product, PublicOrder, Tenant } from '@openrent/theme-sdk/types';
import { createClient, type OpenRentOptions } from './index.ts';
import type { paths } from './types.ts';

export type { CalendarDay, Cart, CartLine, Category, Location, Money, PriceQuote, Product, PublicOrder, Tenant, Variant, VariantPrice } from '@openrent/theme-sdk/types';

/**
 * Typed helpers for a headless shop on the public storefront API (FR-SF-7): catalogue, prices, cart,
 * checkout and the order confirmation. Requests are typed from the OpenAPI document; answers have
 * the same shapes themes get (`@openrent/theme-sdk` types), as storefront answers carry no schema.
 * Use a publishable key (pk_…) or the shop slug; never a secret key in a browser.
 */
export interface StorefrontOptions extends Omit<OpenRentOptions, 'apiKey'> {
  /** pk_live_… or pk_test_…; without one, `tenantSlug` names the shop. */
  publishableKey?: string;
  /** Storefront language for names, texts and server messages. */
  locale?: string;
  /** Show catalogue prices in another currency the shop offers (approximate; orders are charged in the shop's). */
  displayCurrency?: string;
  /** A signed-in customer's session token (from `account.verify`), for booking on account. */
  customerSession?: string;
}

export interface StorefrontSettings {
  object: 'storefront_settings';
  tenant: Tenant;
  locations: Location[];
  categories: Category[];
  locales: string[];
  default_locale: string;
  display_prices_including_tax: boolean;
  currencies: { base: string; display: { code: string; rate: number }[]; updated_at: string | null };
  /** Send `terms.hash` with the checkout: it proves which text the customer accepted. */
  terms: { text: string; version: number; hash: string };
  /** Online payment, with what the browser needs (e.g. Stripe's publishable key). */
  payment: ({ provider: string } & Record<string, unknown>) | null;
  extensions: { checkout_fields: { key: string; type: 'text' | 'checkbox' | 'select'; required: boolean; label: string; help: string | null; options: { value: string; label: string }[] }[] } & Record<string, unknown>;
  /** The shop's address for canonical links and sitemaps, the home page's search engine texts and the picture for shared links. */
  seo: { base_url: string; title: string | null; description: string | null; image_url: string | null };
  [key: string]: unknown;
}

/** Paths for a sitemap (without a language prefix) and when each last changed; `total` counts them all. */
export interface SitemapPage {
  object: 'storefront_sitemap';
  base_url: string;
  default_locale: string;
  locales: string[];
  total: number;
  data: { path: string; updated_at: string | null }[];
}

/** One of the shop's own pages in one language; `sections` are for the live theme. */
export interface StorefrontPage {
  object: 'storefront_page';
  slug: string;
  title: string;
  body_html: string;
  seo: { title: string | null; description: string | null };
  updated_at: string;
  [key: string]: unknown;
}

export interface ProductList {
  data: Product[];
  has_more: boolean;
  next_cursor: string | null;
}

/** A cart as the API keeps it: open for 3 hours after its last change. */
export type CheckoutSession = Cart & { id: string; object: 'checkout_session'; status: 'open' | 'completed' | 'expired'; expires_at: string };

export interface CheckoutResult {
  object: 'checkout_result';
  order: { id: string; number: number; status: string; token: string; totals: { total: Money; deposit: Money } & Record<string, unknown> };
  /** Null when nothing is paid online now; a page to send the customer to; or a card payment to confirm in the browser. */
  payment: null | { object: 'payment_redirect'; url: string; request_id: string } | ({ object: 'payment_intent'; client_secret: string | null } & Record<string, unknown>);
}

type Query<P extends keyof paths, M extends 'get' | 'post' | 'patch'> = paths[P][M] extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never;
type Body<P extends keyof paths, M extends 'post' | 'patch'> = paths[P][M] extends { requestBody?: { content: { 'application/json': infer B } } } ? B : never;

export type ProductQuery = Query<'/api/v1/storefront/catalog/products', 'get'>;
export type QuoteInput = Body<'/api/v1/storefront/price_quote', 'post'>;
export type CartInput = Body<'/api/v1/storefront/checkout_sessions', 'post'>;
export type CheckoutInput = Body<'/api/v1/storefront/checkout_sessions/{id}/actions/complete', 'post'>;

export function createStorefront(opts: StorefrontOptions) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.locale) headers['Accept-Language'] = opts.locale;
  if (opts.displayCurrency) headers['X-Display-Currency'] = opts.displayCurrency;
  if (opts.customerSession) headers['X-Customer-Session'] = opts.customerSession;
  const client = createClient({ ...opts, apiKey: opts.publishableKey, headers });
  const locale = opts.locale ? { locale: opts.locale } : {};
  // Errors are thrown as OpenRentError by the client; answers are the documented storefront shapes.
  const data = async <T>(p: Promise<{ data?: unknown }>) => (await p).data as T;

  const cart = {
    create: (input: CartInput = {}) => data<CheckoutSession>(client.POST('/api/v1/storefront/checkout_sessions', { body: input })),
    get: (id: string) => data<CheckoutSession>(client.GET('/api/v1/storefront/checkout_sessions/{id}', { params: { path: { id }, query: locale } })),
    update: (id: string, patch: CartInput) => data<CheckoutSession>(client.PATCH('/api/v1/storefront/checkout_sessions/{id}', { params: { path: { id } }, body: patch })),
    /** Adds to a line (or starts one); a quantity of 0 removes it. */
    async add(id: string, variantId: string, quantity = 1) {
      const s = await cart.get(id);
      const lines = s.lines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity }));
      const line = lines.find((l) => l.variant_id === variantId);
      if (line) line.quantity += quantity;
      else lines.push({ variant_id: variantId, quantity });
      await cart.update(id, { lines: lines.filter((l) => l.quantity > 0) });
      return cart.get(id);
    },
    /** Places the order. `terms_hash` comes from `settings().terms.hash`. */
    complete: (id: string, input: CheckoutInput) => data<CheckoutResult>(client.POST('/api/v1/storefront/checkout_sessions/{id}/actions/complete', { params: { path: { id } }, body: input })),
  };

  return {
    /** The underlying typed client, for storefront calls not wrapped here. */
    client,
    settings: () => data<StorefrontSettings>(client.GET('/api/v1/storefront/settings', { params: { query: locale } })),
    categories: async () => (await data<{ data: Category[] }>(client.GET('/api/v1/storefront/catalog/categories'))).data,
    /** Public products; with `from` and `to`, each variant says how many are free then. */
    products: (query: ProductQuery = {}) => data<ProductList>(client.GET('/api/v1/storefront/catalog/products', { params: { query: { ...locale, ...query } } })),
    product: (slug: string, query: { from?: string; to?: string; location_id?: string } = {}) =>
      data<Product>(client.GET('/api/v1/storefront/catalog/products/{slug}', { params: { path: { slug }, query: { ...locale, ...query } } })),
    /** A month of days for a date picker (`month` is YYYY-MM). */
    calendar: async (variantId: string, month: string) => (await data<{ data: CalendarDay[] }>(client.GET('/api/v1/storefront/availability', { params: { query: { variant_id: variantId, month } } }))).data,
    quote: (input: QuoteInput) => data<PriceQuote>(client.POST('/api/v1/storefront/price_quote', { body: { ...locale, ...input } })),
    cart,
    /** Paths of the home page, published pages, categories and public products, for a sitemap. */
    sitemap: (query: { offset?: number; limit?: number } = {}) => data<SitemapPage>(client.GET('/api/v1/storefront/sitemap', { params: { query } })),
    /** One of the shop's published pages, in the client's language. */
    page: (slug: string) => data<StorefrontPage>(client.GET('/api/v1/storefront/pages/{slug}', { params: { path: { slug }, query: locale } })),
    /** The confirmation page's order, by its id or token, with the token from the checkout result. */
    order: (idOrToken: string, token: string) => data<PublicOrder>(client.GET('/api/v1/storefront/orders/{id}', { params: { path: { id: idOrToken }, query: { token } } })),
  };
}

export type Storefront = ReturnType<typeof createStorefront>;
