import { expect, type Page } from '@playwright/test';
import { test, ADMIN, collectErrors, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

test('staff give a discount on an order and set free pickup and return days', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const kayak = (await call(page, 'GET', '/products?q=Sea%20kayak')).data.find((p: { name: string }) => p.name === 'Sea kayak');
  const customer = await call(page, 'POST', '/customers', { name: 'Disco Unt', email: `disc-${Date.now()}@example.com` });
  const starts = new Date(Date.now() + 40 * 86400_000);
  const order = await call(page, 'POST', '/orders', {
    customer_id: customer.id,
    starts_at: starts.toISOString(),
    ends_at: new Date(starts.getTime() + 2 * 86400_000).toISOString(),
    lines: [{ variant_id: kayak.variants[0].id, quantity: 1 }],
  });
  const before = order.totals.total.amount;

  await page.goto(`${ADMIN}/orders/${order.id}`);
  await page.getByRole('button', { name: 'Add discount' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Description').fill('Returning paddler');
  await dialog.getByRole('radio', { name: '%' }).click();
  await dialog.getByLabel('Percentage', { exact: true }).fill('10');
  await dialog.getByRole('button', { name: 'Add discount' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Discount added' }).last()).toBeVisible();
  await expect(page.getByText('Returning paddler')).toBeVisible();
  const after = await call(page, 'GET', `/orders/${order.id}`);
  expect(after.totals.total.amount).toBeLessThan(before);
  expect(after.totals.discount.amount).toBeGreaterThan(0);
  await shot(page, 'admin-order-discount');

  // Charging days on the price.
  await page.goto(`${ADMIN}/products/${kayak.id}`);
  await page.getByTestId('variant-price').first().click();
  const price = page.getByRole('dialog');
  await price.getByLabel('Pickup day is free').check();
  await price.getByLabel('Only when picked up at or after').fill('16:00');
  await price.getByRole('button', { name: 'Save' }).click();
  await expect(price).toHaveCount(0);
  const variant = await call(page, 'GET', `/variants/${kayak.variants[0].id}`);
  expect(variant.price_structure.charge_day_rules).toMatchObject({ free_pickup_day: true, pickup_after: '16:00' });
  // Put the price back as it was.
  await page.getByTestId('variant-price').first().click();
  await page.getByRole('dialog').getByLabel('Pickup day is free').uncheck();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});
