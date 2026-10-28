import { createHash, randomBytes } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { test, ADMIN, collectErrors, settled, shot, signIn } from './helpers.ts';

const API = process.env.OPENRENT_API_URL ?? 'http://localhost:7170';

test('the owner connects an app with OAuth, the app calls the API, and the owner disconnects it', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const redirect = 'https://wp-site.example.test/wp-admin/admin.php?page=openrent';
  const reg = await page.request.post(`${API}/oauth/register`, { data: { client_name: `E2E WordPress ${Date.now() % 100000}`, redirect_uris: [redirect], client_uri: 'https://wp-site.example.test' } });
  expect(reg.status()).toBe(201);
  const client = await reg.json();
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  // The app's own page, standing in for the WordPress admin it sends people back to.
  await page.route('https://wp-site.example.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>WordPress</title><p>Back in WordPress</p>' }));

  const q = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: redirect, scope: 'catalog:read orders:read', state: 'wp-state-1', code_challenge: challenge, code_challenge_method: 'S256' });
  await page.goto(`${API}/oauth/authorize?${q}`);
  const consent = page.getByTestId('oauth-consent');
  await expect(consent.getByRole('heading', { name: new RegExp(`^Connect ${client.client_name} to `) })).toBeVisible();
  await expect(consent).toContainText('you go back to wp-site.example.test');
  await expect(consent.getByTestId('oauth-scopes').getByRole('listitem')).toHaveCount(2);
  await settled(page);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  await shot(page, 'admin-oauth-consent');
  await consent.getByRole('button', { name: 'Connect' }).click();
  await page.waitForURL((url) => url.hostname === 'wp-site.example.test');
  const back = new URL(page.url());
  expect(back.searchParams.get('state')).toBe('wp-state-1');
  const code = back.searchParams.get('code')!;

  const tokens = await (await page.request.post(`${API}/oauth/token`, { form: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect, client_id: client.client_id } })).json();
  expect(tokens.scope).toBe('catalog:read orders:read');
  const products = await page.request.get(`${API}/api/v1/products?limit=1`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
  expect(products.status()).toBe(200);

  await page.goto(`${ADMIN}/settings?tab=apps`);
  const row = page.getByTestId('connected-app').filter({ hasText: client.client_name });
  await expect(row).toContainText('catalog:read, orders:read');
  await row.getByRole('button', { name: 'Disconnect' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'App disconnected' }).last()).toBeVisible();
  await expect(row).toBeHidden();
  expect((await page.request.get(`${API}/api/v1/products?limit=1`, { headers: { authorization: `Bearer ${tokens.access_token}` } })).status()).toBe(401);
  expect(errors).toEqual([]);
});
