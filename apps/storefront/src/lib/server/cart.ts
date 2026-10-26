import type { RequestEvent } from '@sveltejs/kit';
import { sf, SfError, localeQuery } from './api.ts';
import { cartId, readDates, setCart } from './session.ts';

/** Loads the cart; lines carry product names for templates. */
export async function loadCart(event: RequestEvent) {
  const id = cartId(event.cookies);
  const dates = readDates(event.cookies);
  const empty = { id: null, starts_at: dates.from, ends_at: dates.to, lines: [], coupon_codes: [], quote: null, availability: [], quote_error: null };
  if (!id) return empty;
  try {
    let s = await sf(event, `/checkout_sessions/${id}${localeQuery(event)}`);
    if (s.status !== 'open') {
      setCart(event.cookies, null, event.url.protocol === 'https:');
      return empty;
    }
    if (dates.from && dates.to && (s.starts_at !== dates.from || s.ends_at !== dates.to)) {
      await sf(event, `/checkout_sessions/${id}`, { method: 'PATCH', body: { starts_at: dates.from, ends_at: dates.to } });
      s = await sf(event, `/checkout_sessions/${id}${localeQuery(event)}`);
    }
    // Lines come with product and variant names in the page's language.
    return s;
  } catch (e) {
    if (e instanceof SfError && e.status === 404) {
      setCart(event.cookies, null, event.url.protocol === 'https:');
      return empty;
    }
    throw e;
  }
}
