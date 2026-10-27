import { expect, type Page } from '@playwright/test';
import { test, ADMIN, collectErrors, isoDate, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

/** Calls the API with the signed-in staff session (CSRF header included). */
async function call(page: Page, method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

test('an owner books past stock with a reason and the order shows it', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const product = await call(page, 'POST', '/products', { type: 'rental', name: `Overbook chair ${Date.now()}`, visibility: 'hidden', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 500 } });
  const location = (await call(page, 'GET', '/locations')).data[0].id;
  await call(page, 'PUT', `/stock_levels/${product.variants[0].id}/${location}`, { quantity: 1 });
  const customer = await call(page, 'POST', '/customers', { name: 'Event Planner', email: `pw-ovb-${Date.now()}@example.com` });
  const draft = await call(page, 'POST', '/orders', { customer_id: customer.id, starts_at: `${isoDate(50)}T09:00:00Z`, ends_at: `${isoDate(51)}T09:00:00Z`, lines: [{ variant_id: product.variants[0].id, quantity: 3 }] });

  await page.goto(`${ADMIN}/orders/${draft.id}`);
  await page.getByRole('button', { name: 'Reserve', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Book past stock?');
  await dialog.getByRole('button', { name: 'Book anyway' }).click();
  await expect(dialog.getByText('Say why it is booked past stock')).toBeVisible();
  await dialog.getByLabel('Reason').fill('Two chairs come from the hall');
  await dialog.getByRole('button', { name: 'Book anyway' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('order-overbooked')).toContainText('2 items are booked past stock');
  await expect(page.getByTestId('order-overbooked')).toContainText('Two chairs come from the hall');
  await shot(page, 'admin-overbooked');

  await call(page, 'POST', `/orders/${draft.id}/actions/cancel`, {});
  expect(errors).toEqual([]);
});
