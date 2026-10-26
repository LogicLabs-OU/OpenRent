import { expect, test, type Page } from '@playwright/test';
import { ADMIN, collectErrors, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

test('staff forecast availability and download the order list', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await page.goto(`${ADMIN}/reports`);
  await page.getByLabel('Report').selectOption('availability_forecast');
  await expect(page.getByRole('columnheader', { name: 'Free', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Booked', exact: true })).toBeVisible();
  await shot(page, 'admin-availability-forecast');

  await page.goto(`${ADMIN}/orders`);
  await page.getByTestId('list-export').click();
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Export CSV' }).click()]);
  expect(file.suggestedFilename()).toMatch(/^orders-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(errors).toEqual([]);
});

test('staff create a calendar link for one unit', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const product = await call(page, 'POST', '/products', { type: 'rental', name: `Feed bike ${Date.now()}`, visibility: 'hidden', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 3000 } });
  const location = (await call(page, 'GET', '/locations')).data[0].id;
  const unit = await call(page, 'POST', '/stock_items', { variant_id: product.variants[0].id, location_id: location });
  await page.goto(`${ADMIN}/products/${product.id}`);
  await page.getByRole('button', { name: `Edit ${unit.barcode}` }).click();
  const card = page.getByTestId('unit-calendar');
  await card.getByRole('button', { name: 'Create calendar link' }).click();
  await expect(card.getByTestId('unit-calendar-url')).toHaveValue(/\/api\/v1\/calendar\/[A-Za-z0-9_-]+\.ics$/);
  const url = await card.getByTestId('unit-calendar-url').inputValue();
  const ics = await (await page.request.get(url)).text();
  expect(ics).toContain('BEGIN:VCALENDAR');
  await expect(card.getByText(`Unit ${unit.barcode}`)).toBeVisible();
  await shot(page, 'admin-unit-calendar');
  expect(errors).toEqual([]);
});
