import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

/**
 * A stand-in for Shopify, for one app and its shops: the install (authorize redirects with a signed query,
 * the code exchange), the Admin GraphQL the app uses (its installation, the shop's domain, app metafields),
 * opening the app from the admin, and signed webhooks.
 */
export interface ShopifyFake {
  url: string;
  /** A shop's admin base, as the app's `base` option wants it. */
  base: (shop: string) => string;
  metafields: Map<string, unknown>;
  tokens: Map<string, string>;
  /** The app's address as the admin opens it, signed like Shopify does. */
  openApp(shop: string, extra?: Record<string, string>): string;
  webhook(topic: string, shop: string, body: unknown, secret?: string): { headers: Record<string, string>; body: string };
  close(): Promise<void>;
}

export function sign(params: Record<string, string>, secret: string) {
  const message = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return createHmac('sha256', secret).update(message).digest('hex');
}

/** The `host` Shopify adds: the admin's address for the shop, base64 without padding. */
const host = (shop: string) => Buffer.from(`admin.shopify.com/store/${shop.replace('.myshopify.com', '')}`).toString('base64').replace(/=+$/, '');

export async function startShopifyFake(o: { apiKey: string; apiSecret: string; appUrl: () => string }): Promise<ShopifyFake> {
  const codes = new Map<string, string>(); // code -> shop
  const tokens = new Map<string, string>(); // token -> shop
  const metafields = new Map<string, unknown>(); // shop -> config
  const signedQuery = (params: Record<string, string>) => new URLSearchParams({ ...params, hmac: sign(params, o.apiSecret) }).toString();
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const m = /^\/shops\/([^/]+)(\/.*)$/.exec(url.pathname);
    if (!m) return void res.writeHead(404).end();
    const shop = decodeURIComponent(m[1]!);
    const path = m[2]!;
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    const json = (status: number, v: unknown) => void res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(v));

    if (req.method === 'GET' && path === '/admin/oauth/authorize') {
      if (url.searchParams.get('client_id') !== o.apiKey) return json(400, { error: 'unknown app' });
      const code = randomBytes(12).toString('hex');
      codes.set(code, shop);
      const q = signedQuery({ code, shop, state: url.searchParams.get('state') ?? '', timestamp: String(Math.floor(Date.now() / 1000)), host: host(shop) });
      return void res.writeHead(302, { location: `${url.searchParams.get('redirect_uri')}?${q}` }).end();
    }
    if (req.method === 'POST' && path === '/admin/oauth/access_token') {
      const b = JSON.parse(body || '{}');
      if (b.client_id !== o.apiKey || b.client_secret !== o.apiSecret || codes.get(b.code) !== shop) return json(400, { error: 'invalid_request' });
      codes.delete(b.code);
      const token = `shpat_${randomBytes(12).toString('hex')}`;
      tokens.set(token, shop);
      return json(200, { access_token: token, scope: '' });
    }
    if (req.method === 'POST' && /^\/admin\/api\/[\d-]+\/graphql\.json$/.test(path)) {
      if (tokens.get(String(req.headers['x-shopify-access-token'])) !== shop) return json(401, { errors: '[API] Invalid API key or access token' });
      const { query, variables } = JSON.parse(body);
      const installation = `gid://shopify/AppInstallation/${shop.length}`;
      if (query.includes('currentAppInstallation')) return json(200, { data: { currentAppInstallation: { id: installation } } });
      if (query.includes('primaryDomain')) return json(200, { data: { shop: { primaryDomain: { url: `https://www.${shop.replace('.myshopify.com', '')}.example` } } } });
      if (query.includes('metafieldsSet')) {
        const f = variables.m[0];
        if (f.ownerId !== installation || f.namespace !== 'openrent' || f.type !== 'json') return json(200, { data: { metafieldsSet: { metafields: [], userErrors: [{ field: ['ownerId'], message: 'bad owner' }] } } });
        metafields.set(shop, JSON.parse(f.value));
        return json(200, { data: { metafieldsSet: { metafields: [{ id: 'gid://shopify/Metafield/1' }], userErrors: [] } } });
      }
      if (query.includes('metafieldsDelete')) {
        metafields.delete(shop);
        return json(200, { data: { metafieldsDelete: { userErrors: [] } } });
      }
      return json(200, { errors: [{ message: 'unknown query' }] });
    }
    // The admin opening the app: Shopify loads the app's address with a signed query.
    if (req.method === 'GET' && path.startsWith(`/admin/apps/${o.apiKey}`)) {
      const extra = Object.fromEntries(url.searchParams);
      return void res.writeHead(302, { location: `${o.appUrl()}/?${signedQuery({ shop, timestamp: String(Math.floor(Date.now() / 1000)), host: host(shop), embedded: '1', ...extra })}` }).end();
    }
    return void res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  return {
    url,
    base: (shop) => `${url}/shops/${encodeURIComponent(shop)}`,
    metafields,
    tokens,
    openApp: (shop, extra = {}) => `${o.appUrl()}/?${signedQuery({ shop, timestamp: String(Math.floor(Date.now() / 1000)), host: host(shop), embedded: '1', ...extra })}`,
    webhook: (topic, shop, b, secret = o.apiSecret) => {
      const body = JSON.stringify(b);
      return { body, headers: { 'content-type': 'application/json', 'x-shopify-topic': topic, 'x-shopify-shop-domain': shop, 'x-shopify-hmac-sha256': createHmac('sha256', secret).update(body).digest('base64') } };
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}
