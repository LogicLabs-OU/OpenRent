import type { Cookies } from '@sveltejs/kit';

const opts = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: false, maxAge: 60 * 60 * 24 * 7 };

export function readDates(cookies: Cookies): { from: string | null; to: string | null } {
  try {
    const v = JSON.parse(cookies.get('or_dates') ?? '{}');
    const ok = (s: unknown) => typeof s === 'string' && !Number.isNaN(Date.parse(s)) ? s : null;
    return { from: ok(v.from), to: ok(v.to) };
  } catch {
    return { from: null, to: null };
  }
}

export function writeDates(cookies: Cookies, from: string | null, to: string | null, secure: boolean) {
  if (!from || !to) cookies.delete('or_dates', { path: '/' });
  else cookies.set('or_dates', JSON.stringify({ from, to }), { ...opts, secure });
}

export const cartId = (cookies: Cookies) => cookies.get('or_cart') ?? null;
export const setCart = (cookies: Cookies, id: string | null, secure: boolean) => (id ? cookies.set('or_cart', id, { ...opts, secure }) : cookies.delete('or_cart', { path: '/' }));

/** The storefront language a visitor last saw; once set, the first-visit redirect stops. */
export const langCookie = (cookies: Cookies) => cookies.get('or_lang') ?? null;
/** The currency the visitor chose to see prices in (FR-I18N-7). */
export const readCurrency = (cookies: Cookies) => {
  const c = cookies.get('or_currency');
  return c && /^[A-Z]{3}$/.test(c) ? c : null;
};
export const setCurrency = (cookies: Cookies, code: string, secure: boolean) => cookies.set('or_currency', code, { ...opts, httpOnly: false, secure, maxAge: 60 * 60 * 24 * 365 });
export const setLangCookie = (cookies: Cookies, locale: string, secure: boolean) => cookies.set('or_lang', locale, { ...opts, httpOnly: false, secure, maxAge: 60 * 60 * 24 * 365 });

/** The location the visitor picks up from; the API uses it for stock, opening hours and the cart. */
export const readLocation = (cookies: Cookies) => {
  const c = cookies.get('or_location');
  return c && /^loc_[0-9A-Za-z]+$/.test(c) ? c : null;
};
export const setLocation = (cookies: Cookies, id: string, secure: boolean) => cookies.set('or_location', id, { ...opts, secure, maxAge: 60 * 60 * 24 * 365 });

/** Customer account session (email-link sign-in), kept server-side only. */
export const accountToken = (cookies: Cookies) => cookies.get('or_account') ?? null;
export const setAccount = (cookies: Cookies, token: string | null, secure: boolean) =>
  token ? cookies.set('or_account', token, { ...opts, secure, maxAge: 60 * 60 * 24 * 30 }) : cookies.delete('or_account', { path: '/' });

/**
 * Theme preview lasts for the browser session; the token itself expires after an hour. Over https the
 * cookie is SameSite=None so the admin's preview frame works when the storefront is on another site.
 */
export const setPreview = (cookies: Cookies, token: string | null, secure: boolean) =>
  token ? cookies.set('or_preview', token, { path: '/', httpOnly: true, sameSite: secure ? 'none' : 'lax', secure }) : cookies.delete('or_preview', { path: '/' });
