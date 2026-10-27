import { expect, type Page } from '@playwright/test';
import { test, ADMIN, collectErrors, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

/** Calls the API with the signed-in staff session (CSRF header included). */
async function call(page: Page, method: 'GET' | 'POST' | 'DELETE', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

test('staff read a meter on the unit page, plan a service and record it', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now() % 100000;
  const product = await call(page, 'POST', '/products', {
    type: 'rental', name: `Generator ${stamp}`, visibility: 'hidden', tracking: 'serialized', meter_unit: 'h', depreciation_months: 24,
    price: { kind: 'per_period', period_unit: 'day', amount: 4000 },
  });
  const location = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default).id;
  const bought = new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10);
  const unit = await call(page, 'POST', '/stock_items', { variant_id: product.variants[0].id, location_id: location, barcode: `GEN-${stamp}`, purchase_price: 240000, purchase_date: bought });
  let intervalId: string | undefined;
  try {
    await page.goto(`${ADMIN}/inventory?q=${unit.barcode}`);
    await page.getByRole('link', { name: unit.barcode, exact: true }).click();
    await expect(page.getByRole('heading', { name: `Generator ${stamp}`, level: 1 })).toBeVisible();
    // About six of 24 months gone: roughly three quarters of the value left.
    await expect(page.getByTestId('unit-value')).toContainText('Book value');
    const meter = page.getByTestId('unit-meter');
    await meter.getByLabel('New reading (h)').fill('150');
    await meter.getByRole('button', { name: 'Add reading' }).click();
    await expect(meter).toContainText('Now at 150 h');
    await meter.getByLabel('New reading (h)').fill('100');
    await meter.getByRole('button', { name: 'Add reading' }).click();
    await expect(meter).toContainText('Must be at least the last reading (150 h)');

    await page.goto(`${ADMIN}/maintenance`);
    await page.getByRole('link', { name: 'Service' }).click();
    await page.getByRole('button', { name: 'New interval' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Name').fill(`Oil change ${stamp}`);
    await sheet.getByLabel('Applies to').selectOption('product');
    await sheet.getByLabel('One product').selectOption({ label: `Generator ${stamp}` });
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet.getByText('Enter days, rentals or a meter amount')).toBeVisible();
    await sheet.getByLabel('Meter', { exact: true }).fill('100');
    await sheet.getByLabel('Open a repair ticket when overdue').click();
    await sheet.getByRole('button', { name: 'Save' }).click();
    const row = page.getByTestId('service-due').getByRole('row').filter({ hasText: unit.barcode });
    await expect(row).toContainText(`Oil change ${stamp}`);
    await expect(row).toContainText('Overdue');
    await expect(row).toContainText('150 of 100 h');
    await shot(page, 'admin-service-due');
    intervalId = (await call(page, 'GET', '/service_intervals')).data.find((x: any) => x.name === `Oil change ${stamp}`).id;

    await row.getByRole('link', { name: `Generator ${stamp}` }).click();
    const service = page.getByTestId('unit-service');
    await expect(service).toContainText('Overdue');
    await service.getByLabel('Service done').selectOption({ label: `Oil change ${stamp}` });
    await service.getByLabel('Notes').fill('Oil and filter');
    await service.getByRole('button', { name: 'Record' }).click();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Service recorded' }).last()).toBeVisible();
    await expect(service).toContainText('Nothing is due');
    await expect(service).toContainText('Oil and filter');
  } finally {
    if (intervalId) await call(page, 'DELETE', `/service_intervals/${intervalId}`);
  }
  expect(errors).toEqual([]);
});
