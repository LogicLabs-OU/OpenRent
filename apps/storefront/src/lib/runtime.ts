import { invalidateAll } from '$app/navigation';
import type { Runtime, Shop } from '@openrent/theme-sdk';
import { RuntimeError, translator, isLocale, type ThemeModule } from '@openrent/theme-sdk';
import { lookup, t as appT } from './i18n/index.ts';
import Payment from './Payment.svelte';
import Slot from './Slot.svelte';
import { checkoutExtra } from './extensions.svelte.ts';
import { makeZone } from './zone.ts';

async function call<T = any>(locale: string, method: string, path: string, body?: unknown): Promise<T> {
  // The page's language travels with every call, so server messages and names match the page.
  const headers: Record<string, string> = { 'X-Or-Locale': locale };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/_or/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fields: Record<string, string> = {};
    for (const e of data?.errors ?? []) if (e?.field && !fields[e.field]) fields[e.field] = e.message;
    throw new RuntimeError(data?.message ?? data?.detail ?? appT('error.generic', {}, locale), res.status, data?.code ?? 'error', fields);
  }
  return data as T;
}

/** The runtime handed to themes. `getShop` returns the latest shop data after navigation. */
/** The same page in another storefront language: the default has no prefix, others `/xx`. */
export function switchLocalePath(target: string, defaultLocale: string, pathWithSearch: string) {
  const m = /^\/([a-z]{2})(?=\/|\?|$)/.exec(pathWithSearch);
  const rest = (m && isLocale(m[1]) ? pathWithSearch.slice(3) : pathWithSearch) || '/';
  if (target === defaultLocale) return rest.startsWith('/') ? rest : `/${rest}`;
  return `/${target}${rest === '/' ? '' : rest.startsWith('?') ? `/${rest}` : rest}`;
}

/**
 * The runtime handed to themes, for one storefront language. `getShop` returns the latest shop data
 * after navigation; `currentPath` gives the page path during server rendering.
 */
