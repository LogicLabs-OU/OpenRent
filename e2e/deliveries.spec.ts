import { expect, type Page } from '@playwright/test';
import { test, ADMIN, collectErrors, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

/** Calls the API with the signed-in staff session (CSRF header included). */
async function call(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

test('staff book a delivery, run it from the day board and the order goes out', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const product = await call(page, 'POST', '/products', { type: 'rental', name: `Delivery tent ${Date.now()}`, visibility: 'hidden', tracking: 'none', price: { kind: 'per_period', period_unit: 'day', amount: 3000 } });
  const customer = await call(page, 'POST', '/customers', { name: 'Door Customer', email: `pw-door-${Date.now()}@example.com`, phone: '+372 5550 1234', addresses: { shipping: { line1: 'Pikk 7', postal_code: '10123', city: 'Tallinn' } } });
  // The rental starts in three hours, so the delivery is today.
  const start = new Date(Date.now() + 3 * 3600_000);
  start.setUTCMinutes(0, 0, 0);
  const draft = await call(page, 'POST', '/orders', { customer_id: customer.id, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 86400_000).toISOString(), lines: [{ variant_id: product.variants[0].id, quantity: 1 }] });
  await call(page, 'POST', `/orders/${draft.id}/actions/reserve`, {});

  await page.goto(`${ADMIN}/orders/${draft.id}`);
  const card = page.getByTestId('order-deliveries');
  await card.getByRole('button', { name: 'Book delivery' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Street and number')).toHaveValue('Pikk 7');
  await dialog.getByLabel('Notes for the driver').fill('Ring twice');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Delivery booked' }).last()).toBeVisible();
  await expect(card).toContainText('Scheduled');

  // The day board, reached from the order.
  await card.getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Deliveries', level: 1 })).toBeVisible();
  const stop = page.getByTestId('delivery-stop').filter({ hasText: `#${draft.number}` });
  await expect(stop).toContainText('Pikk 7, 10123, Tallinn');
  await expect(stop).toContainText('Ring twice');
  await stop.getByRole('button', { name: 'On its way' }).click();
  await expect(stop).toContainText('On its way');
  await shot(page, 'admin-deliveries');
  await stop.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Done' }).last()).toBeVisible();
  expect((await call(page, 'GET', `/orders/${draft.id}`)).status).toBe('out');

  await call(page, 'POST', `/orders/${draft.id}/actions/check_in`, { all: true });
  expect(errors).toEqual([]);
});
