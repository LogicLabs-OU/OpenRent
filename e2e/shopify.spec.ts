import { createServer } from 'node:http';
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { createApp, memoryStore } from '../integrations/shopify/server/app.ts';
import { startShopifyFake } from '../integrations/shopify/test/shopify-fake.ts';
import { test, ADMIN, collectErrors, settled, shot, signIn } from './helpers.ts';

// By address, not name: WordPress's PHP and the stand-ins reach the API there.
const API = (process.env.OPENRENT_API_URL ?? 'http://localhost:7170').replace('//localhost:', '//127.0.0.1:');

/**
 * The Shopify app against this OpenRent (FR-SF-7). Shopify is a stand-in here (install, admin, metafields);
 * a real dev store is checked by hand.
 */
test('a Shopify shop installs the app, connects to OpenRent and gives the theme blocks their settings', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const store = memoryStore();
  const cfg = { apiKey: 'e2e-key', apiSecret: 'e2e-secret-123456', apiVersion: '2026-10', scopes: '', appUrl: '', base: (s: string) => s, store };
  const shopify = await startShopifyFake({ apiKey: cfg.apiKey, apiSecret: cfg.apiSecret, appUrl: () => cfg.appUrl });
  cfg.base = shopify.base;
  const server = createServer((req, res) => void createApp(cfg)(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cfg.appUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  const shop = `e2e-${Date.now() % 100000}.myshopify.com`;
  try {
    await signIn(page);
    // App Bridge sends a page outside the real Shopify admin to Shopify's login; the stand-in admin has no frame.
    await page.route('https://cdn.shopify.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
    // Opening the app from the Shopify admin installs it first.
    await page.goto(shopify.openApp(shop));
    await page.getByLabel('OpenRent address').fill(API);
    await settled(page);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
    await page.getByRole('button', { name: 'Connect to OpenRent' }).click();

    const consent = page.getByTestId('oauth-consent');
    await expect(consent).toContainText(`${shop.replace('.myshopify.com', '')} (Shopify)`);
    await consent.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.locator('#status')).toContainText('Connected to Tallinn Gear Rental');
    await shot(page, 'shopify-connected');

    expect(shopify.metafields.get(shop)).toMatchObject({ api_url: API, shop: 'demo' });
    const settings = await (await page.request.get(`${new URL(ADMIN).origin}/api/v1/tenant/settings`)).json();
    expect(settings.widget_origins).toContain(`https://${shop}`);
    const clientId = (await store.get(shop))!.openrent!.clientId;
    const grants = async () => (await (await page.request.get(`${new URL(ADMIN).origin}/api/v1/oauth_grants`)).json()).data.filter((g: any) => g.client_id === clientId);
    expect(await grants()).toHaveLength(1);

    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByRole('status')).toContainText('Disconnected from OpenRent.');
    expect(await grants()).toEqual([]);
    expect(shopify.metafields.has(shop)).toBe(false);
  } finally {
    server.close();
    await shopify.close();
  }
  expect(errors).toEqual([]);
});