export function createRuntime(theme: ThemeModule, getShop: () => Shop, overrides: Record<string, Record<string, string>> = {}, currentPath: () => string = () => '/'): Runtime {
  const shop0 = getShop();
  const defaultLocale = shop0.locales?.[0] ?? shop0.locale;
  /** URL prefix of the page's language; empty for the shop default. */
  const base = shop0.locale === defaultLocale ? '' : `/${shop0.locale}`;
  // The shop's own wording (Admin → Themes → Texts) wins over the theme's strings.
  // Overrides are per language: an edited English text never shows on a German page.
  const themeT = translator(theme, shop0.locale, overrides[shop0.locale] ?? {});
  // Theme strings first; keys a theme does not define fall back to the storefront catalogue.
  const t: Runtime['t'] = (key, params = {}) => {
    const msg = themeT(key, params);
    if (msg !== key) return msg;
    const fallback = getShop().strings?.[key] ?? lookup(key, shop0.locale);
    return fallback ? fallback.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : key;
  };
  const tz = shop0.locations[0]?.timezone ?? shop0.tenant.timezone;
  const zone = makeZone(tz, shop0.locations[0]?.opening_hours ?? {});
  const money = new Intl.NumberFormat(shop0.locale, { style: 'currency', currency: shop0.tenant.currency });
  const dfmt = new Intl.DateTimeFormat(shop0.locale, { dateStyle: 'medium', timeZone: tz });
  const dtfmt = new Intl.DateTimeFormat(shop0.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz });
  const tfmt = new Intl.DateTimeFormat(shop0.locale, { timeStyle: 'short', timeZone: tz });
  return {
    get shop() {
      return getShop();
    },
    async setDates(from, to) {
      await call(shop0.locale, 'POST', 'dates', { from, to });
      await invalidateAll();
    },
    async addToCart(variantId, quantity) {
      await call(shop0.locale, 'POST', 'cart', { variant_id: variantId, quantity, mode: 'add' });
      await invalidateAll();
    },
    async setQuantity(variantId, quantity) {
      await call(shop0.locale, 'POST', 'cart', { variant_id: variantId, quantity, mode: 'set' });
      await invalidateAll();
    },
    async applyCoupon(code) {
      await call(shop0.locale, 'POST', 'cart', { coupon: code });
      await invalidateAll();
    },
    async setOptions(options) {
      await call(shop0.locale, 'POST', 'cart', { options });
      await invalidateAll();
    },
    calendar: (variantId, month) => call(shop0.locale, 'GET', `calendar?variant_id=${encodeURIComponent(variantId)}&month=${month}`).then((r) => r.data),
    quote: (lines, from, to) => call(shop0.locale, 'POST', 'quote', { lines, starts_at: from, ends_at: to }),
    asset: (path) => getShop().assets?.[path.replace(/^\.?\//, '')] ?? path,
    checkout: async (input) => {
      checkoutExtra.errors = {};
      try {
        return await call(shop0.locale, 'POST', 'checkout', { ...input, extra: checkoutExtra.values });
      } catch (err) {
        // Plugin fields show their own errors in the checkout.extra_fields slot.
        if (err instanceof RuntimeError) checkoutExtra.errors = Object.fromEntries(Object.entries(err.fields).filter(([k]) => k.startsWith('extra.')).map(([k, v]) => [k.slice(6), v]));
        throw err;
      }
    },
    payOrder: async (token) => {
      const r = await call(shop0.locale, 'POST', 'order-payment', { token });
      return { clientSecret: r.client_secret ?? null, publishableKey: r.public_config?.publishable_key ?? null };
    },
    account: {
      async login(email) {
        await call(shop0.locale, 'POST', 'account/login', { email });
      },
      async verify(token) {
        await call(shop0.locale, 'POST', 'account/verify', { token });
        await invalidateAll();
      },
      // No data refresh here: the account page would redirect mid-refresh; themes reload the page after.
      async logout() {
        await call(shop0.locale, 'POST', 'account/logout', {});
      },
      async updateProfile(patch) {
        const p = await call(shop0.locale, 'PATCH', 'account/profile', patch);
        await invalidateAll();
        return p;
      },
      async requestCancellation(order, reason) {
        await call(shop0.locale, 'POST', 'account/cancellation', { order_id: order.id, token: order.token, reason });
        await invalidateAll();
      },
      async withdrawCancellation(order) {
        await call(shop0.locale, 'DELETE', 'account/cancellation', { order_id: order.id, token: order.token });
        await invalidateAll();
      },
      async requestExtension(order, endsAt, reason) {
        await call(shop0.locale, 'POST', 'account/extension', { order_id: order.id, token: order.token, ends_at: endsAt, reason });
        await invalidateAll();
      },
      async withdrawExtension(order) {
        await call(shop0.locale, 'DELETE', 'account/extension', { order_id: order.id, token: order.token });
        await invalidateAll();
      },
    },
    signature: {
      sendCode: (token) => call(shop0.locale, 'POST', 'sign', { action: 'send_code', token }),
      async sign(token, input) {
        await call(shop0.locale, 'POST', 'sign', { action: 'sign', token, ...input });
      },
    },
    t,
    format: {
      money: (m) => (m ? money.format(m.amount / 100) : ''),
      date: (iso) => (iso ? dfmt.format(new Date(iso)) : ''),
      datetime: (iso) => (iso ? dtfmt.format(new Date(iso)) : ''),
      time: (iso) => tfmt.format(new Date(iso)),
    },
    url: {
      home: () => base || '/',
      category: (slug) => `${base}/c/${slug}`,
      product: (slug) => `${base}/p/${slug}`,
      cart: () => `${base}/cart`,
      checkout: () => `${base}/checkout`,
      order: (token) => `${base}/order/${token}`,
      page: (slug) => `${base}/pages/${slug}`,
      account: () => `${base}/account`,
      accountLogin: () => `${base}/account/login`,
      switchLocale: (l) => switchLocalePath(l, defaultLocale, typeof location === 'undefined' ? currentPath() : location.pathname + location.search),
      search: (p = {}) => {
        const q = new URLSearchParams();
        if (p.q) q.set('q', p.q);
        if (p.category) q.set('category', p.category);
        if (p.available) q.set('available', '1');
        if (p.sort && p.sort !== 'relevance') q.set('sort', p.sort);
        const s = q.toString();
        return s ? `${base}/search?${s}` : `${base}/search`;
      },
      document: (docId, orderToken) => (orderToken ? `${base}/order/${orderToken}/documents/${docId}` : `/_or/account/documents/${docId}`),
      attachment: (id, orderToken) => (orderToken ? `${base}/order/${orderToken}/attachments/${id}` : `/_or/account/attachments/${id}`),
      damagePhoto: (fileId, orderToken) => `${base}/order/${orderToken}/photos/${fileId}`,
    },
    components: { Payment, Slot },
    zone,
  };
}
