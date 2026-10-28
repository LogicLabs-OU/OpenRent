import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, memoryStore } from '../server/app.ts';
import { verifyQuery, verifyWebhook } from '../server/shopify.ts';
import { sign, startShopifyFake, type ShopifyFake } from './shopify-fake.ts';
import { startOpenRentFake } from './openrent-fake.ts';

const KEY = 'test-api-key';
const SECRET = 'test-api-secret-123';
const SHOP = 'bike-hire.myshopify.com';

/** FR-SF-7: the Shopify app installs, connects a shop to OpenRent and gives the theme blocks their settings. */
describe('OpenRent for Shopify', () => {
  let shopify: ShopifyFake;
  let rent: Awaited<ReturnType<typeof startOpenRentFake>>;
  let server: Server;
  let appUrl = '';
  const store = memoryStore();

  /** Follows redirects through the app, the Shopify stand-in and the OpenRent stand-in, like a browser. */
  async function go(url: string, init: RequestInit = {}) {
    let res = await fetch(url, { ...init, redirect: 'manual' });
    const trail: string[] = [];
    while (res.status === 302) {
      const next = new URL(res.headers.get('location')!, url).toString();
      trail.push(next);
      url = next;
      res = await fetch(next, { redirect: 'manual' });
    }
    return { status: res.status, text: await res.text(), url, trail };
  }
  const form = (page: string) => Object.fromEntries([...page.matchAll(/name="(\w+)" value="([^"]*)"/g)].map((m) => [m[1]!, m[2]!.replace(/&amp;/g, '&')]));

  beforeAll(async () => {
    shopify = await startShopifyFake({ apiKey: KEY, apiSecret: SECRET, appUrl: () => appUrl });
    rent = await startOpenRentFake();
    // The app reads its own address when a request comes; it is known once the server listens.
    const cfg = { apiKey: KEY, apiSecret: SECRET, apiVersion: '2026-10', scopes: '', appUrl: '', base: shopify.base, store };
    const app = createApp(cfg);
    server = createServer((req, res) => void app(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    appUrl = cfg.appUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => {
    server?.close();
    await shopify?.close();
    await rent?.close();
  });

  it('checks Shopify’s signatures on queries and webhooks', () => {
    const params = { code: '0907a61c0c8d55e99db179b68161bc00', shop: 'some-shop.myshopify.com', state: '0.6784241404160823', timestamp: '1337178173' };
    const q = new URLSearchParams({ ...params, hmac: sign(params, SECRET) });
    expect(verifyQuery(q, SECRET)).toBe(true);
    q.set('shop', 'other.myshopify.com');
    expect(verifyQuery(q, SECRET)).toBe(false);
    expect(verifyQuery(new URLSearchParams(params), SECRET)).toBe(false);
    const w = shopify.webhook('app/uninstalled', SHOP, { id: 1 });
    expect(verifyWebhook(Buffer.from(w.body), w.headers['x-shopify-hmac-sha256'], SECRET)).toBe(true);
    expect(verifyWebhook(Buffer.from(`${w.body} `), w.headers['x-shopify-hmac-sha256'], SECRET)).toBe(false);
  });

  it('installs with Shopify’s OAuth, refusing a forged or unsigned return', async () => {
    expect((await go(`${appUrl}/?shop=${SHOP}`)).status).toBe(401);
    const forged = await go(`${appUrl}/auth/callback?code=x&shop=${SHOP}&state=s&timestamp=1&hmac=00`);
    expect(forged.status).toBe(401);
    // Opening the app before it is installed starts the install, which comes back to the admin.
    const r = await go(shopify.openApp(SHOP));
    expect(r.trail.some((u) => u.includes('/admin/oauth/authorize'))).toBe(true);
    expect((await store.get(SHOP))?.shopifyToken).toMatch(/^shpat_/);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Connect to OpenRent');
  });

  it('connects the shop to OpenRent, adds the storefront to the widget sites and gives the blocks their settings', async () => {
    const home = await go(shopify.openApp(SHOP, { locale: 'de-DE' }));
    expect(home.text).toContain('Mit OpenRent verbinden');
    const f = form(home.text);
    // A form for another shop, or out of date, is refused.
    expect((await go(`${appUrl}/openrent/connect`, { method: 'POST', body: new URLSearchParams({ ...f, shop: 'other.myshopify.com', api_url: rent.url }) })).status).toBe(401);
    expect((await go(`${appUrl}/openrent/connect`, { method: 'POST', body: new URLSearchParams({ ...f, until: '1', api_url: rent.url }) })).status).toBe(401);
    const bad = await go(`${appUrl}/openrent/connect`, { method: 'POST', body: new URLSearchParams({ ...f, api_url: 'http://evil.example' }) });
    expect(bad.text).toContain('beginnend mit https://');

    const done = await go(`${appUrl}/openrent/connect`, { method: 'POST', body: new URLSearchParams({ ...f, api_url: rent.url }) });
    expect(done.trail.some((u) => u.startsWith(`${rent.url}/oauth/authorize`) && u.includes('code_challenge_method=S256'))).toBe(true);
    expect(done.status).toBe(200);
    expect(done.text).toContain('Mit OpenRent verbunden.');
    expect(done.text).toContain('Tallinn Gear Rental');
    expect(shopify.metafields.get(SHOP)).toEqual({ api_url: rent.url, shop: 'demo', storefront_url: 'https://shop.rent.example' });
    expect(rent.settings.widget_origins).toEqual(['https://already.example', `https://${SHOP}`, 'https://www.bike-hire.example']);
    const rec = (await store.get(SHOP))!;
    expect(rec.openrent).toMatchObject({ tenantSlug: 'demo', refreshToken: expect.stringMatching(/^ort_/) });
    expect(rec.pending).toBeUndefined();
  });

  it('renews its OpenRent token with the refresh token (each works once)', async () => {
    const { accessToken } = await import('../server/openrent.ts');
    const rec = (await store.get(SHOP))!;
    const old = rec.openrent!.refreshToken;
    rec.openrent!.expiresAt = Date.now() - 1000;
    const t = await accessToken(rec, store.set);
    expect(t).toMatch(/^oat_/);
    expect((await store.get(SHOP))!.openrent!.refreshToken).not.toBe(old);
  });

  it('disconnects: OpenRent forgets the tokens and the blocks their settings', async () => {
    const home = await go(shopify.openApp(SHOP));
    const before = (await store.get(SHOP))!.openrent!.refreshToken!;
    const r = await go(`${appUrl}/openrent/disconnect`, { method: 'POST', body: new URLSearchParams(form(home.text)) });
    expect(r.text).toContain('Disconnected from OpenRent.');
    expect(rent.revoked).toContain(before);
    expect(shopify.metafields.has(SHOP)).toBe(false);
    expect((await store.get(SHOP))!.openrent).toMatchObject({ apiUrl: rent.url });
    expect((await store.get(SHOP))!.openrent!.refreshToken).toBeUndefined();
  });

  it('answers webhooks: forgets a shop that uninstalls, keeps no customer data', async () => {
    const forged = shopify.webhook('app/uninstalled', SHOP, {}, 'wrong-secret');
    expect((await fetch(`${appUrl}/webhooks`, { method: 'POST', headers: forged.headers, body: forged.body })).status).toBe(401);
    for (const topic of ['customers/data_request', 'customers/redact']) {
      const w = shopify.webhook(topic, SHOP, { customer: { id: 1 } });
      expect((await fetch(`${appUrl}/webhooks`, { method: 'POST', headers: w.headers, body: w.body })).status).toBe(200);
    }
    expect(await store.get(SHOP)).not.toBeNull();
    const w = shopify.webhook('app/uninstalled', SHOP, { id: 1 });
    expect((await fetch(`${appUrl}/webhooks`, { method: 'POST', headers: w.headers, body: w.body })).status).toBe(200);
    expect(await store.get(SHOP)).toBeNull();
  });
});
