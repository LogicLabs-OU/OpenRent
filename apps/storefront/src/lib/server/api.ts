import { error, json, type RequestEvent } from '@sveltejs/kit';
import { t } from '../i18n/index.ts';
import { OPENRENT_API_URL, OPENRENT_STOREFRONT_DOMAIN, TENANT_SLUG, OPENRENT_PUBLISHABLE_KEY } from '$app/env/private';

const API = () => OPENRENT_API_URL;

/** Signed theme preview token (FR-THM-3), set from `?preview_theme=` and sent to the API. */
export const PREVIEW_COOKIE = 'or_preview';

/**
 * Host → tenant: `{slug}.{OPENRENT_STOREFRONT_DOMAIN}`, else TENANT_SLUG. Without a slug the API gets the
 * host (X-Storefront-Host) and finds the shop by its verified custom domain, or its only shop.
 */
export function tenantSlug(event: RequestEvent): string | null {
  const domain = OPENRENT_STOREFRONT_DOMAIN?.replace(/^\*\./, '');
  const host = event.url.hostname;
  if (domain && host.endsWith(`.${domain}`)) return host.slice(0, -(domain.length + 1));
  return TENANT_SLUG ?? null;
}

export class SfError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: any,
  ) {
    super(message);
  }
}

/** The storefront language of a request, or null for the shop default (base texts). */
export function localeOf(event: RequestEvent): string | null {
  return (event.params as { lang?: string }).lang ?? event.locals.locale ?? null;
}

/** A storefront path in the request's language (`/account` → `/de/account`). */
export function localPath(event: RequestEvent, path: string): string {
  const lang = (event.params as { lang?: string }).lang;
  return lang ? `/${lang}${path}` : path;
}

/** `?locale=xx` for API calls that return shop texts, or '' for the default language. */
export function localeQuery(event: RequestEvent, sep: '?' | '&' = '?'): string {
  const l = localeOf(event);
  return l ? `${sep}locale=${l}` : '';
}

/** Calls the public storefront namespace only (FR-SF-3). Server messages come back in the request's language. */
export async function sf<T = any>(event: RequestEvent, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  return call<T>(event, `/storefront${path}`, init);
}

/** Calls the customer portal (FR-CUS-6) as the signed-in customer. */
export async function portal<T = any>(event: RequestEvent, path: string, init: { method?: string; body?: unknown | FormData } = {}): Promise<T> {
  return call<T>(event, `/portal${path}`, init);
}

async function call<T>(event: RequestEvent, path: string, init: { method?: string; body?: unknown | FormData }): Promise<T> {
  const slug = tenantSlug(event);
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Forwarded-For': event.getClientAddress(), 'User-Agent': event.request.headers.get('user-agent') ?? 'OpenRent-Storefront' };
  const locale = localeOf(event);
  if (locale) headers['Accept-Language'] = locale;
  if (slug) headers['X-Tenant-Slug'] = slug;
  else headers['X-Storefront-Host'] = event.url.hostname;
  if (OPENRENT_PUBLISHABLE_KEY) headers.Authorization = `Bearer ${OPENRENT_PUBLISHABLE_KEY}`;
  const preview = event.cookies.get(PREVIEW_COOKIE);
  if (preview) headers['X-Theme-Preview'] = preview;
  const account = event.cookies.get('or_account');
  if (account) headers['X-Customer-Session'] = account;
  // The currency the visitor sees prices in (FR-I18N-7); only catalogue answers use it.
  // The location the visitor picked (stock, hours and the cart follow it).
  const location = event.cookies.get('or_location');
  if (location && /^loc_[0-9A-Za-z]+$/.test(location)) headers['X-Storefront-Location'] = location;
  const currency = event.cookies.get('or_currency');
  if (currency && /^[A-Z]{3}$/.test(currency)) headers['X-Display-Currency'] = currency;
  // A FormData body sets its own multipart content type.
  const form = init.body instanceof FormData;
  if (init.body !== undefined && !form) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API()}/api/v1${path}`, { method: init.method ?? 'GET', headers, body: form ? (init.body as FormData) : init.body !== undefined ? JSON.stringify(init.body) : undefined });
  } catch {
    error(503, t('error.unavailable'));
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new SfError(res.status, data?.code ?? 'error', data?.detail ?? res.statusText, data);
  return data as T;
}

/** The API response as-is (PDF downloads); errors come back as their status. */
export async function sfRaw(event: RequestEvent, path: string): Promise<Response> {
  const slug = tenantSlug(event);
  const headers: Record<string, string> = { 'X-Forwarded-For': event.getClientAddress() };
  if (slug) headers['X-Tenant-Slug'] = slug;
  else headers['X-Storefront-Host'] = event.url.hostname;
  if (OPENRENT_PUBLISHABLE_KEY) headers.Authorization = `Bearer ${OPENRENT_PUBLISHABLE_KEY}`;
  const account = event.cookies.get('or_account');
  if (account) headers['X-Customer-Session'] = account;
  try {
    return await fetch(`${API()}/api/v1/storefront${path}`, { headers });
  } catch {
    error(503, t('error.unavailable'));
  }
}

/** Runs API calls for an `_or` endpoint and returns API errors in the shape the runtime reads. */
export async function relay(fn: () => Promise<unknown>) {
  try {
    return json((await fn()) ?? { ok: true });
  } catch (e) {
    if (e instanceof SfError) return json({ message: e.message, code: e.code, errors: e.body?.errors ?? [] }, { status: e.status });
    throw e;
  }
}

export function fail(e: unknown): never {
  // A suspended shop (managed cloud) is, for its customers, simply not available.
  if (e instanceof SfError && e.code === 'shop_suspended') error(503, t('error.unavailable'));
  if (e instanceof SfError) error(e.status === 401 ? 404 : e.status, e.message);
  throw e;
}
