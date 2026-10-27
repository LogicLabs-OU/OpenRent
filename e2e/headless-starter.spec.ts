import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, ADMIN, collectErrors, randomOffset, signIn, weekday } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;
const STARTER = 'http://localhost:7174';
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/create-openrent-storefront/template');

async function call(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

const axe = async (page: Page) => expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);

// The starter that create-openrent-storefront copies, run as a shop would run it, on the test API.
let server: ChildProcess;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = spawn('npx', ['vite', 'dev', '--port', '7174', '--strictPort'], {
    cwd: DIR,
    env: { ...process.env, OPENRENT_API_URL: new URL(API).origin, OPENRENT_TENANT_SLUG: 'demo', OPENRENT_PUBLISHABLE_KEY: '', SVELTEKIT_OUT_DIR: '.svelte-kit-e2e' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    if (await fetch(STARTER).then((r) => r.ok, () => false)) return;
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error('The starter did not start');
});
test.afterAll(() => {
  server?.kill();
});

test('a headless shop from the starter books a rental through the SDK', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const name = `Headless kayak ${Date.now()}`;
  const product = await call(page, 'POST', '/products', { type: 'rental', name, visibility: 'public', tracking: 'none', price: { kind: 'per_period', period_unit: 'day', amount: 2500 } });

  const shopper = await (await browser.newContext()).newPage();
  const shopperErrors = collectErrors(shopper);
  await shopper.goto(STARTER, { waitUntil: 'networkidle' });
  await expect(shopper.getByRole('heading', { level: 1 })).toContainText('Rent from');
  await axe(shopper);

  await shopper.goto(`${STARTER}/p/${product.slug}`, { waitUntil: 'networkidle' });
  await expect(shopper.getByRole('heading', { name })).toBeVisible();
  const start = weekday(randomOffset());
  let end = weekday(Math.round((Date.parse(start) - Date.now()) / 86400_000) + 2);
  if (end <= start) end = weekday(Math.round((Date.parse(start) - Date.now()) / 86400_000) + 3);
  // A return before the pickup is refused on the page.
  await shopper.getByLabel('Pickup').fill(`${end}T10:00`);
  await shopper.getByLabel('Return').fill(`${start}T10:00`);
  await shopper.getByRole('button', { name: 'Check' }).click();
  await expect(shopper.getByRole('alert')).toHaveText('Choose a pickup before the return');
  await shopper.getByLabel('Pickup').fill(`${start}T10:00`);
  await shopper.getByLabel('Return').fill(`${end}T10:00`);
  await axe(shopper);
  await shopper.getByRole('button', { name: 'Add to cart' }).click();

  await expect(shopper).toHaveURL(`${STARTER}/cart`);
  // The dev server may still reload a page it opens for the first time; let it settle.
  await shopper.waitForLoadState('networkidle');
  await expect(shopper.getByRole('link', { name: 'Cart (1)' })).toBeVisible();
  const lines = shopper.getByTestId('cart-lines');
  await expect(lines).toContainText(name);
  await shopper.getByLabel(`Quantity of ${name}`).fill('2');
  await shopper.getByRole('button', { name: 'Update' }).click();
  await expect(shopper.getByRole('link', { name: 'Cart (2)' })).toBeVisible();
  const total = (await shopper.getByTestId('cart-totals').getByRole('row', { name: /Total/ }).textContent())!;
  await axe(shopper);
  await shopper.getByRole('link', { name: 'Go to checkout' }).click();

  await expect(shopper.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  await shopper.getByLabel('Full name').fill('Headless Customer');
  await shopper.getByLabel('Email').fill(`pw-headless-${Date.now()}@example.com`);
  // Without the terms, the API's message shows at the box.
  await shopper.getByRole('button', { name: 'Place booking' }).click();
  await expect(shopper.locator('p.error')).toBeVisible();
  await expect(shopper.getByLabel('Full name')).toHaveValue('Headless Customer');
  await axe(shopper);
  await shopper.getByLabel('I accept the rental terms').check();
  await shopper.getByRole('button', { name: 'Place booking' }).click();

  const heading = shopper.getByRole('heading', { name: /thank you, your booking #\d+/i });
  await expect(heading).toBeVisible();
  await expect(shopper.getByTestId('order-lines')).toContainText(`2 × ${name}`);
  await expect(shopper.getByTestId('order-lines')).toContainText(total.replace(/^Total\s*/, '').trim());
  await expect(shopper.getByRole('link', { name: 'Cart (0)' })).toBeVisible();
  await axe(shopper);
  const number = (await heading.textContent())!.match(/#(\d+)/)![1];
  const order = await call(page, 'GET', `/orders/${number}`);
  expect([order.source, order.lines.map((l: any) => [l.description, l.quantity])]).toEqual(['storefront', [[name, 2]]]);

  await call(page, 'POST', `/orders/${order.id}/actions/cancel`, {});
  await call(page, 'POST', `/products/${product.id}/actions/archive`, {});
  expect(shopperErrors).toEqual([]);
  expect(errors).toEqual([]);
});
