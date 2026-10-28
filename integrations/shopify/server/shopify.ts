import { createHmac, timingSafeEqual } from 'node:crypto';

/** Shopify's checks and calls the app needs: shop names, HMACs, the install token and GraphQL. */

/** A shop's own domain, as Shopify names it: `name.myshopify.com`. */
export const isShopDomain = (shop: unknown): shop is string => typeof shop === 'string' && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop);

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * The `hmac` Shopify adds to the install callback and to the app's address in the admin: every other query
 * parameter, sorted, as `k=v` joined by `&`, HMAC-SHA256 in hex with the app's secret.
 */
export function verifyQuery(query: URLSearchParams, secret: string) {
  const hmac = query.get('hmac');
  if (!hmac) return false;
  const message = [...query.entries()]
    .filter(([k]) => k !== 'hmac' && k !== 'signature')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return same(createHmac('sha256', secret).update(message).digest('hex'), hmac);
}

/** A webhook's `X-Shopify-Hmac-Sha256`: the raw body, HMAC-SHA256 in base64 with the app's secret. */
export function verifyWebhook(rawBody: Buffer, header: string | undefined, secret: string) {
  if (!header) return false;
  return same(createHmac('sha256', secret).update(rawBody).digest('base64'), header);
}

export interface ShopifyOptions {
  apiKey: string;
  apiSecret: string;
  apiVersion: string;
  /** Where a shop's admin answers; tests point it at a stand-in. */
  base: (shop: string) => string;
}

export async function exchangeInstallCode(o: ShopifyOptions, shop: string, code: string) {
  const res = await fetch(`${o.base(shop)}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: o.apiKey, client_secret: o.apiSecret, code }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Shopify would not install the app (${res.status})`);
  return (await res.json()) as { access_token: string; scope: string };
}

export async function graphql<T = any>(o: ShopifyOptions, shop: string, token: string, query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(`${o.base(shop)}/admin/api/${o.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body.errors?.length) throw new Error(`Shopify GraphQL: ${res.status} ${JSON.stringify(body.errors ?? body)}`);
  return body.data as T;
}

/**
 * The OpenRent settings the theme blocks read, as an app-data metafield (`app.metafields.openrent.config`),
 * which only this app writes and needs no access scope.
 */
export async function writeConfig(o: ShopifyOptions, shop: string, token: string, config: Record<string, string> | null) {
  const { currentAppInstallation } = await graphql<{ currentAppInstallation: { id: string } }>(o, shop, token, `query { currentAppInstallation { id } }`);
  if (!config) {
    await graphql(o, shop, token, `mutation($m: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $m) { userErrors { field message } } }`, {
      m: [{ ownerId: currentAppInstallation.id, namespace: 'openrent', key: 'config' }],
    });
    return;
  }
  const r = await graphql<{ metafieldsSet: { userErrors: { message: string }[] } }>(
    o,
    shop,
    token,
    `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } } }`,
    { m: [{ ownerId: currentAppInstallation.id, namespace: 'openrent', key: 'config', type: 'json', value: JSON.stringify(config) }] },
  );
  if (r.metafieldsSet.userErrors.length) throw new Error(`Shopify metafield: ${r.metafieldsSet.userErrors.map((e) => e.message).join('; ')}`);
}

/** The shop's storefront addresses: its myshopify domain and its own primary domain. */
export async function storefrontOrigins(o: ShopifyOptions, shop: string, token: string) {
  const { shop: s } = await graphql<{ shop: { primaryDomain: { url: string } } }>(o, shop, token, `query { shop { primaryDomain { url } } }`);
  return [...new Set([`https://${shop}`, new URL(s.primaryDomain.url).origin])];
}
