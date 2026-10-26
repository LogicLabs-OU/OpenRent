import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, collectErrors, localInput, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

// Stock rented in from a supplier (FR-CAT-9): more can be booked for those dates.
test('staff rent stock in for some dates and more can be booked then', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now();
  const location = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default);
  const p = await call(page, 'POST', '/products', { type: 'rental', name: `E2E Stage deck ${stamp}`, tracking: 'bulk', visibility: 'hidden', price: { kind: 'per_period', period_unit: 'day', amount: 9000 } });
  await call(page, 'PUT', `/stock_levels/${p.variants[0].id}/${location.id}`, { quantity: 1 });

  await page.goto(`${ADMIN}/products/${p.id}`);
  const card = page.getByTestId('external-stock');
  await expect(card.getByText('Nothing rented in.')).toBeVisible();
  await card.getByRole('button', { name: 'Rent in' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rent in' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await dialog.getByLabel('From', { exact: true }).fill(localInput('Europe/Tallinn', 3 * 24 * 60));
  await dialog.getByLabel('Until', { exact: true }).fill(localInput('Europe/Tallinn', 5 * 24 * 60));
  await dialog.getByLabel('Quantity').fill('4');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Enter who it is rented from')).toBeVisible();
  await dialog.getByLabel('Rented from').fill('Stage Hire Ltd');
  await dialog.getByLabel('Cost per unit').fill('40');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(card.getByText('Stage Hire Ltd')).toBeVisible();
  await expect(card.getByText('× 4')).toBeVisible();
  await page.mouse.move(0, 0);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('[data-testid="external-stock"]').analyze();
  expect(axe.violations).toEqual([]);

  const from = new Date(Date.now() + 3.5 * 86400_000).toISOString();
  const to = new Date(Date.now() + 4 * 86400_000).toISOString();
  const a = await call(page, 'GET', `/availability?variant_id=${p.variants[0].id}&location_id=${location.id}&from=${from}&to=${to}`);
  expect(a.available).toBe(5);
  const x = (await call(page, 'GET', `/external_stock?variant_id=${p.variants[0].id}&status=booked`)).data[0];
  await call(page, 'POST', `/external_stock/${x.id}/actions/cancel`, {});
  expect(errors).toEqual([]);
});
