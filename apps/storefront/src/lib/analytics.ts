/**
 * The storefront's analytics events (FR-SF-8): `view_item`, `add_to_cart`, `begin_checkout` and
 * `purchase`. Nothing leaves the page until the visitor allows analytics; events before that wait in
 * memory and go once consent is given. Each event is passed to GA4, Meta Pixel and Plausible when a
 * plugin loaded them, and is also a `openrent:analytics` DOM event for any other script.
 */
export type AnalyticsEvent =
  | { name: 'view_item'; currency: string; value: number; items: Item[] }
  | { name: 'add_to_cart'; currency: string; value: number; items: Item[] }
  | { name: 'begin_checkout'; currency: string; value: number; items: Item[] }
  | { name: 'purchase'; currency: string; value: number; transaction_id: string; items: Item[] };
export interface Item {
  item_id: string;
  item_name: string;
  quantity?: number;
}

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
    fbq?: Gtag & { queue?: unknown[]; callMethod?: Gtag; loaded?: boolean; version?: string; push?: unknown };
    _fbq?: unknown;
    plausible?: Gtag & { q?: unknown[] };
  }
}

let allowed = false;
const waiting: AnalyticsEvent[] = [];

/** Sends an event, or keeps it until analytics are allowed. */
export function track(e: AnalyticsEvent) {
  if (typeof window === 'undefined') return;
  if (!allowed) {
    if (waiting.length < 20) waiting.push(e);
    return;
  }
  send(e);
}

/**
 * Called when the visitor allows analytics, before the plugins' scripts are added: sets up the
 * vendors' queues so events are kept until their script has loaded, then sends what waited.
 */
export function allowAnalytics(scripts: { attrs?: Record<string, string> }[]) {
  if (allowed || typeof window === 'undefined') return;
  allowed = true;
  const ga4 = scripts.map((s) => s.attrs?.['data-ga4']).find(Boolean);
  const pixel = scripts.map((s) => s.attrs?.['data-pixel']).find(Boolean);
  const plausible = scripts.some((s) => s.attrs?.['data-domain']);
  if (ga4) {
    window.dataLayer = window.dataLayer ?? [];
    // gtag reads the arguments object itself, as its own snippet does.
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', ga4);
  }
  if (pixel && !window.fbq) {
    const q: any = function (...args: unknown[]) {
      if (q.callMethod) q.callMethod(...args);
      else q.queue.push(args);
    };
    q.queue = [];
    q.loaded = true;
    q.version = '2.0';
    q.push = q;
    window.fbq = q;
    window._fbq = q;
    window.fbq!('init', pixel);
    window.fbq!('track', 'PageView');
  }
  if (plausible && !window.plausible) {
    const p: any = (...args: unknown[]) => (p.q = p.q ?? []).push(args);
    window.plausible = p;
  }
  for (const e of waiting.splice(0)) send(e);
}

const FB: Record<AnalyticsEvent['name'], string> = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'Purchase' };

function send(e: AnalyticsEvent) {
  const { name, ...params } = e;
  window.dispatchEvent(new CustomEvent('openrent:analytics', { detail: e }));
  window.gtag?.('event', name, params);
  window.fbq?.('track', FB[name], { currency: e.currency, value: e.value, content_ids: e.items.map((i) => i.item_id), content_type: 'product' });
  window.plausible?.(name, { props: { items: e.items.map((i) => i.item_name).join(', ') }, ...(name === 'purchase' ? { revenue: { currency: e.currency, amount: e.value } } : {}) });
}

/** Minor units to the decimal value analytics tools expect. */
export const value = (amount: number) => Math.round(amount) / 100;
