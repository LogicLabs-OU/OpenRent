import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, ADMIN, addProduct, collectErrors, isoDate, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

// The order editor finds products by searching, so shops with large catalogues can add any of them.
test('staff add a product to a draft order by searching and with the keyboard', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const name = `E2E Party tent ${Date.now()}`;
  const tent = await call(page, 'POST', '/products', { type: 'rental', name, tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 9000 } });
  const order = await call(page, 'POST', '/orders', { starts_at: `${isoDate(20)}T10:00:00Z`, ends_at: `${isoDate(21)}T10:00:00Z`, lines: [] });

  await page.goto(`${ADMIN}/orders/${order.id}`);
  await addProduct(page, name);
  await expect(page.getByText('Line added')).toBeVisible();
  await expect.poll(async () => (await call(page, 'GET', `/orders/${order.id}`)).lines.length).toBe(1);

  // Arrow keys and Enter pick without the mouse.
  const input = page.getByTestId('product-picker').getByLabel('Add a product');
  await input.fill(name);
  await expect(page.getByRole('option', { name: tent.name, exact: true })).toBeVisible();
  await input.press('Enter');
  await expect.poll(async () => (await call(page, 'GET', `/orders/${order.id}`)).lines.filter((l: any) => l.variant_id === tent.variants[0].id).reduce((n: number, l: any) => n + l.quantity, 0)).toBe(2);

  await input.fill(`${name} nothing like it`);
  await expect(page.getByText('No results found.')).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('[data-testid="product-picker"]').analyze();
  expect(axe.violations).toEqual([]);
  await call(page, 'POST', `/orders/${order.id}/actions/cancel`, { notify: false });
  await call(page, 'DELETE', `/products/${tent.id}`);
  expect(errors).toEqual([]);
});
