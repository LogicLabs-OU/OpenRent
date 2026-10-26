import { expect, test, type Page } from '@playwright/test';
import { ADMIN, collectErrors, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

/** Calls the API with the signed-in staff session (CSRF header included). */
async function call(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

test('a return scanned without a connection is sent once the connection is back', async ({ page, context }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now() % 100000;
  const product = await call(page, 'POST', '/products', { type: 'rental', name: `Offline lamp ${stamp}`, visibility: 'hidden', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 800 } });
  const location = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default).id;
  const unit = await call(page, 'POST', '/stock_items', { variant_id: product.variants[0].id, location_id: location, barcode: `OFL-${stamp}` });
  const customer = await call(page, 'POST', '/customers', { name: 'Offline Customer', email: `pw-offline-${stamp}@example.com` });
  const start = new Date(Date.now() + 3600_000);
  start.setUTCMinutes(0, 0, 0);
  const order = await call(page, 'POST', '/orders', { customer_id: customer.id, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 86400_000).toISOString(), lines: [{ variant_id: product.variants[0].id, quantity: 1 }] });
  await call(page, 'POST', `/orders/${order.id}/actions/reserve`, {});
  await call(page, 'POST', `/orders/${order.id}/actions/assign_units`, { barcodes: [unit.barcode] });
  await call(page, 'POST', `/orders/${order.id}/actions/check_out`, {});

  await page.goto(`${ADMIN}/scan`);
  await page.getByRole('radio', { name: 'Check in' }).click();
  await context.setOffline(true);
  await expect(page.getByTestId('scan-offline')).toContainText('No connection');
  await page.getByLabel('Type or scan a code').fill(unit.barcode);
  await page.getByLabel('Type or scan a code').press('Enter');
  await expect(page.locator('[data-tone="warn"]').first()).toContainText('Saved offline');
  await expect(page.getByTestId('scan-offline')).toContainText('(1 so far)');

  await context.setOffline(false);
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Offline scans sent: 1 done' }).last()).toBeVisible();
  await expect(page.getByTestId('scan-offline')).toHaveCount(0);
  expect((await call(page, 'GET', `/stock_items/${unit.id}`)).status).toBe('available');
  expect((await call(page, 'GET', `/orders/${order.id}`)).status).toBe('returned');
  expect(errors.filter((e) => !/Failed to fetch|ERR_INTERNET_DISCONNECTED/.test(e))).toEqual([]);
});
