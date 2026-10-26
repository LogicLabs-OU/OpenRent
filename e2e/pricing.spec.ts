import { expect, test, type Page } from '@playwright/test';
import { ADMIN, collectErrors, isoDate, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

/** Calls the API with the signed-in staff session (CSRF header included). */
async function call(page: Page, method: 'GET' | 'POST' | 'DELETE', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

test('staff set up a price rule and a coupon on the pricing page', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  // A hidden product of its own, so the rule changes no other test's prices.
  const name = `Rule bike ${Date.now()}`;
  const product = await call(page, 'POST', '/products', { type: 'rental', name, visibility: 'hidden', tracking: 'none', price: { kind: 'per_period', period_unit: 'day', amount: 2000 } });

  await page.goto(`${ADMIN}/pricing`);
  await expect(page.getByRole('heading', { name: 'Pricing', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'New price rule' }).click();
  const dialog = page.getByRole('dialog');
  // Saving without a quantity shows the problem next to the field.
  await dialog.getByLabel('Name').fill(`Bulk deal ${product.id.slice(-6)}`);
  await dialog.getByLabel('Type').selectOption('volume');
  await dialog.getByLabel('Percent').fill('25');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Enter the quantity from which the rule applies')).toBeVisible();
  await dialog.getByLabel('From quantity').fill('2');
  await dialog.getByLabel('Add a product').fill(name);
  await dialog.getByRole('button', { name }).click();
  await expect(dialog.getByText(name)).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  const row = page.getByTestId('price-rule-row').filter({ hasText: `Bulk deal ${product.id.slice(-6)}` });
  await expect(row).toContainText('From 2 items');
  await expect(row).toContainText('-25%');
  await shot(page, 'admin-price-rules');

  // Two bikes get the deal, one does not.
  const quote = async (quantity: number) =>
    (await call(page, 'POST', '/price_quote', { starts_at: `${isoDate(30)}T10:00:00Z`, ends_at: `${isoDate(31)}T10:00:00Z`, lines: [{ variant_id: product.variants[0].id, quantity }] })).lines[0];
  expect((await quote(2)).unit_price.amount).toBe(1500);
  expect((await quote(1)).unit_price.amount).toBe(2000);

  // Coupons tab.
  const code = `E2E${Date.now() % 1_000_000}`;
  await page.getByRole('tab', { name: 'Coupons' }).click();
  await page.getByRole('button', { name: 'New coupon' }).click();
  await dialog.getByLabel('Code').fill(code);
  await dialog.getByLabel('Value').fill('10');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  const coupon = page.getByTestId('coupon-row').filter({ hasText: code });
  await expect(coupon).toContainText('10%');
  await coupon.getByRole('switch').click();
  await expect(coupon.getByRole('switch')).not.toBeChecked();
  await shot(page, 'admin-coupons');

  // Clean up: the rule and coupon go, so repeated runs stay tidy.
  await coupon.getByRole('button', { name: `Delete coupon ${code}?` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(coupon).toBeHidden();
  await page.getByRole('tab', { name: 'Price rules' }).click();
  await row.getByRole('button', { name: /^Delete Bulk deal/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(row).toBeHidden();
  expect(errors).toEqual([]);
});
