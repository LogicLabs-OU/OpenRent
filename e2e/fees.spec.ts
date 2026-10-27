import { expect, type Page } from '@playwright/test';
import { test, ADMIN, STORE, collectErrors, hydrated, pickDay, randomOffset, shot, signIn, weekday } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

/** Calls the API with the signed-in staff session (CSRF header included). */
async function call(page: Page, method: 'GET' | 'POST' | 'DELETE', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

test('staff offer a damage waiver and a customer adds it at checkout', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  // Its own product, so the fee touches no other test's checkout.
  const name = `Waiver kayak ${Date.now()}`;
  const product = await call(page, 'POST', '/products', { type: 'rental', name, visibility: 'public', tracking: 'none', price: { kind: 'per_period', period_unit: 'day', amount: 2000 } });
  const feeName = `Damage waiver ${product.id.slice(-5)}`;

  await page.goto(`${ADMIN}/pricing?tab=fees`);
  await page.getByRole('button', { name: 'New fee' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(feeName);
  await dialog.getByLabel('Type').selectOption('damage_waiver');
  await dialog.getByLabel('Added').selectOption('optional');
  await dialog.getByLabel('Calculated as').selectOption('percent');
  await dialog.getByLabel('Percent').fill('10');
  await dialog.getByLabel('Add a product').fill(name);
  await dialog.getByRole('button', { name }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  const row = page.getByTestId('fee-rule-row').filter({ hasText: feeName });
  await expect(row).toContainText('10% of the rental');
  await expect(row).toContainText('When the customer chooses it');
  await shot(page, 'admin-fees');

  // The customer books it and ticks the waiver.
  const shopper = await (await browser.newContext()).newPage();
  const shopperErrors = collectErrors(shopper);
  await shopper.goto(STORE);
  await hydrated(shopper);
  const start = randomOffset();
  const bar = shopper.getByTestId('date-bar');
  await bar.locator('#or-dates').click();
  const calendar = shopper.locator('[data-slot="popover-content"]');
  await pickDay(calendar, weekday(start));
  await pickDay(calendar, weekday(start + 1));
  await bar.getByRole('button', { name: /show what/i }).click();
  // The dates are saved once the catalogue shows availability.
  await expect(shopper.locator('[data-availability]').first()).toBeVisible();
  await shopper.goto(`${STORE}/p/${product.slug}`);
  await hydrated(shopper);
  await expect(shopper.getByTestId('price-total')).toBeVisible();
  await shopper.getByRole('button', { name: 'Add to cart' }).click();
  await expect(shopper.locator('p[role="status"]', { hasText: 'Added to your cart' })).toBeVisible();
  await shopper.goto(`${STORE}/checkout`);
  await hydrated(shopper);
  const extras = shopper.getByTestId('optional-fees');
  await expect(extras).toContainText(feeName);
  const summary = shopper.getByTestId('price-summary');
  await expect(summary).not.toContainText(feeName);
  await extras.getByRole('checkbox', { name: new RegExp(feeName) }).click();
  await expect(summary).toContainText(feeName);
  await expect(extras.getByRole('checkbox', { name: new RegExp(feeName) })).toBeChecked();
  await shot(shopper, 'sf-checkout-extras');

  await shopper.getByLabel('Full name').fill('Waiver Customer');
  await shopper.getByLabel('Email').fill(`pw-waiver-${Date.now()}@example.com`);
  await shopper.getByLabel('I accept the rental terms').check();
  await shopper.getByRole('button', { name: /place booking/i }).click();
  await expect(shopper.getByRole('heading', { name: /thank you, your booking #\d+/i })).toBeVisible();
  const number = (await shopper.getByRole('heading', { name: /thank you/i }).textContent())!.match(/#(\d+)/)![1];
  const order = await call(page, 'GET', `/orders/${number}`);
  expect(order.lines.filter((l: any) => l.type === 'fee').map((l: any) => l.description)).toEqual([feeName]);

  // Clean up: cancel the booking, drop the fee and archive the product.
  await call(page, 'POST', `/orders/${order.id}/actions/cancel`, {});
  const fee = (await call(page, 'GET', '/fee_rules?limit=200')).data.find((f: any) => f.name === feeName);
  await call(page, 'DELETE', `/fee_rules/${fee.id}`);
  await call(page, 'POST', `/products/${product.id}/actions/archive`, {});
  expect(errors).toEqual([]);
  expect(shopperErrors).toEqual([]);
});
