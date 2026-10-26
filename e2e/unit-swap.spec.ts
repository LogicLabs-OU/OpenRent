import { expect, test, type Page } from '@playwright/test';
import { ADMIN, collectErrors, isoDate, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

/** Calls the API with the signed-in staff session (CSRF header included). */
async function call(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

test('counter staff swap a broken unit on the scan page and on the order', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  // Its own item with three units, out on a rental that started today.
  const product = await call(page, 'POST', '/products', { type: 'rental', name: `Swap bike ${Date.now()}`, visibility: 'hidden', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 2500 } });
  const location = (await call(page, 'GET', '/locations')).data[0].id;
  const units = [];
  for (let i = 0; i < 3; i++) units.push(await call(page, 'POST', '/stock_items', { variant_id: product.variants[0].id, location_id: location }));
  const customer = await call(page, 'POST', '/customers', { name: 'Swap Customer', email: `pw-swap-${Date.now()}@example.com` });
  const draft = await call(page, 'POST', '/orders', { customer_id: customer.id, starts_at: `${isoDate(1)}T09:00:00Z`, ends_at: `${isoDate(3)}T09:00:00Z`, lines: [{ variant_id: product.variants[0].id, quantity: 1, stock_item_ids: [units[0].id] }] });
  await call(page, 'POST', `/orders/${draft.id}/actions/reserve`, {});
  await call(page, 'POST', `/orders/${draft.id}/actions/check_out`, {});

  // Scan page: the unit coming back, then its replacement.
  await page.goto(`${ADMIN}/scan`);
  await page.getByRole('radio', { name: 'Swap' }).click();
  await page.getByTestId('swap-panel').getByLabel('Unit coming back becomes').selectOption('hard_down');
  const input = page.getByLabel('Type or scan a code');
  await input.fill(units[0].barcode);
  await input.press('Enter');
  await expect(page.getByTestId('swap-panel')).toContainText(`Now scan the replacement for ${units[0].barcode}`);
  await input.fill(units[1].barcode);
  await input.press('Enter');
  await expect(page.getByText(`${units[0].barcode} swapped for ${units[1].barcode}`)).toBeVisible();
  await shot(page, 'admin-scan-swap');
  expect((await call(page, 'GET', `/stock_items/${units[0].id}`)).status).toBe('hard_down');

  // Order page: swap the replacement once more with the dialog.
  await page.goto(`${ADMIN}/orders/${draft.id}`);
  await page.getByRole('button', { name: `Swap ${units[1].barcode}` }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Barcode of the replacement').fill(units[2].barcode);
  await dialog.getByRole('button', { name: 'Swap unit' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: `${units[1].barcode} swapped for ${units[2].barcode}` }).last()).toBeVisible();
  const order = await call(page, 'GET', `/orders/${draft.id}`);
  expect(order.lines[0].units.filter((u: any) => !u.replaced).map((u: any) => u.barcode)).toEqual([units[2].barcode]);

  await call(page, 'POST', `/orders/${draft.id}/actions/check_in`, { all: true });
  expect(errors).toEqual([]);
});
