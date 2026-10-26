import { expect, test, type Page } from '@playwright/test';
import { ADMIN, STORE, collectErrors, hydrated, randomOffset, signIn, weekday } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

// Accessories (FR-CAT-7): staff choose them; the customer ticks one and both go into the cart.
test('staff add an accessory; the customer ticks it and both go into the cart', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now();
  const location = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default);
  const make = async (name: string) => {
    const p = await call(page, 'POST', '/products', { type: 'rental', name: `${name} ${stamp}`, tracking: 'bulk', visibility: 'public', price: { kind: 'per_period', period_unit: 'day', amount: 1500 } });
    await call(page, 'PUT', `/stock_levels/${p.variants[0].id}/${location.id}`, { quantity: 5 });
    return p;
  };
  const board = await make('E2E SUP board');
  const vest = await make('E2E Life vest');

  await page.goto(`${ADMIN}/products/${board.id}`);
  const card = page.getByTestId('product-relations');
  await card.getByTestId('product-picker').first().getByLabel('Add a product').fill(vest.name);
  await card.getByRole('option', { name: vest.name, exact: true }).click();
  await card.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await call(page, 'GET', `/products/${board.id}/relations`)).accessory.map((x: any) => x.id)).toEqual([vest.id]);

  const shopper = await (await browser.newContext()).newPage();
  const start = new Date(`${weekday(randomOffset())}T09:00:00.000Z`);
  await shopper.request.post(`${STORE}/_or/dates`, { data: { from: start.toISOString(), to: new Date(start.getTime() + 86400_000).toISOString() } });
  await shopper.goto(`${STORE}/p/${board.slug}`);
  await hydrated(shopper);
  await shopper.getByTestId('accessories').getByLabel(new RegExp(vest.name)).check();
  await shopper.getByRole('button', { name: 'Add to cart' }).click();
  await expect(shopper.locator('p[role="status"]', { hasText: 'Added to your cart' })).toBeVisible();
  await shopper.goto(`${STORE}/cart`);
  await hydrated(shopper);
  await expect(shopper.getByTestId('cart-lines')).toContainText(board.name);
  await expect(shopper.getByTestId('cart-lines')).toContainText(vest.name);
  await shopper.context().close();
  expect(errors).toEqual([]);
});
