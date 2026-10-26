export interface WidgetConfig {
  api: string;
  shop?: string;
  pk?: string;
  storefront?: string;
  /** Language for product names, prices and server messages. */
  locale: string;
}

import { t, widgetLocale } from './i18n/index.ts';

/** Calls the public storefront namespace with a publishable key or shop slug (no cookies). */
export async function call<T = any>(cfg: WidgetConfig, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': cfg.locale };
  if (cfg.pk) headers.Authorization = `Bearer ${cfg.pk}`;
  if (cfg.shop) headers['X-Tenant-Slug'] = cfg.shop;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${cfg.api.replace(/\/$/, '')}/api/v1/storefront${path}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.errors?.[0]?.message ?? data?.detail ?? t('request_failed', {}, cfg.locale)), { status: res.status, fields: (data?.errors ?? []) as { field: string; message: string }[] });
  return data as T;
}

export function config(host: { api?: string; shop?: string; pk?: string; storefront?: string; lang?: string }): WidgetConfig {
  const api = host.api || (document.querySelector('script[data-openrent-api]') as HTMLScriptElement | null)?.dataset.openrentApi || '';
  return { api, shop: host.shop, pk: host.pk, storefront: host.storefront || api, locale: widgetLocale(host.lang) };
}

export const money = (m: { amount: number; currency: string } | undefined, locale?: string) => (m ? new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(m.amount / 100) : '');

// The checkout is a second script next to this one, loaded on the first "Book" so pages that only show
// products stay small (FR-SF-2).
const self = typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null;
const scriptBase = self?.src ? self.src.replace(/[^/]*$/, '') : null;
let loading: Promise<void> | null = null;

export function loadCheckout(): Promise<void> {
  if (customElements.get('openrent-checkout')) return Promise.resolve();
  loading ??= import.meta.env.DEV
    ? import('./checkout.ts').then(() => undefined)
    : new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = `${scriptBase ?? '/widget/'}openrent-checkout.js`;
        s.onload = () => resolve();
        s.onerror = () => {
          loading = null;
          reject(new Error('checkout script failed to load'));
        };
        document.head.appendChild(s);
      });
  return loading;
}

/** Opens the checkout drawer over the page; attributes are the same as the product widget's plus dates. */
export async function openCheckout(attrs: Record<string, string | number | undefined>) {
  await loadCheckout();
  document.querySelector('openrent-checkout')?.remove();
  const el = document.createElement('openrent-checkout');
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== '') el.setAttribute(k, String(v));
  document.body.appendChild(el);
}

/** After paying on the provider's page the customer comes back here with the order named in the URL. */
export function returnedOrder(): { order: string; token: string; paid: boolean } | null {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search);
  const order = q.get('openrent_order');
  const token = q.get('openrent_token');
  return order && token ? { order, token, paid: q.get('openrent_paid') === '1' } : null;
}
