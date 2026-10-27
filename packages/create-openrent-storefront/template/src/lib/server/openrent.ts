import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { createStorefront, type Storefront } from '@openrent/sdk/storefront';
import { OPENRENT_API_URL, OPENRENT_PUBLISHABLE_KEY, OPENRENT_TENANT_SLUG } from '$app/env/private';

/** The shop's storefront API for one request, in the visitor's language once it is known. */
export function shop(event: RequestEvent, locale?: string): Storefront {
  return createStorefront({
    baseUrl: OPENRENT_API_URL,
    publishableKey: OPENRENT_PUBLISHABLE_KEY,
    tenantSlug: OPENRENT_PUBLISHABLE_KEY ? undefined : OPENRENT_TENANT_SLUG,
    locale,
    // The API limits requests per visitor, so it needs the visitor's address.
    headers: { 'X-Forwarded-For': event.getClientAddress() },
  });
}

export interface ShopInfo {
  name: string;
  lang: string;
  timezone: string;
  logo: string | null;
  /** The home page's search engine texts and the picture for shared links, as the shop wrote them in Admin → Settings. */
  seo: { title: string | null; description: string | null; image: string | null };
}

/** The shop's name, language, time zone and search engine texts, read once per request. */
export function shopInfo(event: RequestEvent): Promise<ShopInfo> {
  event.locals.shop ??= shop(event)
    .settings()
    .then((s) => ({
      name: s.tenant.name, lang: s.default_locale, timezone: s.locations[0]?.timezone ?? s.tenant.timezone, logo: (s.tenant.branding?.logo_url as string | undefined) ?? null,
      seo: { title: s.seo?.title ?? null, description: s.seo?.description ?? null, image: s.seo?.image_url ?? null },
    }));
  return event.locals.shop;
}

const CART = 'cart';
const DATES = 'dates';
const cookie = (event: RequestEvent) => ({ path: '/', httpOnly: true, sameSite: 'lax' as const, secure: event.url.protocol === 'https:', maxAge: 60 * 60 * 3 });

export const cartId = (cookies: Cookies) => cookies.get(CART) ?? null;
export function setCart(event: RequestEvent, id: string | null) {
  if (id) event.cookies.set(CART, id, cookie(event));
  else event.cookies.delete(CART, { path: '/' });
}

/** The rental period the visitor chose, as UTC ISO times. */
export function readDates(cookies: Cookies): { from: string; to: string } | null {
  const [from, to] = (cookies.get(DATES) ?? '').split('|');
  return from && to ? { from, to } : null;
}
export function setDates(event: RequestEvent, d: { from: string; to: string } | null) {
  if (d) event.cookies.set(DATES, `${d.from}|${d.to}`, cookie(event));
  else event.cookies.delete(DATES, { path: '/' });
}
