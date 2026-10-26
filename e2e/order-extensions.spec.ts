import { expect, test, type Page } from '@playwright/test';
import { ADMIN, STORE, collectErrors, hydrated, isoDate, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

/** Calls the API with the signed-in staff session (CSRF header included). */
async function call(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

/** `YYYY-MM-DDTHH:MM` for a datetime-local input, `days` from today at 12:00 in the order's time zone. */
const localNoon = (days: number) => `${isoDate(days)}T12:00`;

test('staff extend a rental and approve a customer’s request for more time', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const product = await call(page, 'POST', '/products', { type: 'rental', name: `Extend tent ${Date.now()}`, visibility: 'hidden', tracking: 'none', price: { kind: 'per_period', period_unit: 'day', amount: 2000 } });
  const customer = await call(page, 'POST', '/customers', { name: 'Extend Customer', email: `pw-extend-${Date.now()}@example.com` });
  const draft = await call(page, 'POST', '/orders', { customer_id: customer.id, starts_at: `${isoDate(40)}T09:00:00Z`, ends_at: `${isoDate(41)}T09:00:00Z`, lines: [{ variant_id: product.variants[0].id, quantity: 1 }] });
  const order = await call(page, 'POST', `/orders/${draft.id}/actions/reserve`, {});

  // Staff: extend by a day, after seeing the price.
  await page.goto(`${ADMIN}/orders/${order.id}`);
  await page.getByRole('button', { name: 'Extend', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('New return').fill(localNoon(42));
  await dialog.getByLabel('New return').blur();
  await expect(dialog.getByTestId('end-change-preview')).toContainText('Available');
  await expect(dialog.getByTestId('end-change-preview')).toContainText('Adds');
  await shot(page, 'admin-extend-order');
  await dialog.getByRole('button', { name: 'Extend' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Order extended' }).last()).toBeVisible();
  await expect(page.getByText(/Extension until/)).toBeVisible();

  // The customer asks for one more day from the order link.
  const shopper = await (await browser.newContext()).newPage();
  const shopperErrors = collectErrors(shopper);
  await shopper.goto(`${STORE}/order/${order.public_token}`);
  await hydrated(shopper);
  const card = shopper.getByTestId('order-extension');
  await card.getByRole('button', { name: 'Ask to extend' }).click();
  const ask = shopper.getByRole('dialog');
  await ask.getByLabel('New return date').fill(isoDate(43));
  await ask.getByLabel('Message (optional)').fill('Still camping');
  await ask.getByRole('button', { name: 'Send request' }).click();
  await expect(card.getByTestId('extension-status')).toContainText('requested');
  await shot(shopper, 'sf-extension-requested');

  // Staff approve it on the order page.
  await page.reload();
  const alert = page.getByTestId('extension-request');
  await expect(alert).toContainText('Still camping');
  await expect(alert).toContainText('Extending adds');
  await alert.getByRole('button', { name: 'Approve and extend' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Extension approved' }).last()).toBeVisible();
  await expect(alert).toBeHidden();
  const after = await call(page, 'GET', `/orders/${order.id}`);
  expect(after.ends_at.slice(0, 10)).toBe(isoDate(43));
  expect(after.lines.filter((l: any) => l.type === 'fee')).toHaveLength(2);

  await call(page, 'POST', `/orders/${order.id}/actions/cancel`, {});
  expect(errors).toEqual([]);
  expect(shopperErrors).toEqual([]);
});
